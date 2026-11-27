/**
 * The band at the very top of the homepage (owner 2026-11-27: "at the top of the homepage"): one big
 * live number, and under it a search that looks like the product, filled with real open bids.
 * PURE. The number is the same count the bid search prints (contractMap.totals.totalOpen); when it
 * is missing the headline simply has no number. Never a made-up figure.
 */
export const BIG_NUMBER_REST = "government jobs open for bids.";
export const BIG_NUMBER_NO_COUNT = "Government jobs open for bids, in every state.";
export const BIG_NUMBER_SUB = "City, county, school, state and federal work. Search it by your trade and state.";
export const BIG_NUMBER_CTA = "Search open bids";
export const BIG_NUMBER_PRICE_NOTE = "Starter is $9 a month, cancel anytime.";
export const BIG_NUMBER_SEARCH_TEXT = "Open bids by trade and state";
export const BIG_NUMBER_ROWS = 3;

/** "12,345" for a real count; null when there is nothing honest to print. */
export function bigNumber(totalOpen: unknown): string | null {
  const n = Number(totalOpen);
  if (!Number.isFinite(n) || n < 100) return null;
  return Math.floor(n).toLocaleString("en-US");
}

/** "Due Dec 9" from a stored due date; "" when there is none or it cannot be read. */
export function dueShort(due: string | null | undefined): string {
  if (!due) return "";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "";
  return `Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}
