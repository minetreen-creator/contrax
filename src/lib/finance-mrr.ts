/**
 * MRR aggregation helpers for /api/admin/finance (owner 2026-09-11).
 *
 * Bid Scout is a SEPARATE assisted-service product: its MRR must never be
 * inside the Starter/Professional/Agency buckets and never double-counted.
 * The LIVE Stripe read splits every active subscription by its metadata:
 * product:"bid_scout" (or a bidScoutId) → bidScoutMrr; everything else →
 * existingPlanMrr. totalMrr = existingPlanMrr + bidScoutMrr, and the existing
 * mrrCents field stays the TRUE TOTAL so the MRR card keeps showing the whole
 * picture.
 *
 * Pure module (no DB, no Stripe client) so both the route and the smoke test
 * exercise the identical aggregation.
 */

/** Sum an active Stripe subscription's recurring line items (unit_amount ×
 *  quantity). Non-recurring prices contribute 0 — MRR only counts recurring. */
export function recurringMonthlyAmount(subscription: {
  items?: { data?: { price?: { recurring?: unknown; unit_amount?: number | null } | null; quantity?: number | null }[] };
}): number {
  let total = 0;
  for (const item of subscription.items?.data ?? []) {
    const price = item.price;
    if (!price?.recurring) continue; // MRR = recurring only
    const amt = Number(price?.unit_amount ?? 0);
    if (amt > 0) total += amt * (item.quantity ?? 1);
  }
  return total;
}

/** True when a Stripe subscription belongs to Bid Scout (metadata marker). */
export function isBidScoutSubscription(subscription: {
  metadata?: { [key: string]: unknown } | null;
}): boolean {
  const md = subscription.metadata ?? {};
  return md.product === "bid_scout" || md.bidScoutId != null;
}

export interface MrrBreakdown {
  /** MRR of existing Contrax plans (Starter/Professional/Agency) — NEVER
   *  contains Bid Scout. */
  existingPlanMrr: number;
  /** MRR of Bid Scout subscriptions only. */
  bidScoutMrr: number;
  /** existingPlanMrr + bidScoutMrr — identical to the response's mrrCents. */
  totalMrr: number;
  /** Distinct customers holding an existing-plan active subscription. */
  existingCustomers: number;
  /** Distinct customers holding a Bid Scout active subscription. */
  bidScoutCustomers: number;
  /** Display lines for the finance panel. The Bid Scout line is separate from
   *  the Starter/Professional/Agency buckets. */
  display: { label: string; amount: number; product: "bid_scout" }[];
}

/** Split an array of active Stripe subscriptions into existing-plan MRR vs
 *  Bid Scout MRR, never double-counting. */
export function computeMrrBreakdown(subs: {
  customer?: unknown;
  metadata?: { [key: string]: unknown } | null;
  items?: { data?: { price?: { recurring?: unknown; unit_amount?: number | null } | null; quantity?: number | null }[] };
}[]): MrrBreakdown {
  let existingPlanMrr = 0;
  let bidScoutMrr = 0;
  const existingCustomers = new Set<string>();
  const bidScoutCustomers = new Set<string>();
  for (const s of subs) {
    const custId =
      typeof s.customer === "string" ? s.customer : (s.customer as { id?: unknown } | undefined)?.id;
    const amt = recurringMonthlyAmount(s as never);
    if (isBidScoutSubscription(s as never)) {
      bidScoutMrr += amt;
      if (custId != null) bidScoutCustomers.add(String(custId));
    } else {
      existingPlanMrr += amt;
      if (custId != null) existingCustomers.add(String(custId));
    }
  }
  return {
    existingPlanMrr,
    bidScoutMrr,
    totalMrr: existingPlanMrr + bidScoutMrr,
    existingCustomers: existingCustomers.size,
    bidScoutCustomers: bidScoutCustomers.size,
    display: [{ label: "Bid Scout MRR", amount: bidScoutMrr, product: "bid_scout" }],
  };
}