import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie, getRequest } from "@tanstack/react-start/server";
import { SESSION_COOKIE } from "~/lib/auth";
import { safeNext, saveMatch } from "~/lib/saved-matches";
import { isBlockedIp } from "~/lib/request-ip";
import {
  LINKEDIN_REDIRECT_URI,
  LINKEDIN_TOKEN_ENDPOINT,
  LINKEDIN_USERINFO_ENDPOINT,
  LINKEDIN_STATE_COOKIE,
} from "~/lib/linkedin-oauth";

/**
 * OAuth callback for "Continue with LinkedIn" signup/login.
 *
 * LinkedIn redirects here (full page load) with `?code=...&state=...` after the
 * user consents. The loader runs all of the server-side work:
 *
 *   1. Throttle a known hostile IP out (mirror the Google callback guard)
 *   2. Validate the CSRF `state` nonce against the httpOnly cookie set by
 *      /api/linkedin/start
 *   3. Exchange the authorization code for an access token (LinkedIn token
 *      endpoint)
 *   4. Fetch the user's identity from the OIDC `/v2/userinfo` endpoint
 *   5. Extract the LinkedIn id (sub), verified email, and name
 *   6. Find the user by linkedin_id (linkedin_accounts) or by email (users)
 *   7. Create the user (plan_tier 'basic' by default) / link the account
 *   8. Create a session (same pattern as Google OAuth) and set the session cookie
 *   9. 302 → /onboarding (new user) or /dashboard
 *
 * Env vars (Vercel project settings):
 *   LINKEDIN_CLIENT_ID       — OAuth 2.0 Client ID
 *   LINKEDIN_CLIENT_SECRET   — OAuth 2.0 Client Secret
 *
 * Redirect URI registered in the LinkedIn Developer app:
 *   https://www.contrax.company/auth/linkedin/callback
 */

const SESSION_TTL_DAYS = 30;

interface LinkedInUserInfo {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

// ── Server functions (all OAuth + DB + session work, server-only) ─────────────

/** True when the current request's client IP is on the exact-match blocklist.
 * Mirrors the Google callback guard — see that file's comment for why this
 * lives in a server fn rather than the loader. */
const authCallbackIpBlocked = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return isBlockedIp(getRequest());
  } catch {
    return false; // Fail open: never lock out real users over IP resolution.
  }
});

/** Reads the CSRF nonce cookie set by /api/linkedin/start, inside a server fn
 * (getRequest() is only legal in a server scope for this client-loaded file). */
const readOauthStateCookie = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const req = getRequest();
    const cookieHeader = req.headers.get("cookie") || "";
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === LINKEDIN_STATE_COOKIE) return part.slice(idx + 1).trim();
    }
    return null;
  } catch {
    return null;
  }
});

