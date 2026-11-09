/**
 * Opportunity gap map (owner 2026-11-09, "I want all the ideas"): for one trade, where federal
 * agencies spend the most, how much goes to small-business set-asides, which agencies buy it,
 * how many contracts end in the next year and how many companies hold the work now. States with
 * big spending and few companies holding it are flagged as openings. PURE.
 *
 * Sources (all public USAspending.gov data, synced weekly by src/jobs/federal-trade-sync.ts):
 *   - federal_trade_spending: last complete fiscal year, per trade and state;
 *   - recompete_contracts: active contracts ending in the next 18 months, with the holder.
 * State level only: USAspending's place of performance is not stored by county.
 */
import { STATE_NAMES } from "~/lib/contract-map";

export interface GapStateInput {
  state: string;
  spend: number;
  setAsideSpend: number;
  topAgencies: { name: string; amount: number }[];
  /** Contracts ending in the next 12 months, and their value. */
  ending12: number;
  ending12Value: number;
  /** Distinct companies holding the trade's active contracts in the state (18-month window). */
  holders: number;
}

export type GapLabel = "opening" | "crowded" | "small";

export interface GapState extends GapStateInput {
  name: string;
  setAsideShare: number;
  /** Federal spend per company already holding work there: higher = less crowded. */
  spendPerHolder: number;
  label: GapLabel;
  /** 0-100, for ranking: spend per holder (50%), small-business share (30%), contracts ending (20%). */
  score: number;
}

export const GAP_LABELS: Record<GapLabel, { text: string; detail: string; fill: string }> = {
  opening: { text: "Opening", detail: "Big spending, few companies holding the work", fill: "#059669" },
  crowded: { text: "Crowded", detail: "Big spending, many companies already in", fill: "#d97706" },
  small: { text: "Small market", detail: "Less federal spending in this trade", fill: "#94a3b8" },
};

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Share of values at or below `v` (0-1). */
const percentile = (xs: number[], v: number) => (xs.length ? xs.filter((x) => x <= v).length / xs.length : 0);

/** Territories are left out: the map and its medians cover the 50 states and DC. */
const TERRITORIES = new Set(["PR", "GU", "VI", "AS", "MP", "UM", "FM", "MH", "PW", "AA", "AE", "AP"]);

/** Only the 50 states and DC: territories and "foreign" rows are left out. */
export function isGapState(code: string): boolean {
  return code.length === 2 && Boolean(STATE_NAMES[code]) && !TERRITORIES.has(code);
}

export function buildGapMap(inputs: GapStateInput[]): GapState[] {
  const rows = inputs.filter((r) => isGapState(r.state) && r.spend > 0);
  const spends = rows.map((r) => r.spend);
  const perHolder = rows.map((r) => r.spend / Math.max(1, r.holders));
  const shares = rows.map((r) => Math.min(1, Math.max(0, r.setAsideSpend / r.spend)));
  const endings = rows.map((r) => r.ending12);
  const spendMid = median(spends);
  const perHolderMid = median(perHolder);
  return rows
    .map((r, i) => {
      const spendPerHolder = perHolder[i];
      const label: GapLabel = r.spend < spendMid ? "small" : spendPerHolder >= perHolderMid ? "opening" : "crowded";
      const score = Math.round(
        100 * (0.5 * percentile(perHolder, spendPerHolder) + 0.3 * percentile(shares, shares[i]) + 0.2 * percentile(endings, r.ending12)),
      );
      return { ...r, name: STATE_NAMES[r.state], setAsideShare: shares[i], spendPerHolder, label, score };
    })
    .sort((a, b) => b.score - a.score || b.spend - a.spend);
}

/** The best openings: big-spending states with few companies holding the work, best first. */
export function topOpenings(states: GapState[], n = 5): GapState[] {
  return states.filter((s) => s.label === "opening").slice(0, n);
}

/** /contracts-in/{state-slug}/{trade} */
export function stateTradeHref(state: string, trade: string): string {
  const name = STATE_NAMES[state] ?? state;
  return `/contracts-in/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}/${trade}`;
}

export function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
