/**
 * Search title and description for /contracts-in/{state}/{trade} (owner 2026-11-27, "we need more
 * traffic"). A search for "construction bids in South Carolina" returned five competing sites and
 * not this page. Theirs lead with the number of open bids and the month; ours said
 * "Construction Government Contracts in South Carolina" and gave no number. The count is the
 * page's own (`RegionTradeData.count`, in-state bids only), never an estimate. PURE.
 */
export interface RegionTradeHeadInput {
  label: string;
  name: string;
  count: number;
  /** ISO time the page's data was read. */
  generatedAt?: string | null;
}

/** "Nov 2026" in Eastern time; "" when the time is missing or unreadable. */
export function headMonth(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/New_York" });
}

/** "November 27" in Eastern time; "" when unknown. */
export function headDay(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });
}

export function regionTradeTitle(d: RegionTradeHeadInput): string {
  if (d.count > 0) {
    const month = headMonth(d.generatedAt);
    return `${d.count.toLocaleString("en-US")} ${d.label} ${d.count === 1 ? "Bid" : "Bids"} Open in ${d.name}${month ? ` (${month})` : ""} | Contrax`;
  }
  return `${d.label} Bids in ${d.name}: Government Contracts | Contrax`;
}

export function regionTradeDescription(d: RegionTradeHeadInput): string {
  const trade = /^(HVAC|IT)\b/.test(d.label) ? d.label : d.label.toLowerCase();
  if (d.count > 0) {
    const day = headDay(d.generatedAt);
    return `${d.count.toLocaleString("en-US")} open ${trade} ${d.count === 1 ? "bid" : "bids"} in ${d.name}${day ? ` as of ${day}` : ""}: state, county, city, school and federal jobs, each with its due date. Updated every weekday.`;
  }
  return `Open ${trade} bids and government contracts in ${d.name}, from federal, state and local buyers, each with its due date. New bids are added every weekday.`;
}