const handleLinkedInAuth = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { code?: unknown; plan?: unknown };
    if (typeof d.code !== "string" || d.code.length === 0) {
      throw new Error("Missing authorization code");
    }
    // Optional plan carried through OAuth state — only used when a brand-new
    // user is created; existing users keep their current tier. New users default
    // to the free Basic package (no-bifurcation rule).
    const plan =
      typeof d.plan === "string" && ["basic", "starter", "professional", "agency"].includes(d.plan)
        ? d.plan
        : undefined;
    return { code: d.code, plan };
  })
  .handler(async ({ data: { code, plan } }) => {
    const { sql } = await import("~/db");
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET are not configured");
    }

    // 1. Exchange the authorization code for an access token.
    const tokenRes = await fetch(LINKEDIN_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed (${tokenRes.status})`);
    }
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) throw new Error("Token response missing access_token");

    // 2. Fetch the user's OIDC identity (sub = LinkedIn member id, email, name).
    const infoRes = await fetch(LINKEDIN_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) {
      throw new Error(`Userinfo failed (${infoRes.status})`);
    }
    const profile = (await infoRes.json()) as LinkedInUserInfo;

    const linkedinId = profile.sub;
    if (!linkedinId) throw new Error("Userinfo missing subject (sub)");

    // Email authority: LinkedIn returns `email_verified`. We only provision/link
    // by email when LinkedIn has verified it — never trust an unverified email.
    const email = (profile.email ?? "").trim().toLowerCase();
    if (!email) throw new Error("LinkedIn did not return an email");
    if (profile.email_verified !== true) throw new Error("LinkedIn email not verified");

    const name = profile.name ?? profile.given_name ?? null;
    const avatarUrl = profile.picture ?? null;

    // 3. Ensure the linkedin_accounts table exists (idempotent migration).
    await sql()`
      CREATE TABLE IF NOT EXISTS linkedin_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        linkedin_id TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // 4. Find the user: first by linkedin_id, then by verified email.
    let userId: number | null = null;
    const byLinkedIn = await sql()`SELECT user_id FROM linkedin_accounts WHERE linkedin_id = ${linkedinId}`;
    if (byLinkedIn.length > 0) {
      userId = (byLinkedIn[0] as { user_id: number }).user_id;
    } else {
      const byEmail = await sql()`SELECT id FROM users WHERE email = ${email}`;
      if (byEmail.length > 0) {
        userId = (byEmail[0] as { id: number }).id;
      }
    }

    // 5. Create the user if this is a brand-new account. password_hash stays NULL
    //    for LinkedIn-only users; fall back to an unusable placeholder if the DB
    //    enforces NOT NULL.
    let isNewUser = false;
    if (userId === null) {
      isNewUser = true;
      const trialStartedAt = null; // lazy trial start: no trial at signup
      const inserted = await sql()`
        INSERT INTO users (email, password_hash, plan_tier, trial_started_at)
        VALUES (${email}, NULL, 'basic', ${trialStartedAt})
        RETURNING id
      `.catch(async () => {
        const retry = await sql()`
          INSERT INTO users (email, password_hash, plan_tier, trial_started_at)
          VALUES (${email}, ${`oauth:${crypto.randomUUID()}`}, 'basic', ${trialStartedAt})
          RETURNING id
        `;
        return retry;
      });
      userId = (inserted[0] as { id: number }).id;
    }

    // 6. Link the LinkedIn account (for existing users with no row yet).
    await sql()`
      INSERT INTO linkedin_accounts (user_id, linkedin_id, email, name, avatar_url)
      VALUES (${userId}, ${linkedinId}, ${email}, ${name}, ${avatarUrl})
      ON CONFLICT (linkedin_id) DO NOTHING
    `;

    // 7. Create a session — same pattern as Google OAuth / signup.
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

    return { success: true, userId, isNewUser, email };
  });

/**
 * Ties this request's anonymous visitor journey (contrax_vid cookie) to the
 * authenticated account. Runs inside a server fn so `getRequest()` is in a
 * proper server scope. Best-effort / fail-open — never affects the OAuth result.
 */
const linkOAuthVisitor = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { userId: number; email: string })
  .handler(async ({ data }) => {
    try {
      const { sql } = await import("~/db");
      const { backfillVisitorIdentity } = await import("~/lib/identity-backfill");
      const cookie = getRequest().headers.get("cookie") ?? "";
      const vid =
        cookie
          .split(";")
          .map((c) => c.trim())
          .find((c) => c.startsWith("contrax_vid="))
          ?.split("=")[1] ?? "";
      if (!vid) return { linked: false, reason: "no_visitor" };
      await backfillVisitorIdentity(sql, data.userId, data.email, vid);
      return { linked: true };
    } catch {
      return { linked: false, reason: "error" };
    }
  });

// ── Route ─────────────────────────────────────────────────────────────────────

/** Idempotent DDL guard for the funnel-events table (mirrors Google callback) —
 * only needed when a save-to-pipeline intent is completed here. */
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

