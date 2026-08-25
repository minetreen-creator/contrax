/**
 * LinkedIn OAuth helpers for "Continue with LinkedIn" signup/login — Sign In
 * with LinkedIn using OpenID Connect.
 *
 * Modern LinkedIn Sign-In is OIDC; the legacy `r_liteprofile` / `r_emailaddress`
 * Member API scopes are deprecated for new apps. The minimal current scopes
 *
 *     openid profile email
 *
 * return a stable member id (`sub`), the member's name, and — most important —
 * a LinkedIn-VERIFIED email address via the `/v2/userinfo` endpoint. We treat
 * that email authority exactly like Google OAuth: it is only used for account
 * creation / linking when LinkedIn reports it verified (`email_verified`).
 *
 * Env vars (set in Vercel project settings — Settings → Environment Variables):
 *   LINKEDIN_CLIENT_ID       — OAuth 2.0 Client ID (LinkedIn Developer app)
 *   LINKEDIN_CLIENT_SECRET   — OAuth 2.0 Client Secret (LinkedIn Developer app)
 *
 * Only `LINKEDIN_CLIENT_ID` is needed on the initiation side (it is not secret —
 * it ships in every OAuth client). The client secret is used exclusively by the
 * token exchange in `/auth/linkedin/callback`.
 *
 * Redirect URI registered in the LinkedIn Developer app must be exactly:
 *   https://www.contrax.company/auth/linkedin/callback
 */
import { createServerFn } from "@tanstack/react-start";

export const LINKEDIN_REDIRECT_URI = "https://www.contrax.company/auth/linkedin/callback";
export const LINKEDIN_AUTH_ENDPOINT = "https://www.linkedin.com/oauth/v2/authorization";
export const LINKEDIN_TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";
export const LINKEDIN_USERINFO_ENDPOINT = "https://api.linkedin.com/v2/userinfo";
export const LINKEDIN_SCOPES = "openid profile email";

/** httpOnly cookie that holds the OAuth CSRF nonce for the in-flight request. */
export const LINKEDIN_STATE_COOKIE = "linkedin_oauth_state";
/** Nonce/cookie lifetime (10 min) — must outlive the round-trip to LinkedIn. */
export const LINKEDIN_STATE_TTL_SECONDS = 60 * 10;

/**
 * Client-facing availability probe. Returns the relative OAuth-initiation path
 * (`/api/linkedin/start`) when `LINKEDIN_CLIENT_ID` is configured, or null when
 * the env var is absent.
 *
 * This is the "gate until keys arrive" hook: the LinkedIn button renders on the
 * signup/login pages but stays disabled (never building a broken OAuth URL)
 * while this returns null. The moment the owner adds `LINKEDIN_CLIENT_ID`, the
 * whole flow becomes active with no further code change — the server reads the
 * env var at request time.
 */
export const getLinkedInAuthUrl = createServerFn({ method: "GET" }).handler(async () => {
  return process.env.LINKEDIN_CLIENT_ID ? "/api/linkedin/start" : null;
});
