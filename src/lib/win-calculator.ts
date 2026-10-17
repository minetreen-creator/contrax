/**
 * "What could you win?" calculator (owner 2026-10-17). Pure and client-safe.
 *
 * Every figure is from USAspending data already synced: last fiscal year's
 * spending for a trade in a state (total, small-business set-aside share, top
 * buyers) and the median value of that trade's federal contracts in the state
 * that are still running. The slider multiplies that median: it is total
 * contract value, not yearly revenue, and the page says so.
 */
import { SEO_TRADES } from "~/lib/seo-trades";
import { US_STATES } from "~/lib/states";
import type { AgencyAmount } from "~/lib/federal-trade-data";

export const MIN_WINS = 1;
export const MAX_WINS = 10;

export interface WinCalculatorResult {
  trade: string;
  state: string;
  fiscalYear: number | null;
  spent: number;
  setAside: number;
  topAgencies: AgencyAmount[];
  typicalContract: number | null;
  contractCount: number;
}

/** Validate an untrusted trade slug + state code; null when either is unknown. */
export function parseCalculatorQuery(trade: unknown, state: unknown): { trade: string; state: string } | null {
  const t = typeof trade === "string" ? trade.trim() : "";
  const s = typeof state === "string" ? state.trim().toUpperCase() : "";
  if (!SEO_TRADES.some((x) => x.slug === t)) return null;
  if (!(US_STATES as readonly string[]).includes(s)) return null;
  return { trade: t, state: s };
}

/** Median of positive amounts, or null with fewer than 3 contracts (too few to call "typical"). */
export function typicalContract(amounts: readonly number[]): number | null {
  const v = amounts.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Slider value clamped to 1–10 whole contracts. */
export function clampWins(n: number): number {
  if (!Number.isFinite(n)) return MIN_WINS;
  return Math.min(MAX_WINS, Math.max(MIN_WINS, Math.round(n)));
}

export function potentialValue(typical: number | null, wins: number): number | null {
  return typical == null ? null : Math.round(typical * clampWins(wins));
}
