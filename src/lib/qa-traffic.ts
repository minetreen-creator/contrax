/** Explicit QA opt-in for live checks: append ?contrax_qa=1 once. The marker
 * survives navigation for eight hours and affects analytics only, never access
 * or Radar limits. Existing customer history is not changed. */
export const QA_COOKIE = "contrax_qa";
export function hasQaCookie(cookie: string | null | undefined): boolean {
  return (cookie ?? "").split(";").some(part => part.trim() === `${QA_COOKIE}=1`);
}
export function isQaTraffic(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    if (new URL(window.location.href).searchParams.get(QA_COOKIE) === "1") {
      document.cookie = `${QA_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=28800; Secure`;
      return true;
    }
    return hasQaCookie(document.cookie);
  } catch { return false; }
}
