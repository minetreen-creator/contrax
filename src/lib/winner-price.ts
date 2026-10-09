/**
 * WINNER-PRICE LINE — "Last time this was bid: won by … for $…" (owner 2026-10-09).
 *
 * The owner's question: "What did the winner bid last time?" The honest,
 * already-available answer next to an OPEN bid is: WHO won the prior contract
 * for the same work and WHAT they were paid — never a bidder-by-bidder
 * tabulation. Full tabulations (losing bids, per-item prices) are explicitly
 * OUT of scope for this feature: the federal sources Contrax already reads
 * (FPDS / USASpending.gov, SAM.gov Award Notices) publish winner + amount +
 * date AT BEST, and a "N bidders / low $X / high $Y" claim is only ever made
 * from stored per-bidder rows, which this line never invents.
 *
 * PURE MODULE — no DB, no network, no UI. It DERIVES NOTHING but a selection
 * between figures the publisher already published:
 *   - a stored SAM.gov Award Notice (bid_award_checks, via ~/lib/award-check
 *     types) is preferred when one exists for the bid — it is the exact
 *     published winner/amount/date for that solicitation;
 *   - otherwise the FPDS/USAspending intel the surface ALREADY lazy-loaded
 *     (~/lib/fpds.FPDSIntel): the incumbent recipient + the obligated amount of
 *     the award we surfaced, with the fiscal year of its period-of-performance
 *     start (the same Oct–Sep fiscal-year rule fpds.ts uses for its yearly
 *     buckets);
 *   - when that award carries no usable amount, the most recent published
 *     fiscal-year bucket is used and the line SAYS SO ("across N awards in
 *     FY…") — a sum of published amounts is never presented as a single award.
 *
 * HONESTY RULES (non-negotiable):
 *   - never invent a name or an amount; no name + no positive amount ⇒ null
 *     (the surface keeps its existing "not available" state);
 *   - every rendered figure is the publisher's own — the line is labelled
 *     "as published by FPDS / USASpending.gov" / "as published by SAM.gov"
 *     by the caller, and nothing is rounded away from what the publisher said.
 *
 * ENTITLEMENT (owner decision, binding 2026-10-09): the winner-price line
 * unlocks at STARTER ($19) — the first paid tier — the SAME rule the paid head
 * start and the calendar feed use (`hasPaidBidAccess` → `hasUnlimitedSaves`;
 * see ~/lib/head-start.server and ~/lib/trial). It is deliberately NOT the
 * Radar Pro ($79) gate that IncumbentCard still uses. `paidAccess` is resolved
 * server-side by that one rule and passed in; this module only decides what to
 * RENDER from it (winnerPriceViewState), so there is no second copy of the rule.
 */
import type { FPDSIntel } from "~/lib/fpds";

/** Provenance note for the federal sources this line quotes. */
export const WINNER_PRICE_SOURCE_NOTE = "As published by FPDS / USASpending.gov";
/** Provenance note used when the figure comes from a SAM.gov Award Notice. */
export const WINNER_PRICE_SAM_NOTE = "As published by SAM.gov";

/** The stored-award shape we accept — structurally compatible with
 *  `AwardResult` in ~/lib/award-check (`awardeeName`/`amount`/`awardDate`), so
 *  the daily award-check job's own names feed this line unchanged. */
export interface WinnerPriceAward {
  awardeeName: string;
  /** Dollars, null when the publisher stated none. */
  amount: number | null;
  /** YYYY-MM-DD, null when not published. */
  awardDate?: string | null;
}

/** Where the amount on the line came from. */
export type WinnerPriceBasis = "award" | "fiscal_year_total";

export interface WinnerPrice {
  /** The winner, exactly as the publisher spells it. */
  winner: string;
  /** Dollars, the publisher's own figure (never rounded, never invented). */
  amount: number;
  /** Fiscal year the amount belongs to, or null when the source states no date. */
  fiscalYear: number | null;
  /** "award" = one published award amount; "fiscal_year_total" = the published
   *  total of several awards in that fiscal year (the count is then stated). */
  basis: WinnerPriceBasis;
  /** Awards behind a "fiscal_year_total" figure; null for a single award. */
  awardCount: number | null;
  /** "sam" = SAM.gov Award Notice; "fpds" = FPDS / USASpending.gov. */
  source: "sam" | "fpds";
}

/**
 * Fiscal year of an ISO date, using the federal Oct–Sep boundary (October
 * belongs to the NEXT fiscal year). This is the same rule ~/lib/fpds applies to
 * its yearly buckets, so the year on this line agrees with the intel it came
 * from. Returns null for an absent/unparseable date — never a guessed year.
 */
export function fiscalYearOf(date: string | null | undefined): number | null {
  const s = String(date ?? "").trim();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return month >= 10 ? year + 1 : year;
}

