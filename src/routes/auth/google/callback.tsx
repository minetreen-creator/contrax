import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE } from "~/lib/auth";
import { GOOGLE_REDIRECT_URI } from "~/lib/google-oauth";
import { safeNext, saveMatch } from "~/lib/saved-matches";

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
    const d = data as { code?: unknown; plan?: unknown };
    if (typeof d.code !== "string" || d.code.length === 0) {
      throw new Error("Missing authorization code");
    }
    // Optional plan from the save-to-pipeline OAuth state (only used when a
    // brand-new user is created; existing users keep their current tier).
    const plan =
      typeof d.plan === "string" && ["starter", "professional", "agency"].includes(d.plan)
        ? d.plan
        : undefined;
    return { code: d.code, plan };
  })
  .handler(async ({ data: { code, plan } }) => {
    const { sql } = await import("~/db");
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
        VALUES (${email}, NULL, ${plan ?? "starter"}, NOW())
        RETURNING id
      `.catch(async () => {
        const retry = await sql()`
          INSERT INTO users (email, password_hash, plan_tier, trial_started_at)
          VALUES (${email}, ${`oauth:${crypto.randomUUID()}`}, ${plan ?? "starter"}, NOW())
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

/**
 * Idempotent DDL guard for the funnel-events table (mirrors event.ts) — used
 * only when a save-to-pipeline intent is completed here, so the `save_success`
 * row can be recorded without a client round-trip.
 */
async function ensureFunnelEventsTable(): Promise<void> {
  const { sql } = await import("~/db");
  await sql()`CREATE TABLE IF NOT EXISTS funnel_events (
    id SERIAL PRIMARY KEY,
    event_name TEXT NOT NULL,
    label TEXT,
    path TEXT,
    user_agent TEXT,
    ip TEXT,
    referrer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_created_at ON funnel_events (created_at)`;
  await sql()`CREATE INDEX IF NOT EXISTS idx_funnel_events_event_name ON funnel_events (event_name)`;
}

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

    // Save-to-pipeline intent rides through OAuth `state` (returned verbatim
    // by Google): { save_bid?: string, next?: string, plan?: string }.
    let saveBid: number | null = null;
    let next: string | null = null;
    let plan: string | undefined;
    const stateRaw = search.get("state");
    if (stateRaw) {
      try {
        const state = JSON.parse(stateRaw) as {
          save_bid?: unknown;
          next?: unknown;
          plan?: unknown;
        };
        const sb = Number(state.save_bid);
        if (Number.isInteger(sb) && sb > 0) saveBid = sb;
        if (typeof state.next === "string") next = state.next;
        if (typeof state.plan === "string") plan = state.plan;
      } catch {
        // Malformed state — ignore the intent; the login still succeeds.
      }
    }

    let userId: number | null = null;
    try {
      const result = await handleGoogleAuth({ data: { code, plan } });
      userId = result.userId;
    } catch (err) {
      console.error("[google-auth] callback failed:", err);
      throw redirect({ href: "/login?error=google_auth_failed" });
    }

    // Complete the save-to-pipeline intent server-side. Never blocks the
    // redirect, and never fails the login — the save is best-effort.
    if (saveBid !== null && userId !== null) {
      try {
        const { sql } = await import("~/db");
        await saveMatch(userId, saveBid);
        await ensureFunnelEventsTable();
        await sql()`
          INSERT INTO funnel_events (event_name, label, path, user_agent)
          VALUES ('save_success', ${String(saveBid)}, ${safeNext(next)}, 'google-oauth-callback')
        `;
      } catch (err) {
        console.error("[google-auth] save-to-pipeline failed:", err);
      }
    }

    throw redirect({ href: safeNext(next) ?? "/dashboard" });
  },
  component: () => null, // Never rendered — the loader always redirects.
  head: () => ({
    meta: [
      { title: "Signing you in… | Contrax" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
