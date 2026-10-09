/**
 * BID TABULATIONS — the surface copy and the two display rules, in one place.
 *
 * CLIENT-SAFE BY CONSTRUCTION: this module is imported by the bid-detail route and
 * its panel component, so it must never import a server module (~/db, ~/lib/trial,
 * Stripe). The entitlement READER lives in gate.server.ts.
 *
 * THE THREE RULES THE COPY ENCODES (owner decisions 2026-10-08/09):
 *   ① A number is only ever shown with its owner: "as published by ALDOT", the
 *      publisher's date, and a link to the publisher's document. Contrax verified
 *      nothing, so the copy never says "verified".
 *   ② The low is called "apparent low, as published" — NEVER "winner" and never
 *      "winning price". It is the smallest amount among the rows we stored, and it
 *      is only claimed when at least one amount was actually stored.
 *   ③ Free sees THAT a tabulation exists and nothing else: no count, no price, no
 *      bidder name. The prices (and the bidder rows) are the Starter-$19 unlock.
 */
import type { MatchKind } from "./join";

/** Free-tier teaser — the ONLY thing an un-entitled visitor is shown. */
export const TABULATIONS_TEASER_HEADLINE = "Prior bid tabulation available";
export const TABULATIONS_TEASER_BODY =
  "ALDOT published a bid tabulation for a previous letting of this work. Bid-by-bid prices are included from the Starter plan.";

/** Starter ($19) paywall copy. The price note is asserted against the ratified
 *  Starter constant in PremiumUpgradeModal by gate.test.ts — the price itself comes
 *  from src/lib/stripe.ts (starter = 1900), never from a string written here. */
export const TABULATIONS_UPGRADE_TITLE = "Upgrade to Starter";
export const TABULATIONS_UPGRADE_CTA = "Upgrade to Starter →";
export const TABULATIONS_PRICE_NOTE = "$19/mo · 14-day Professional trial · Cancel anytime";
export const TABULATIONS_UPGRADE_PATH = "/upgrade";

/** The honesty line under every price. */
export const TABULATIONS_AS_PUBLISHED_NOTE =
  "Amounts are exactly as published by ALDOT in its own tabulation; Contrax has not verified them.";
/** Shown when the publisher's document is a scanned image (owner rule ③). */
export const TABULATIONS_SCANNED_NOTE =
  "Published as a scanned document — prices not machine-readable.";
/** How the low is labelled. Never "winner". */
export const TABULATIONS_LOW_LABEL = "Apparent low, as published";
/** The publisher's own identifier used for the attach, labelled for the reader. */
export const MATCH_KIND_LABELS: Record<MatchKind, string> = {
  reference_number: "matched on ALDOT's own contract number",
  project_number: "matched on ALDOT's own project number",
  predecessor_named: "the new solicitation names its predecessor",
};

export interface TabulationBidderView {
  bidder_name: string;
  bid_amount: string | null;
}

export interface TabulationView {
  id: number;
  source: string;
  reference_number: string | null;
  project_number: string | null;
  agency: string | null;
  title: string | null;
  /** ISO date of the publisher's letting, or null. */
  bid_opened_on: string | null;
  tabulation_type: string | null;
  bidders_count: number | null;
  /** Verbatim decimal strings as stored (NUMERIC read as text), or null. */
  low_amount: string | null;
  high_amount: string | null;
  source_url: string;
  source_published: string | null;
  scanned: boolean;
  extraction_note: string | null;
  match_kind: MatchKind;
  match_value: string;
}

/** "2137726.63" → "$2,137,726.63". A NULL amount renders as nothing at all. */
export function formatPublishedUsd(amount: string | null | undefined): string | null {
  if (amount == null) return null;
  const m = String(amount).trim().match(/^(\d+)\.(\d{2})$/);
  if (!m) return null;
  const whole = m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${m[2]!}`;
}

/** "2026-01-30" → "Jan 30, 2026" (rendered date-only, never shifted by a zone). */
export function formatPublishedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export interface TabulationSummary {
  /** The headline sentence, or the scanned-document sentence. */
  headline: string;
  /** The secondary line naming the high, when there is one. */
  highLine: string | null;
  lowLabel: string | null;
  asPublishedNote: string;
  /** True when at least one bidder amount was actually stored. */
  hasPrices: boolean;
}

/**
 * The publisher's own record, phrased from the STORED set only. If no amount was
 * stored, no low/high is claimed and the headline says so instead of inventing one.
 */
export function tabulationSummary(
  tabulation: TabulationView,
  bidders: TabulationBidderView[],
): TabulationSummary {
  const asPublishedNote = TABULATIONS_AS_PUBLISHED_NOTE;
  const date = tabulation.source_published ?? tabulation.bid_opened_on;
  const dateLabel = formatPublishedDate(date);
  if (tabulation.scanned) {
    return {
      headline: TABULATIONS_SCANNED_NOTE,
      highLine: null,
      lowLabel: null,
      asPublishedNote,
      hasPrices: false,
    };
  }
  const when = dateLabel ? ` (${dateLabel})` : "";
  const lead =
    tabulation.match_kind === "project_number"
      ? `Last time this project was let${when}`
      : `An earlier letting of this contract${when}`;
  const count = tabulation.bidders_count;
  const countLabel = count && count > 0 ? `${count} ${count === 1 ? "bidder" : "bidders"}` : null;
  const priced = bidders.filter((b) => b.bid_amount !== null);
  const low = tabulation.low_amount ?? null;
  const high = tabulation.high_amount ?? null;
  const lowBidder = low === null ? null : priced.find((b) => b.bid_amount === low)?.bidder_name ?? null;
  if (low === null || high === null || priced.length === 0) {
    const detail = countLabel
      ? `${countLabel} — the amounts were not machine-readable`
      : "the amounts were not machine-readable";
    return {
      headline: `${lead}: ${detail}.`,
      highLine: null,
      lowLabel: null,
      asPublishedNote,
      hasPrices: false,
    };
  }
  const lowLabel = formatPublishedUsd(low)!;
  const highLabel = formatPublishedUsd(high)!;
  const lowBy = lowBidder ? ` by ${lowBidder}` : "";
  const headline = `${lead}: ${countLabel ? `${countLabel} — ` : ""}apparent low ${lowLabel}${lowBy}.`;
  const highLine = high === low ? null : `High ${highLabel}.`;
  return { headline, highLine, lowLabel, asPublishedNote, hasPrices: true };
}
