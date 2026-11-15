/**
 * Search pages for contracts ending soon: /contracts-ending/{state}/{trade} (owner 2026-11-14,
 * "Scale Programmatic 'Expiring Contract' SEO Pages"). Six trades in every state and DC. Each page
 * is the public part of a Pipeline Snapshot for that market: the 5 largest contracts ending, what
 * contracts like them were awarded for and 2 open bids. A free account sees 10; the full 25 and the
 * agency breakdown come with Professional or the paid Snapshot. Every figure is a USAspending.gov record; a market
 * with too little to show stays out of search results and out of the sitemap. PURE.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import type { ReportData } from "~/lib/pipeline-report-data.server";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { US_STATES } from "~/lib/states";

/** The six trades that get a page in every state. */
export const ENDING_TRADES = ["janitorial", "hvac", "construction", "landscaping", "security-guard", "it-services"] as const;
/**
 * Trades whose state pages show ending contracts above the open bids (owner 2026-11-15: security
 * guard bids "are very thin"). Guard contracts run for years, so few are open at any moment.
 */
export const ENDING_FIRST_TRADES = ["security-guard"] as const;
/** Shown to everyone. */
export const ENDING_FREE_ROWS = 5;
export const ENDING_FREE_BIDS = 2;
/**
 * What a free account sees (owner 2026-11-14, "1": a free account was getting the 25 contracts and
 * the agency list, two things the $149 Snapshot sells). Visitors see 5, a free account 10, and the
 * full 25 with the agency breakdown is for Professional or the Snapshot. /recompetes uses the same 10.
 */
export const ENDING_ACCOUNT_ROWS = 10;
/** Fewer contracts than this and the page is too thin to list in search. */
export const ENDING_MIN_CONTRACTS = 3;

export const stateSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");
const CODE_BY_SLUG: Record<string, string> = Object.fromEntries(US_STATES.map((c) => [stateSlug(STATE_NAMES[c]), c]));

export interface EndingMarket { code: string; stateName: string; stateSlug: string; trade: string; tradeLabel: string }

/** The market for a URL, or null when the state or trade is not one of ours. Full state names only, so each market has one address. */
export function endingMarket(stateIn: string, tradeIn: string): EndingMarket | null {
  const slug = String(stateIn ?? "").toLowerCase();
  const trade = String(tradeIn ?? "").toLowerCase();
  const code = CODE_BY_SLUG[slug];
  if (!code || !(ENDING_TRADES as readonly string[]).includes(trade)) return null;
  return { code, stateName: STATE_NAMES[code], stateSlug: slug, trade, tradeLabel: SEO_TRADE_BY_SLUG[trade].label };
}

export const endingPath = (stateName: string, trade: string) => `/contracts-ending/${stateSlug(stateName)}/${trade}`;
/** Every address, for the hub page: [state name, trade slug]. */
export const ENDING_STATES: readonly string[] = US_STATES.map((c) => STATE_NAMES[c]).sort();

/** What a visitor without an account is sent. The rest never leaves the server. */
export interface EndingPublic {
  asOf: string;
  until: string;
  totals: ReportData["totals"];
  priceRange: ReportData["priceRange"];
  top: ReportData["largest"];
  /** How many more of the largest contracts the full list holds. */
  more: number;
  agencies: number;
  openBids: ReportData["openBids"];
}

export function publicSlice(r: ReportData): EndingPublic {
  return {
    asOf: r.asOf, until: r.until, totals: r.totals, priceRange: r.priceRange,
    top: r.largest.slice(0, ENDING_FREE_ROWS),
    more: Math.max(0, r.largest.length - ENDING_FREE_ROWS),
    agencies: r.byAgency.length,
    openBids: r.openBids.slice(0, ENDING_FREE_BIDS),
  };
}

/** What a signed-in visitor gets on top. `full` is true for Professional: every row and the agencies. */
export interface EndingFull { full: boolean; largest: ReportData["largest"]; more: number; byAgency: ReportData["byAgency"] }
export function accountSlice(r: ReportData, professional: boolean): EndingFull {
  if (professional) return { full: true, largest: r.largest, more: 0, byAgency: r.byAgency.slice(0, 10) };
  return { full: false, largest: r.largest.slice(0, ENDING_ACCOUNT_ROWS), more: Math.max(0, r.largest.length - ENDING_ACCOUNT_ROWS), byAgency: [] };
}

export const endingIndexable = (p: EndingPublic | null | undefined) => Boolean(p && p.totals.n >= ENDING_MIN_CONTRACTS && p.top.length > 0);

/** "2026-2027", or one year when the window does not cross a new year. */
export function endingYears(asOf: string, until: string): string {
  const a = asOf.slice(0, 4);
  const b = until.slice(0, 4);
  return a === b ? a : `${a}-${b}`;
}

export const endingTitle = (m: EndingMarket, p: EndingPublic | null) =>
  `Expiring Federal ${m.tradeLabel} Contracts in ${m.stateName}${p ? ` (${endingYears(p.asOf, p.until)})` : ""} | Contrax`;

export function endingDescription(m: EndingMarket, p: EndingPublic | null): string {
  const what = `federal ${m.tradeLabel.toLowerCase()} contracts in ${m.stateName}`;
  if (!p || !p.totals.n) return `The ${what} that end in the next 12 months, who holds them and what they were awarded for, from USAspending.gov records.`;
  return `${p.totals.n.toLocaleString("en-US")} ${what} end in the next 12 months. See the largest, who holds them, what contracts like them were awarded for and the open bids that fit. From USAspending.gov records.`;
}
