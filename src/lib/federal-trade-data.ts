/**
 * Federal trade data from USAspending.gov (owner 2026-10-13, ideas #1 and #3):
 *
 *  1. Contracts ending soon ("recompetes"): active federal contracts in a trade
 *     whose current end date falls in the next 18 months, with the current
 *     holder and value. An expiring contract is usually rebid, and the rebid
 *     often reaches SAM.gov only weeks before it is due.
 *  2. Spending figures for the state + trade pages: what federal agencies
 *     obligated for a trade in a state in the last complete fiscal year, the
 *     part that went through small-business set-asides, and the top buyers.
 *
 * PURE module (no DB, no fetch): request bodies, row parsers and formatting,
 * shared by the sync job, the pages and the tests. USAspending has no end-date
 * filter, so the sync walks contracts sorted by "End Date" (latest first) and
 * keeps the window it wants.
 */
import { SEO_TRADES } from "~/lib/seo-trades";
import { expandTrade } from "~/lib/trade-registry";

export const USASPENDING_API = "https://api.usaspending.gov/api/v2";

/** Definitive contracts and purchase orders (no IDVs: those are vehicles, not work). */
export const CONTRACT_AWARD_TYPES = ["A", "B", "C", "D"] as const;

/** Smallest contract worth flagging (same floor as award leads). */
export const RECOMPETE_MIN_AMOUNT = 25_000;

/** How far ahead the sync keeps contracts (months). Pages show 6, 12 or 18. */
export const RECOMPETE_WINDOW_MONTHS = 18;
export const RECOMPETE_MONTH_CHOICES = [6, 12, 18] as const;

/**
 * Only contracts with activity in the last this-many years are walked. A
 * contract ending in the next 18 months with no action for 4 years is rare,
 * and the window keeps the walk to a few thousand rows per trade.
 */
export const RECOMPETE_ACTIVITY_YEARS = 4;

/**
 * Construction has no single registry NAICS (it is a keyword trade in Radar),
 * so its federal codes are listed here: building, heavy/civil and
 * specialty-trade construction most often bought by agencies.
 */
const CONSTRUCTION_NAICS = ["236210", "236220", "237110", "237310", "237990", "238990"];

/** NAICS codes per SEO trade slug, from the same registry Radar uses. */
export const FEDERAL_TRADE_NAICS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  SEO_TRADES.map((t) => [t.slug, t.slug === "construction" ? CONSTRUCTION_NAICS : expandTrade(t.radarTerm).naicsCodes]),
);

/**
 * Small-business set-aside codes as USAspending reports them (type_of_set_aside):
 * total and partial small business, reserved, 8(a), HUBZone, SDVOSB, WOSB/EDWOSB
 * and the VA veteran set-asides, competed and sole source.
 */
export const SMALL_BUSINESS_SET_ASIDE_CODES = [
  "SBA", "SBP", "RSB", "8A", "8AN", "HZC", "HZS", "SDVOSBC", "SDVOSBS",
  "WOSB", "WOSBSS", "EDWOSB", "EDWOSBSS", "VSA", "VSS",
] as const;

// ─── Dates ────────────────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return iso(target);
}

/**
 * The latest federal fiscal year whose data is complete. A fiscal year ends
 * September 30; Defense contract reports post up to 90 days late, so a year
 * counts as complete from January 1 after it ends.
 */
export function lastCompleteFiscalYear(today: string): number {
  const d = new Date(`${today}T00:00:00Z`);
  // On or after Jan 1 of year Y, FY Y-1 (Oct Y-2 .. Sep Y-1) is complete.
  return d.getUTCFullYear() - 1;
}

