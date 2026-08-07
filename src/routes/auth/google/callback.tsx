import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { SESSION_COOKIE } from "~/lib/auth";
import { GOOGLE_REDIRECT_URI } from "~/lib/google-oauth";

/**
 * OAuth callback for "Continue with Google" signup/login.
 *
 * Google redirects here (full page load) with `?code=...` after the user
 * consents. The loader runs all of the server-side work:
 *
 *   1. Exchange the authorization code for tokens (Google token endpoint)
 *   2. Verify the ID token (RS256 signature via Google's JWKS, aud === client ID)
 *   3. Extract email / name / google_id (sub) from the ID token
 *   4. Find the user by google_id (google_accounts) or by email (users)
 *   5. Create the user (plan_tier 'starter', trial started now) if new
 *   6. Link/create the google_accounts row
 *   7. Create a session (same pattern as signup) and set the session cookie
 *   8. 302 → /dashboard
 *
 * Env vars (Vercel project settings):
 *   GOOGLE_CLIENT_ID       — OAuth 2.0 Client ID
 *   GOOGLE_CLIENT_SECRET   — OAuth 2.0 Client Secret
 *
 * Redirect URI registered in Google Cloud Console:
 *   https://www.contrax.company/auth/google/callback
 */

const SESSION_TTL_DAYS = 30;
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";

// ── ID token helpers ──────────────────────────────────────────────────────────

interface GoogleJwk {
  kid?: string;
  alg?: string;
  n?: string;
  e?: string;
}

interface GoogleIdTokenPayload {
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
  azp?: string;
}

/** Cache Google's signing keys (JWKS) for an hour to avoid a cert fetch per login. */
let jwksCache: { fetchedAt: number; keys: GoogleJwk[] } | null = null;

function base64UrlToBase64(s: string): string {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}

function decodeBase64Url(part: string): string {
  const b64 = base64UrlToBase64(part);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function getGoogleSigningKey(kid?: string): Promise<{ n: string; e: string }> {
  if (!jwksCache || Date.now() - jwksCache.fetchedAt > 60 * 60 * 1000) {
    const res = await fetch(JWKS_ENDPOINT);
    if (!res.ok) throw new Error(`Failed to fetch Google signing keys (${res.status})`);
    const data = (await res.json()) as { keys?: GoogleJwk[] };
    jwksCache = { fetchedAt: Date.now(), keys: data.keys ?? [] };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid && k.alg === "RS256");
  if (!jwk?.n || !jwk.e) throw new Error("Google signing key not found");
  return { n: jwk.n, e: jwk.e };
}

/**
 * Decodes a Google ID token and verifies it: RS256 signature against Google's
 * public keys, `aud` matches our client ID, issuer is accounts.google.com,
 * not expired. Returns the claims (email, name, sub, picture).
 */
async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdTokenPayload> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = JSON.parse(decodeBase64Url(headerPart)) as { alg?: string; kid?: string };
  const payload = JSON.parse(decodeBase64Url(payloadPart)) as GoogleIdTokenPayload;

  if (header.alg !== "RS256") throw new Error("Unexpected ID token algorithm");
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Invalid ID token issuer");
  }
  if (payload.aud !== clientId) throw new Error("ID token audience mismatch");
  if (payload.azp && payload.azp !== clientId) throw new Error("ID token authorized-party mismatch");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    throw new Error("ID token expired");
  }
  if (!payload.sub || !payload.email) throw new Error("ID token missing claims");
  // Google only returns a verified email for the account's own address.
  if (payload.email_verified === false) throw new Error("Google email not verified");

  // Signature verification — Web Crypto (Node 22 / Bun), no JWT dependency.
  const { n, e } = await getGoogleSigningKey(header.kid);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n, e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = Uint8Array.from(atob(base64UrlToBase64(signaturePart)), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    publicKey,
    signature,
    data,
  );
  if (!valid) throw new Error("ID token signature verification failed");

  return payload;
}

// ── Server function: all OAuth + DB + session work (server-only) ─────────────

const handleGoogleAuth = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "string" || data.length === 0) {
      throw new Error("Missing authorization code");
    }
    return data;
  })
  .handler(async ({ data: code }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured");
    }

    // 1. Exchange the authorization code for tokens.
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed (${tokenRes.status})`);
    }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error("Token response missing id_token");

    // 2–3. Verify the ID token and extract claims.
    const claims = await verifyGoogleIdToken(tokens.id_token, clientId);
    const googleId = claims.sub!;
    const email = claims.email!.trim().toLowerCase();
    const name = claims.name ?? claims.given_name ?? null;
    const avatarUrl = claims.picture ?? null;

    // 4. Ensure the google_accounts table exists (idempotent migration).
    await sql()`
      CREATE TABLE IF NOT EXISTS google_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        google_id TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // 5. Find the user: first by google_id, then by email.
    let userId: number | null = null;
    const byGoogle = await sql()`SELECT user_id FROM google_accounts WHERE google_id = ${googleId}`;
    if (byGoogle.length > 0) {
      userId = (byGoogle[0] as { user_id: number }).user_id;
    } else {
      const byEmail = await sql()`SELECT id FROM users WHERE email = ${email}`;
      if (byEmail.length > 0) {
        userId = (byEmail[0] as { id: number }).id;
      }
    }

    // 6. Create the user if this is a brand-new account.
    //    password_hash stays NULL for Google-only users. If the database has a
    //    NOT NULL constraint on password_hash, fall back to an unusable
    //    placeholder that can never pass PBKDF2 verification.
    if (userId === null) {
      const inserted = await sql()`
        INSERT INTO users (email, password_hash, plan_tier, trial_started_at)
        VALUES (${email}, NULL, 'starter', NOW())
        RETURNING id
      `.catch(async () => {
        const retry = await sql()`
          INSERT INTO users (email, password_hash, plan_tier, trial_started_at)
          VALUES (${email}, ${`oauth:${crypto.randomUUID()}`}, 'starter', NOW())
          RETURNING id
        `;
        return retry;
      });
      userId = (inserted[0] as { id: number }).id;
    }

    // 7. Link the Google account (for existing users with no row yet).
    await sql()`
      INSERT INTO google_accounts (user_id, google_id, email, name, avatar_url)
      VALUES (${userId}, ${googleId}, ${email}, ${name}, ${avatarUrl})
      ON CONFLICT (google_id) DO NOTHING
    `;

    // 8. Create a session — same pattern as signup.tsx.
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await sql()`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${userId}, ${token}, ${expiresAt.toISOString()})
    `;

    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    return { success: true, userId };
  });

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/auth/google/callback")({
  loader: async ({ location }) => {
    const search = new URLSearchParams(location.search);

    // User declined consent on Google's screen.
    if (search.get("error")) {
      throw redirect({ href: "/login?error=google_denied" });
    }

    const code = search.get("code");
    if (!code) {
      throw redirect({ href: "/login?error=google_missing_code" });
    }

    try {
      await handleGoogleAuth({ data: code });
    } catch (err) {
      console.error("[google-auth] callback failed:", err);
      throw redirect({ href: "/login?error=google_auth_failed" });
    }

    throw redirect({ href: "/dashboard" });
  },
  component: () => null, // Never rendered — the loader always redirects.
  head: () => ({
    meta: [
      { title: "Signing you in… | Contrax" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
