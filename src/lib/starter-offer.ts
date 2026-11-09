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

// Owner 2026-11-09: Starter is $14 a month (was $19). A Stripe coupon's amount cannot change, so
// the $5 first month uses a new coupon id ($9 off $14).
export const STARTER_FIRST_MONTH_COUPON = "contrax_starter_first_month_5_v2";
/** $14 → $5 for the first month, in cents. */
export const STARTER_FIRST_MONTH_AMOUNT_OFF = 900;
/** The Starter month, in cents. The checkout bills this inline (stripe.ts), never a catalog price. */
export const STARTER_MONTHLY_CENTS = 1400;
/** Veterans (VAD26 partner code) Starter month, in cents (owner 2026-11-09: $10, below the regular $14). */
export const VAD_STARTER_MONTHLY_CENTS = 1000;
/** Starter billed yearly, in dollars: 10 × the month (2 months free). */
export const STARTER_ANNUAL_PRICE = (STARTER_MONTHLY_CENTS * 10) / 100;
export const STARTER_FIRST_MONTH_PRICE = 5;
/** The regular Starter month in dollars ($5 + the $14 first-month coupon); client-safe copy of stripe.ts MONTHLY_PRICE_USD.starter. */
export const STARTER_FULL_PRICE = STARTER_FIRST_MONTH_PRICE + STARTER_FIRST_MONTH_AMOUNT_OFF / 100;

/** Short line under the Starter price. */
/** Owner 2026-10-30: the $5 is now a 30-day pass with no automatic renewal (starter-pass.ts). */
export const STARTER_FIRST_MONTH_NOTE = "$5 one time for 30 days. Nothing renews: on day 30 the pass simply ends, unless you choose Starter at $14/month.";

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

/**
 * A guest's email, when we already have one, pre-fills Stripe's own email box.
 * Owner 2026-11-07 ("Trace it and build it"): the separate "where should we
 * send your 6 AM emails?" box we showed before Stripe (added 2026-11-04) lost
 * every real guest who saw it in 30 days (3 of 3, all on phones), so guests now
 * go straight to Stripe, which collects the email itself. The account is still
 * created from the paid checkout (pay first, account after). PURE.
 */
const GUEST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function guestCheckoutEmail(body: { email?: unknown }): string | null {
  const e = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  return e.length <= 200 && GUEST_EMAIL_RE.test(e) ? e : null;
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