export const Route = createFileRoute("/auth/linkedin/callback")({
  loader: async ({ location }) => {
    // Throttle a known hostile IP out of the OAuth callback before any code
    // exchange or account/session creation (mirror the Google callback guard).
    let blocked = false;
    try {
      blocked = await authCallbackIpBlocked();
    } catch {
      blocked = false; // Fail open: never crash the callback over IP resolution.
    }
    if (blocked) {
      throw redirect({ href: "/login?error=account_unavailable" });
    }

    const search = new URLSearchParams(location.search);

    // User declined consent on LinkedIn's screen.
    if (search.get("error")) {
      throw redirect({ href: "/login?error=linkedin_denied" });
    }

    const code = search.get("code");
    if (!code) {
      throw redirect({ href: "/login?error=linkedin_missing_code" });
    }

    // CSRF: validate that the nonce in LinkedIn's echoed `state` matches the
    // browser's httpOnly cookie set by /api/linkedin/start. Mismatch → abort.
    let stateNonce: string | null = null;
    let saveBid: number | null = null;
    let next: string | null = null;
    let plan: string | undefined;
    const stateRaw = search.get("state");
    if (stateRaw) {
      try {
        const state = JSON.parse(stateRaw) as {
          nonce?: unknown;
          save_bid?: unknown;
          next?: unknown;
          plan?: unknown;
        };
        if (typeof state.nonce === "string") stateNonce = state.nonce;
        const sb = Number(state.save_bid);
        if (Number.isInteger(sb) && sb > 0) saveBid = sb;
        if (typeof state.next === "string") next = state.next;
        if (typeof state.plan === "string") plan = state.plan;
      } catch {
        // Malformed state — the nonce check below will fail; login aborts.
        stateNonce = null;
      }
    }

    let expectedNonce: string | null = null;
    try {
      expectedNonce = await readOauthStateCookie();
    } catch {
      expectedNonce = null;
    }
    // Reject when there's no state nonce, no cookie, or they don't match.
    if (!stateNonce || !expectedNonce || stateNonce !== expectedNonce) {
      throw redirect({ href: "/login?error=linkedin_state_mismatch" });
    }

    let userId: number | null = null;
    let isNewUser = false;
    let userEmail: string | null = null;
    try {
      const result = await handleLinkedInAuth({ data: { code, plan } });
      userId = result.userId;
      isNewUser = result.isNewUser;
      userEmail = result.email ?? null;
    } catch (err) {
      console.error("[linkedin-auth] callback failed:", err);
      throw redirect({ href: "/login?error=linkedin_auth_failed" });
    }

    // Tie this request's anonymous visitor journey (contrax_vid cookie) to the
    // authenticated account. Fail-open — never affects the redirect below.
    if (userId !== null && userEmail) {
      linkOAuthVisitor({ data: { userId, email: userEmail } }).catch(() => {
        /* best-effort */
      });
    }

    // Complete the save-to-pipeline intent server-side (best-effort). Mirrors
    // the Google callback.
    if (saveBid !== null && userId !== null) {
      try {
        const { sql } = await import("~/db");
        await saveMatch(userId, saveBid);
        await ensureFunnelEventsTable();
        await sql()`
          INSERT INTO funnel_events (event_name, label, path, user_agent)
          VALUES ('save_success', ${String(saveBid)}, ${safeNext(next)}, 'linkedin-oauth-callback')
        `;
      } catch (err) {
        console.error("[linkedin-auth] save-to-pipeline failed:", err);
      }
    }

    // Mirrors Google: new users land on /onboarding; returning users and
    // save-to-pipeline intents keep their existing destinations.
    const dest =
      saveBid !== null
        ? safeNext(next) ?? "/dashboard"
        : isNewUser
          ? "/onboarding"
          : safeNext(next) ?? "/dashboard";
    throw redirect({ href: dest });
  },
  component: () => null, // Never rendered — the loader always redirects.
  head: () => ({
    meta: [
      { title: "Signing you in… | Contrax" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
