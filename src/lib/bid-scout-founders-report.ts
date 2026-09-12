/**
 * Bid Scout Founders report — shared by the admin API route and the test
 * harness (owner spec 2026-09-11 §6). Kept OUT of src/lib/bid-scout.ts so the
 * checkout/webhook module stays import-safe for client-reachable code; this
 * module is server-only (imported by the admin route + scripts).
 *
 * Semantics (never changes the subscription-table schema):
 *   · Founders spots redeemed: Stripe's authoritative times_redeemed / 5 via
 *     the lib's retrieve (server-side only).
 *   · Founders subscriptions: rows with offer_code='first_five_49' in
 *     completed statuses (the webhook writes that code ONLY when Stripe
 *     reported a $50 discount AND a $49 total — never from offerCandidate).
 *   · First-month MRR-equivalent: the SUM of first_invoice_amount for those
 *     rows — i.e. $49 per founder sub's FIRST paid invoice ONLY.
 *   · Contracted recurring MRR: $99 × EVERY active subscription. A founder
 *     sub is NEVER $49 MRR after its first invoice — the run rate is $99.
 */
import { sql } from "~/db";
import { qaUserExclusionSQL } from "~/lib/qa-exclusion";
import { ADMIN_EMAILS } from "~/lib/admin";
import {
  getBidScoutFoundersOffer,
  BID_SCOUT_PRICE_USD,
} from "~/lib/bid-scout";

/** Completed statuses — a completed checkout's offer fields exist only for
 *  rows that reached the webhook transition (pending rows have NULLs and do
 *  not count as founder subscriptions or first-month MRR). */
const COMPLETED_STATUSES = ["active", "past_due", "cancelled"];

export interface BidScoutFoundersReport {
  promo: {
    promotionCodeId: string;
    maxRedemptions: number;
    timesRedeemed: number;
    remaining: number;
    available: boolean;
  } | null;
  foundersSubscriptions: number;
  /** Sum of actual first-invoice totals for founder subs ($49 each). */
  firstMonthMrrCents: number;
  activeSubscriptions: number;
  /** $99 × every active subscription — never the first-invoice amount. */
  contractedRecurringMrrCents: number;
}

export async function getBidScoutFoundersReport(): Promise<BidScoutFoundersReport> {
  const qaExcl = qaUserExclusionSQL("");
  const adminConds =
    ADMIN_EMAILS.size === 0
      ? "TRUE"
      : ([...ADMIN_EMAILS].map((e) => `LOWER(COALESCE(email, '')) <> '${e.toLowerCase()}'`).join(" AND "));

  const foundersRows: any[] = await sql()`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(first_invoice_amount), 0)::int AS first_month_cents
    FROM bid_scout_subscriptions
    WHERE offer_code = 'first_five_49'
      AND status = ANY(${COMPLETED_STATUSES})
      AND ${sql().unsafe(qaExcl)}
      AND ${sql().unsafe(adminConds)}`;
  const foundersSubscriptions = Number(foundersRows?.[0]?.n ?? 0);
  const firstMonthMrrCents = Number(foundersRows?.[0]?.first_month_cents ?? 0);

  const activeRows: any[] = await sql()`
    SELECT COUNT(*)::int AS n
    FROM bid_scout_subscriptions
    WHERE status = 'active'
      AND ${sql().unsafe(qaExcl)}
      AND ${sql().unsafe(adminConds)}`;
  const activeSubscriptions = Number(activeRows?.[0]?.n ?? 0);
  const contractedRecurringMrrCents = activeSubscriptions * BID_SCOUT_PRICE_USD;

  const offer = await getBidScoutFoundersOffer();
  const promo = offer.promotionCodeId
    ? {
        promotionCodeId: offer.promotionCodeId,
        maxRedemptions: offer.maxRedemptions,
        timesRedeemed: offer.timesRedeemed,
        remaining: offer.remaining,
        available: offer.available,
      }
    : null;

  return {
    promo,
    foundersSubscriptions,
    firstMonthMrrCents,
    activeSubscriptions,
    contractedRecurringMrrCents,
  };
}