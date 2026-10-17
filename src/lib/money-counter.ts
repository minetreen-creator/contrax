/**
 * Homepage "money counter" (owner 2026-10-17). Pure and client-safe.
 *
 * HONESTY: only two complete figures are shown — the open-bid count from the
 * contract map, and the USAspending total of federal contracts ending in the
 * next 12 months. Bid `estimated_value` is NOT summed here: under 1% of open
 * bids list one, so a dollar total built from it would mislead.
 */
import type { ContractMapAggregate } from "~/lib/contract-map";

export interface CounterFigures {
  openBids: number;
  endingCount: number;
  endingTotal: number;
}

export type EndingByState = Record<string, { count: number; total: number }>;

/** Figures for the whole country ("" / "US") or one state; zeroes when a state has none. */
export function counterFigures(
  state: string,
  map: ContractMapAggregate | null,
  ending: { count: number; total: number } | null,
  endingByState: EndingByState,
): CounterFigures {
  if (!state || state === "US") {
    return { openBids: map?.totals.totalOpen ?? 0, endingCount: ending?.count ?? 0, endingTotal: ending?.total ?? 0 };
  }
  const e = endingByState[state];
  return { openBids: map?.states[state]?.count ?? 0, endingCount: e?.count ?? 0, endingTotal: e?.total ?? 0 };
}

/** Ease-out cubic: fast start, slow finish, so the last digits "land". */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Value at time `elapsed` of a count from `from` to `to` over `duration` ms. */
export function countAt(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0) return to;
  return Math.round(from + (to - from) * easeOut(elapsed / duration));
}