export function fiscalYearRange(fy: number): { start_date: string; end_date: string } {
  return { start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` };
}

/** "October 2024 to September 2025" */
export function fiscalYearLabel(fy: number): string {
  return `October ${fy - 1} to September ${fy}`;
}

// ─── Contracts ending soon ────────────────────────────────────────────────────

export const RECOMPETE_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Recipient UEI",
  "Award Amount",
  "Start Date",
  "End Date",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Description",
  "Place of Performance State Code",
  "NAICS",
  "generated_internal_id",
] as const;

/**
 * USAspending's search stops at 10,000 results (100 pages of 100). Each trade is
 * walked per NAICS code and per contract-size band so no single walk reaches
 * that cap before it reaches today's date.
 */
export const RECOMPETE_PAGE_CAP = 100;
// USAspending takes whole dollars only (a decimal bound is a 422). Neighbouring
// bands share their boundary dollar; the sync de-duplicates by award key.
export const RECOMPETE_AMOUNT_BANDS: readonly { lower_bound: number; upper_bound?: number }[] = [
  { lower_bound: RECOMPETE_MIN_AMOUNT, upper_bound: 100_000 },
  { lower_bound: 100_000, upper_bound: 1_000_000 },
  { lower_bound: 1_000_000 },
];

export function recompeteRequestBody(
  naics: readonly string[],
  page: number,
  today: string,
  band: { lower_bound: number; upper_bound?: number } = { lower_bound: RECOMPETE_MIN_AMOUNT },
) {
  const start = addMonths(today, -12 * RECOMPETE_ACTIVITY_YEARS);
  return {
    filters: {
      award_type_codes: [...CONTRACT_AWARD_TYPES],
      naics_codes: [...naics],
      award_amounts: [{ ...band }],
      time_period: [{ start_date: start, end_date: today }],
    },
    fields: [...RECOMPETE_FIELDS],
    sort: "End Date",
    order: "desc",
    limit: 100,
    page,
    subawards: false,
  };
}

export interface Recompete {
  award_key: string;
  trade_slug: string;
  award_id: string;
  recipient_name: string;
  recipient_uei: string | null;
  amount: number;
  start_date: string | null;
  end_date: string;
  agency: string | null;
  sub_agency: string | null;
  description: string | null;
  pop_state: string | null;
  naics_code: string | null;
  naics_description: string | null;
}

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const isoDate = (v: unknown): string | null => {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const stateCode = (v: unknown): string | null => {
  const s = text(v)?.toUpperCase() ?? null;
  return s && /^[A-Z]{2}$/.test(s) ? s : null;
};

/** One spending_by_award row → a contract, or null when it has no key, holder, end date or is under the floor. */
export function toRecompete(r: Record<string, unknown>, tradeSlug: string): Recompete | null {
  const award_key = text(r.generated_internal_id);
  const recipient_name = text(r["Recipient Name"]);
  const end_date = isoDate(r["End Date"]);
  const amount = Number(r["Award Amount"]);
  if (!award_key || !recipient_name || !end_date || !Number.isFinite(amount) || amount < RECOMPETE_MIN_AMOUNT) return null;
  const naics = r.NAICS;
  let naics_code: string | null = null;
  let naics_description: string | null = null;
  if (naics && typeof naics === "object") {
    naics_code = text((naics as Record<string, unknown>).code);
    naics_description = text((naics as Record<string, unknown>).description);
  } else {
    naics_code = text(naics);
  }
  if (naics_code && !/^\d{2,6}$/.test(naics_code)) naics_code = null;
  return {
    award_key,
    trade_slug: tradeSlug,
    award_id: text(r["Award ID"]) ?? award_key,
    recipient_name,
    recipient_uei: text(r["Recipient UEI"]),
    amount: Math.round(amount),
    start_date: isoDate(r["Start Date"]),
    end_date,
    agency: text(r["Awarding Agency"]),
    sub_agency: text(r["Awarding Sub Agency"]),
    description: text(r.Description),
    pop_state: stateCode(r["Place of Performance State Code"]),
    naics_code,
    naics_description,
  };
}

/**
 * Sorting one page (latest end date first): keep contracts ending inside
 * [today, windowEnd]; `done` once the page reaches dates before today, since
 * every later page ends earlier still.
 */
/**
 * A walk is complete only when it reached a contract ending before today, or
 * when the API said there are no more pages before the 10,000-result cap. A
 * walk that ran into the cap is cut short, even though the API reports no next page.
 */
export function walkComplete(done: boolean, hasNext: boolean, page: number): boolean {
  return done || (!hasNext && page < RECOMPETE_PAGE_CAP);
}

export function pickRecompetes(
  rows: Record<string, unknown>[],
  tradeSlug: string,
  today: string,
  windowEnd: string,
): { kept: Recompete[]; done: boolean } {
  const kept: Recompete[] = [];
  let done = rows.length === 0;
  for (const row of rows) {
    const end = isoDate(row["End Date"]);
    if (end && end < today) {
      done = true;
      continue;
    }
    if (!end || end > windowEnd) continue;
    const c = toRecompete(row, tradeSlug);
    if (c) kept.push(c);
  }
  return { kept, done };
}

// ─── Spending figures ─────────────────────────────────────────────────────────

export function geographyRequestBody(naics: readonly string[], fy: number, setAsideOnly: boolean) {
  return {
    scope: "place_of_performance",
    geo_layer: "state",
    filters: {
      award_type_codes: [...CONTRACT_AWARD_TYPES],
      naics_codes: [...naics],
      time_period: [fiscalYearRange(fy)],
      ...(setAsideOnly ? { set_aside_type_codes: [...SMALL_BUSINESS_SET_ASIDE_CODES] } : {}),
    },
    subawards: false,
  };
}

/** spending_by_geography results → state code → dollars obligated. */
export function parseGeography(results: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(results)) return out;
  for (const r of results as Record<string, unknown>[]) {
    const code = stateCode(r.shape_code);
    const amount = Number(r.aggregated_amount);
    if (code && Number.isFinite(amount)) out.set(code, amount);
  }
  return out;
}

export function agencyRequestBody(naics: readonly string[], fy: number, state: string) {
  return {
    filters: {
      award_type_codes: [...CONTRACT_AWARD_TYPES],
      naics_codes: [...naics],
      time_period: [fiscalYearRange(fy)],
      place_of_performance_locations: [{ country: "USA", state }],
    },
    category: "awarding_agency",
    limit: 3,
    page: 1,
    subawards: false,
  };
}

export interface AgencyAmount {
  name: string;
  amount: number;
}

/** spending_by_category/awarding_agency results → top buyers with positive spend. */
export function parseAgencies(results: unknown): AgencyAmount[] {
  if (!Array.isArray(results)) return [];
  return (results as Record<string, unknown>[])
    .map((r) => ({ name: text(r.name) ?? "", amount: Number(r.amount) }))
    .filter((a) => a.name && Number.isFinite(a.amount) && a.amount > 0)
    .slice(0, 3);
}

export interface TradeSpending {
  trade_slug: string;
  state: string;
  fiscal_year: number;
  total_amount: number;
  set_aside_amount: number;
  top_agencies: AgencyAmount[];
}

/** Share of spending that went through small-business set-asides, 0–100, or null when not meaningful. */
export function setAsideShare(s: Pick<TradeSpending, "total_amount" | "set_aside_amount">): number | null {
  if (!(s.total_amount > 0) || s.set_aside_amount < 0) return null;
  return Math.min(100, Math.round((s.set_aside_amount / s.total_amount) * 100));
}

export function formatDollars(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)} billion`;
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Public USAspending page for an award, so every row can be checked. */
export const awardUrl = (awardKey: string) => `https://www.usaspending.gov/award/${encodeURIComponent(awardKey)}`;

/** /recompetes deep link for a trade and state. */
export function recompetesHref(tradeSlug: string, state: string | null, months = 12): string {
  const p = new URLSearchParams({ trade: tradeSlug, months: String(months) });
  if (state) p.set("state", state);
  return `/recompetes?${p.toString()}`;
}
