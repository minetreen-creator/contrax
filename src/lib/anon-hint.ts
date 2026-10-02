/**
 * KNOWN-ANONYMOUS HINT (owner 2026-10-02 — Vercel CPU).
 *
 * Every page view by a logged-out visitor used to call /api/auth/me (a server
 * function invocation) only to be told 401. When /api/auth/me answers 401 it
 * now also sets a short-lived, NON-httpOnly `contrax_anon=1` cookie; while it
 * is present the browser's getCurrentUser() returns null without the call.
 *
 * Correctness rests on one rule: any response that ISSUES a session cookie
 * also CLEARS the hint. That is enforced in one place, the Vercel launcher
 * (vercel-entry.ts) and the local server (serve.ts), by inspecting the
 * outgoing Set-Cookie headers — so every login path (password, signup,
 * Google, LinkedIn, post-checkout, demo) is covered without touching each.
 * The hint expires after an hour, so at worst a stale hint costs one hour of
 * a signed-out-looking header — and the session cookie itself is never read
 * or written here.
 *
 * PURE module: no DB, no env; safe on both sides of the render.
 */
export const ANON_HINT_COOKIE = "contrax_anon";
export const ANON_HINT_MAX_AGE_SECONDS = 60 * 60;
const SESSION_COOKIE_NAME = "contrax_session";

/** Set-Cookie value that marks this browser as known-anonymous. */
export function anonHintSetCookie(): string {
  return `${ANON_HINT_COOKIE}=1; Max-Age=${ANON_HINT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`;
}

/** Set-Cookie value that removes the hint. */
export function anonHintClearCookie(): string {
  return `${ANON_HINT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}

/** True when the outgoing Set-Cookie list issues a non-empty session cookie. */
export function issuesSession(setCookies: readonly string[]): boolean {
  return setCookies.some((c) => {
    const m = c.match(/^\s*([^=;\s]+)=([^;]*)/);
    return !!m && m[1] === SESSION_COOKIE_NAME && m[2].trim() !== "";
  });
}

/** True when a Cookie header / document.cookie string carries the hint. */
export function hasAnonHint(cookieString: string | null | undefined): boolean {
  if (!cookieString) return false;
  return cookieString.split(";").some((p) => p.trim() === `${ANON_HINT_COOKIE}=1`);
}
