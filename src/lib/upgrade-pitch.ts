/**
 * The personal pitch on /upgrade (owner 2026-10-19, items 1, 2 and 5): instead
 * of a feature list, show a signed-in user what their account actually
 * matched — the new bids since they joined, the ones still in the paid head
 * start, and what contracts in their trade are recently awarded for. Every
 * number comes from real rows; a section with too little data is left out.
 *
 * PURE and client-safe. The queries live in upgrade-pitch.server.ts.
 */
import { headStartUntil } from "./head-start";

export interface PitchBid {
  id: number;
  title: string;
  agency: string | null;
  dueDate: string | null;
  createdAt: string;
}

export interface TypicalAward {
  /** Median award amount in dollars. */
  median: number;
  /** How many awards the median is over. */
  count: number;
  /** "state" when the awards are in the user's states, "national" otherwise. */
  scope: "state" | "national";
}

export interface UpgradePitch {
  /** When the account was created (ISO). */
  since: string;
  /** "janitorial", "trucking"… or null when the profile names no trade. */
  tradeLabel: string | null;
  /** "Virginia", "your 12 states" or null (nationwide). */
  placeLabel: string | null;
  /** New matched bids added since the account was created. */
  newMatches: number;
  /** Up to three of them, newest first. */
  examples: PitchBid[];
  /** Matched bids still inside the paid head start right now. */
  headStart: { count: number; nextOpens: string | null };
  typicalAward: TypicalAward | null;
}

/** Fewest awards a median is shown over. */
export const MIN_AWARDS_FOR_MEDIAN = 5;

/** Median of positive amounts, or null when fewer than MIN_AWARDS_FOR_MEDIAN. */
export function medianAward(amounts: readonly number[]): number | null {
  const xs = amounts.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (xs.length < MIN_AWARDS_FOR_MEDIAN) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** "$85,000", "$1.2M" — whole dollars below a million, one decimal above. */
export function formatDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Bids still members-only, and the soonest one to open for free accounts. */
export function headStartSummary(bids: readonly Pick<PitchBid, "createdAt">[], now: number = Date.now()): UpgradePitch["headStart"] {
  const opens = bids.map((b) => headStartUntil(b.createdAt, now)).filter((u): u is string => !!u).sort();
  return { count: opens.length, nextOpens: opens[0] ?? null };
}

/** "Oct 12" for the "since you joined" line. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "your trade in Virginia", "janitorial in Virginia", "janitorial" or "your trade". */
export function tradePlace(p: Pick<UpgradePitch, "tradeLabel" | "placeLabel">): string {
  const trade = p.tradeLabel || "your trade";
  return p.placeLabel ? `${trade} in ${p.placeLabel}` : trade;
}
