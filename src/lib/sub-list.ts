/**
 * Paid local-subcontractor list (owner 2026-10-30: "find me the revenue" →
 * "2,3"). A prime that won work far from home gets its first list free (prime
 * outreach); each list after that is $49, one time. PURE and client-safe.
 */
export const SUB_LIST_PRICE_CENTS = 4900;
export const SUB_LIST_PRODUCT = "sub_list";
export const SUB_LIST_NAME = "Local subcontractor list";
export const SUB_LIST_DESCRIPTION =
  "Local companies in your trade near the job site, with names, websites, phone numbers and addresses, emailed within one business day.";

/** Trimmed, single-spaced, at most 80 characters; null when empty. PURE. */
export function cleanField(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || null;
}
