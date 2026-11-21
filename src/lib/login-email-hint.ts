/**
 * The email someone typed on /signup when we told them the account already exists (owner
 * 2026-11-21). /login reads it once and clears it. Session storage, this tab only: it is never
 * put in the address, where it would be logged with the page view. PURE (no storage access here).
 */
export const LOGIN_EMAIL_HINT_KEY = "contrax_login_email_hint";

/** The hint if it looks like an email, else "". */
export function cleanLoginEmailHint(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}
