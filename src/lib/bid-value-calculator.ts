/**
 * Bid value calculator for /pricing (owner 2026-10-27, after reviewing a
 * competitor's revenue scenario): the visitor enters their own numbers and sees
 * what extra bids could be worth in a year next to the Starter price.
 *
 * PURE and client-safe. Every figure comes from the visitor's inputs; nothing
 * here claims Contrax will raise a win rate or produce a set number of bids.
 */

export const STARTER_YEARLY_COST = 19 * 12;

export type BidValueInputs = {
  /** Extra bids a month the visitor thinks they could submit. */
  extraBidsPerMonth: number;
  /** Average job value in dollars. */
  avgJobValue: number;
  /** Win rate as a percent, 0–100. */
  winRatePct: number;
};

export const BID_VALUE_DEFAULTS: BidValueInputs = {
  extraBidsPerMonth: 2,
  avgJobValue: 40_000,
  winRatePct: 25,
};

export const BID_VALUE_LIMITS = {
  extraBidsPerMonth: { min: 0, max: 50 },
  avgJobValue: { min: 0, max: 50_000_000 },
  winRatePct: { min: 0, max: 100 },
} as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeBidValueInputs(raw: BidValueInputs): BidValueInputs {
  return {
    extraBidsPerMonth: clamp(raw.extraBidsPerMonth, BID_VALUE_LIMITS.extraBidsPerMonth.min, BID_VALUE_LIMITS.extraBidsPerMonth.max),
    avgJobValue: clamp(raw.avgJobValue, BID_VALUE_LIMITS.avgJobValue.min, BID_VALUE_LIMITS.avgJobValue.max),
    winRatePct: clamp(raw.winRatePct, BID_VALUE_LIMITS.winRatePct.min, BID_VALUE_LIMITS.winRatePct.max),
  };
}

export type BidValueResult = {
  extraBidsPerYear: number;
  /** Expected extra wins a year (can be fractional). */
  extraWinsPerYear: number;
  /** Expected extra revenue a year, whole dollars. */
  extraRevenuePerYear: number;
  /** How many times the yearly Starter cost the extra revenue covers, whole number. */
  timesStarterCost: number;
};

export function computeBidValue(raw: BidValueInputs): BidValueResult {
  const i = normalizeBidValueInputs(raw);
  const extraBidsPerYear = i.extraBidsPerMonth * 12;
  const extraWinsPerYear = extraBidsPerYear * (i.winRatePct / 100);
  const extraRevenuePerYear = Math.round(extraWinsPerYear * i.avgJobValue);
  return {
    extraBidsPerYear,
    extraWinsPerYear,
    extraRevenuePerYear,
    timesStarterCost: Math.floor(extraRevenuePerYear / STARTER_YEARLY_COST),
  };
}

export function formatDollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "1 job", "4.5 jobs", "0 jobs" — one decimal only when needed. */
export function formatJobs(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${rounded === 1 ? "job" : "jobs"}`;
}
