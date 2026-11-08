/**
 * Incumbent & pricing intel teaser (owner 2026-11-08: "Contextual Intelligence Trigger … a teaser
 * preview of Award Autopsy (past winning price/incumbent) or Re-Compete Radar (contract end date +
 * upcoming re-bids), paired with a blurred preview and an 'Unlock Incumbent & Pricing Intel'
 * button").
 *
 * What a free viewer may learn about a bid's prior federal award: THAT a record exists, the year
 * the current contract ends (and whether that is soon), and how many years of price history are on
 * record. Never the winner's name or any dollar amount: those stay for paid members, and the blurred
 * rows on the page are placeholders, not the real values. PURE.
 */
import type { FPDSIntel } from "~/lib/fpds";

export interface IntelTeaser {
  /** Year the current contract's period of performance ends, when the record has one. */
  endYear: number | null;
  /** The end date is in the future and within 18 months: the work is likely re-bid soon. */
  recompeteSoon: boolean;
  /** The end date has already passed. */
  ended: boolean;
  /** Fiscal years of award history on record. */
  historyYears: number;
}

const RECOMPETE_WINDOW_MS = 548 * 86_400_000; // ~18 months

export function intelTeaser(intel: Pick<FPDSIntel, "pop_end_date" | "historical_pricing"> | null | undefined, now: number = Date.now()): IntelTeaser {
  const end = intel?.pop_end_date ? Date.parse(intel.pop_end_date) : NaN;
  const hasEnd = Number.isFinite(end);
  return {
    endYear: hasEnd ? new Date(end).getUTCFullYear() : null,
    recompeteSoon: hasEnd && end > now && end - now <= RECOMPETE_WINDOW_MS,
    ended: hasEnd && end <= now,
    historyYears: (intel?.historical_pricing ?? []).filter((h) => Number(h.award_count) > 0 || Number(h.total_obligated) > 0).length,
  };
}

/** "Contract ends Nov 2027 · likely re-bid before then" for paid members. PURE. */
export function recompeteLine(popEnd: string | null | undefined, now: number = Date.now()): string | null {
  const end = popEnd ? Date.parse(popEnd) : NaN;
  if (!Number.isFinite(end)) return null;
  const label = new Date(end).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  if (end <= now) return `The prior contract ended ${label}.`;
  if (end - now <= RECOMPETE_WINDOW_MS) return `The current contract ends ${label}: this work is likely to be re-bid before then.`;
  return `The current contract runs to ${label}.`;
}