/** "$1,234,567" — the publisher's dollars, exactly as far as display goes (no
 *  abbreviation, so nothing about the figure is softened or rounded away). */
export function formatWinnerPriceAmount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function positiveAmount(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Derive the winner-price line from data the surface already has. Pure.
 *
 * @param intel   the FPDS/USAspending intel already lazy-loaded for this bid
 *                (may be null — "no intel" ⇒ no line, never a fabricated one).
 * @param award   a stored SAM.gov Award Notice for this bid, when one exists.
 *                Preferred: it is the exact published winner + amount + date.
 * @returns the line's data, or null when no honest line can be drawn.
 */
export function deriveWinnerPrice(
  intel: FPDSIntel | null | undefined,
  award?: WinnerPriceAward | null,
): WinnerPrice | null {
  // 1. A stored SAM.gov Award Notice wins — exact published winner/amount/date.
  const samName = String(award?.awardeeName ?? "").trim();
  const samAmount = positiveAmount(award?.amount);
  if (samName && samAmount != null) {
    return {
      winner: samName,
      amount: samAmount,
      fiscalYear: fiscalYearOf(award?.awardDate),
      basis: "award",
      awardCount: null,
      source: "sam",
    };
  }
  // 2. The incumbent award FPDS/USAspending already reported for this scope.
  const name = String(intel?.incumbent_name ?? "").trim();
  if (!name) return null; // no winner → no line. Never a placeholder name.
  const obligated = positiveAmount(intel?.total_obligated);
  if (obligated != null) {
    return {
      winner: name,
      amount: obligated,
      fiscalYear: fiscalYearOf(intel?.pop_start_date),
      basis: "award",
      awardCount: null,
      source: "fpds",
    };
  }
  // 3. No single usable award amount → the most recent published fiscal-year
  //    bucket, stated as such (a total across awards, never "for $X").
  const buckets = (intel?.historical_pricing ?? [])
    .map((b) => ({ fiscal_year: Number(b?.fiscal_year), amount: positiveAmount(b?.total_obligated), count: Number(b?.award_count) }))
    .filter((b): b is { fiscal_year: number; amount: number; count: number } => b.amount != null && Number.isFinite(b.fiscal_year))
    .sort((a, b) => b.fiscal_year - a.fiscal_year);
  const latest = buckets[0];
  if (!latest) return null; // nothing published → no line.
  return {
    winner: name,
    amount: latest.amount,
    fiscalYear: latest.fiscal_year,
    basis: "fiscal_year_total",
    awardCount: Number.isFinite(latest.count) && latest.count > 0 ? latest.count : null,
    source: "fpds",
  };
}

/** The rendered sentence: "Won by X for $Y (FY2024)". For a fiscal-year total
 *  the copy says it is a total across awards instead of a single price. */
export function winnerPriceLine(w: WinnerPrice): string {
  const money = formatWinnerPriceAmount(w.amount) ?? "";
  const year = w.fiscalYear != null ? ` (FY${w.fiscalYear})` : "";
  if (w.basis === "fiscal_year_total") {
    const across = w.awardCount != null ? ` across ${w.awardCount} awards` : " across its awards";
    return `Won by ${w.winner} — ${money}${across}${w.fiscalYear != null ? ` in FY${w.fiscalYear}` : ""}`;
  }
  return `Won by ${w.winner} for ${money}${year}`;
}

/** The honest "we have nothing to say" sentence for a notice the sources do not
 *  cover — shown instead of a line that could be mistaken for a real result. */
export const WINNER_PRICE_NONE_COPY =
  "No prior award for this work is in the public records we read yet.";

/** What the caller should render for one bid. */
export type WinnerPriceViewState = "full" | "teaser" | "none";

/**
 * The permit decision, kept PURE so it is testable without a DB or a browser.
 *
 * `paidAccess` is the caller's server-resolved Starter-and-up rule
 * (`hasPaidBidAccess`, ~/lib/head-start.server) — the SAME one rule the paid
 * head start and the calendar feed use; this function never re-derives a plan
 * tier, so no second copy of the pricing rule can drift.
 *
 * `revealed` covers the pre-existing owner-directed free reveals (Radar's
 * SHOW_FREE_INCUMBENT free matches, /awards' first-free / milestone grants):
 * when the SAME card is already showing this viewer the incumbent and the
 * prior award value, the line renders in full rather than pretending to lock
 * something they can already read (never a manufactured wall).
 */
export function winnerPriceViewState(o: {
  hasData: boolean;
  paidAccess: boolean;
  revealed?: boolean;
}): WinnerPriceViewState {
  if (!o.hasData) return "none";
  return o.paidAccess || o.revealed ? "full" : "teaser";
}
