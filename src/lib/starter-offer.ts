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

/**
 * Pay first, account after (CEO 2026-10-22, owner "1"): the signup page lost
 * every visitor who reached it, so a visitor who is NOT signed in may start the
 * monthly Starter checkout directly; Stripe collects the email and the account
 * is created from the paid checkout. Every other plan, interval, promo code or
 * offer still requires an account (owner order 2026-09-18).
 */
export function guestCheckoutAllowed(body: {
  planTier?: string;
  mode?: string;
  interval?: string;
  promoCode?: string;
  founding?: boolean;
}): boolean {
  return (
    body.planTier === "starter" &&
    (body.mode ?? "subscription") === "subscription" &&
    body.interval !== "year" &&
    !body.promoCode &&
    !body.founding
  );
}

export type PostCheckoutAccess =
  | { kind: "login"; userId: number }
  | { kind: "create" }
  | { kind: "sign_in_required" };

/**
 * Who the after-payment page may sign in, given the paid checkout session:
 *  - a checkout started while signed in → that same account, never another one
 *    matched by the email typed on Stripe's page;
 *  - a pay-first checkout → a new account, or the account this checkout's
 *    webhook just created; an email that already had an account must sign in
 *    the normal way (otherwise paying $5 with someone else's email would open
 *    their account).
 * `sessionCreatedMs` and `account.createdAtMs` are epoch milliseconds.
 */
export function postCheckoutAccess(args: {
  metadataUserId: number | null;
  sessionCreatedMs: number;
  account: { id: number; createdAtMs: number } | null;
  metadataAccount: { id: number } | null;
}): PostCheckoutAccess {
  if (args.metadataUserId != null) {
    return args.metadataAccount ? { kind: "login", userId: args.metadataAccount.id } : { kind: "sign_in_required" };
  }
  if (!args.account) return { kind: "create" };
  // A minute of slack: the webhook can create the row a moment before Stripe's
  // own session timestamp is compared, never an older, pre-existing account.
  return args.account.createdAtMs >= args.sessionCreatedMs - 60_000
    ? { kind: "login", userId: args.account.id }
    : { kind: "sign_in_required" };
}

/**
 * Did this paid checkout create the account it is matched to by email (the
 * webhook found the row /post-checkout inserted a moment earlier)? Such an
 * account's password is random, so the welcome email lets the buyer set one.
 * A checkout started while signed in never did; same one-minute rule as
 * postCheckoutAccess, so an older account sharing the email never gets a link.
 */
export function checkoutCreatedAccount(args: {
  metadataUserId: number | null;
  sessionCreatedMs: number;
  account: { id: number; createdAtMs: number };
}): boolean {
  return (
    args.metadataUserId == null &&
    postCheckoutAccess({ ...args, metadataUserId: null, metadataAccount: null }).kind === "login"
  );
}
