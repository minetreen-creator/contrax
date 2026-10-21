/**
 * Starter first-month offer (CEO pricing call 2026-10-21, owner: "you can
 * change prices"): a new monthly Starter subscription pays $5 for its first
 * month, then the normal $19 a month. Applied at checkout as a one-time Stripe
 * coupon ($14 off the first invoice), so the subscription's price stays $19
 * and finance MRR is unchanged after month one.
 *
 * PURE and client-safe: the copy shown on /pricing, /upgrade and the paywalls,
 * and the rule for which checkouts get it. The coupon lives in stripe.ts.
 */

export const STARTER_FIRST_MONTH_COUPON = "contrax_starter_first_month_5_v1";
/** $19 → $5 for the first month, in cents. */
export const STARTER_FIRST_MONTH_AMOUNT_OFF = 1400;
export const STARTER_FIRST_MONTH_PRICE = 5;

/** Short line under the Starter price. */
export const STARTER_FIRST_MONTH_NOTE = "$5 for your first month, then $19/month. Cancel anytime.";

/**
 * Monthly Starter subscriptions only: not yearly (already 2 months free), not
 * the VAD partner price, and not one-time payments.
 */
export function starterFirstMonthApplies(opts: {
  planTier: string;
  interval: "month" | "year";
  mode: "subscription" | "payment";
  vad: boolean;
}): boolean {
  return opts.planTier === "starter" && opts.interval === "month" && opts.mode === "subscription" && !opts.vad;
}
