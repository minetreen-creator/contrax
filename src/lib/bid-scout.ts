/**
 * Bid Scout — $99/mo recurring match-report product (owner spec 2026-09-10).
 *
 * Phase A scope (purchase path + intake/sales pages ONLY):
 *   - Shared validation schema for the /bid-scout intake form.
 *   - Checkout-session creation: writes the PENDING `bid_scout_subscriptions`
 *     row FIRST (so a lost webhook can never lose a lead), then creates ONE
 *     Stripe Checkout Session against the PERMANENT price (env
 *     STRIPE_BID_SCOUT_PRICE_ID — never created per-checkout), then stores the
 *     session id back on the row.
 *   - Webhook event dispatch (consumed by the EXISTING Stripe webhook handler
 *     in src/lib/stripe.ts — no second webhook endpoint):
 *       checkout.session.completed (metadata.product === "bid_scout")
 *           → status 'active' + customer/subscription ids
 *       customer.subscription.deleted → status 'cancelled'
 *       invoice.payment_failed        → status 'past_due'
 *       invoice.paid                  → status 'past_due' → 'active' (owner
 *           rule 2026-09-11: ONLY when the subscription carries
 *           product:"bid_scout" AND the record is currently past_due — never
 *           reactivates a cancelled record, never touches non-Bid-Scout
 *           invoices, never affects existing Contrax plans)
 *     All transitions are idempotent (guarded UPDATEs) — repeated deliveries
 *     never double-process.
 *
 * Phase B analytics: `bid_scout_purchased` is written SERVER-SIDE ONLY here,
 * inside the SAME transition guard (a delivery that actually flips
 * pending→active writes the event; a replay matches no row and writes
 * nothing — repeated webhook deliveries cannot create duplicate purchase
 * events). The event is a standalone timeline/audit record: it NEVER
 * synthesizes radar_completed / signup_completed / activated / paid and has
 * NO stage membership in any existing funnel.
 *
 * This module does NOT touch the Radar funnel, trial gating, entitlements,
 * the signed Radar handoff, existing plans, or any attribution cookie —
 * acquisition attribution stays on the visitor row untouched (the Bid Scout
 * CTA `source` is stored separately on the subscription row).
 */

import Stripe from "stripe";
import { sql } from "~/db";
import { getStripe } from "~/lib/stripe";
import { z } from "zod";
import { handleIntake } from "~/lib/tracking-intake";
import { getCookieValue } from "~/lib/attribution";
import { VISITOR_COOKIE_NAME } from "~/lib/visitor";

// ── Price ────────────────────────────────────────────────────────────────────
//
// ONE permanent recurring Stripe Price ("Contrax Bid Scout", $99.00/month).
// The price object itself is created ONCE in the Stripe dashboard (never in
// code, never per-checkout); its id lives in the STRIPE_BID_SCOUT_PRICE_ID
// env var (Vercel prod + local test). The unit_amount below is a guard/audit
// constant only — it is logged when the env price's amount differs.
export const BID_SCOUT_PRICE_USD = 9900; // $99.00 / month
export const BID_SCOUT_PRICE_NAME = "Contrax Bid Scout";

// ── Founders first-five offer (owner spec 2026-09-11) ────────────────────────
//
// The first five successful Bid Scout subscriptions get $50 off the FIRST
// invoice (month 1 = $49, month 2+ = $99). The single source of truth for
// concurrency is Stripe: one Promotion Code per environment whose coupon is
// amount_off=$50, duration=once, and whose max_redemptions=5 bounds the whole
// promotion. This module NEVER creates coupons or promotion codes — it only
// RETRIEVES the pre-created code (scripts/create-bid-scout-founders-offer.ts
// is the one-time setup; the owner created the live + test codes 09-11).
export const BID_SCOUT_FOUNDERS_LIMIT = 5; // max_redemptions (concurrency authority)
export const BID_SCOUT_FOUNDERS_DISCOUNT_AMOUNT = 5_000; // $50 off the first invoice
export const BID_SCOUT_FOUNDERS_FIRST_TOTAL = 4_900; // $49 — first invoice total
export const BID_SCOUT_FOUNDERS_RENEWAL_USD = BID_SCOUT_PRICE_USD; // 9_900 — month 2+

export interface BidScoutFoundersOffer {
  /** True only when the promotion code exists, is active, AND redemptions remain. */
  available: boolean;
  /** The env promotion code id (null when STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID unset). */
  promotionCodeId: string | null;
  /** max(0, max_redemptions − times_redeemed). */
  remaining: number;
  /** Stripe-reported times_redeemed (0 when the env id is unset/unreachable). */
  timesRedeemed: number;
  /** Stripe-reported max_redemptions (BID_SCOUT_FOUNDERS_LIMIT default). */
  maxRedemptions: number;
}

/** Narrow Stripe surface for the founders-offer read (GET /v1/promotion_codes/:id). */
export interface BidScoutPromoRetrieveLike {
  promotionCodes: {
    retrieve: (id: string) => Promise<{
      id: string;
      active: boolean | null;
      max_redemptions: number | null;
      times_redeemed: number | null;
    }>;
  };
}

/**
 * Retrieve-only founders availability read (owner spec §3). Reads
 * STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID; when absent the offer is simply
 * unavailable (standard $99 path — the live default until the owner wires the
 * id). Never creates or mutates pricing objects. Fail-safe: any retrieve error
 * logs and returns unavailable so checkout can never be blocked by the offer
 * machinery.
 */
export async function getBidScoutFoundersOffer(
  stripe?: (BidScoutStripeLike & BidScoutPromoRetrieveLike) | BidScoutStripeLike | null,
): Promise<BidScoutFoundersOffer> {
  const id = process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID;
  if (!id) {
    return { available: false, promotionCodeId: null, remaining: 0, timesRedeemed: 0, maxRedemptions: BID_SCOUT_FOUNDERS_LIMIT };
  }
  try {
    const client = (stripe ?? getStripe()) as BidScoutStripeLike & BidScoutPromoRetrieveLike;
    const promo = await client.promotionCodes.retrieve(id);
    const maxRedemptions = promo.max_redemptions ?? BID_SCOUT_FOUNDERS_LIMIT;
    const timesRedeemed = promo.times_redeemed ?? 0;
    const remaining = Math.max(0, maxRedemptions - timesRedeemed);
    const available = promo.active === true && remaining > 0;
    return { available, promotionCodeId: id, remaining, timesRedeemed, maxRedemptions };
  } catch (err) {
    console.error(
      "[bid-scout] founders promo retrieve failed (fail-safe to standard $99):",
      (err as Error).message,
    );
    return { available: false, promotionCodeId: id, remaining: 0, timesRedeemed: 0, maxRedemptions: BID_SCOUT_FOUNDERS_LIMIT };
  }
}

/** NARROW classifier for "the promotion/the coupon can no longer be redeemed".
 *  Matches ONLY the exact Stripe error codes the checkout create emits when a
 *  promo is exhausted/deleted between our retrieve and the session create:
 *    promotion_code_used_up        — ACTUAL code observed on apiVersion
 *                                    2024-12-18.acacia test mode: session
 *                                    create with an exhausted code throws
 *                                    StripeInvalidRequestError,
 *                                    code="promotion_code_used_up",
 *                                    "This promotion code has been used up."
 *                                    (verified 2026-09-11 with a real
 *                                    max_redemptions=1 code exhausted by a
 *                                    real paid invoice).
 *    promotion_code_max_redemptions_reached — spec-listed code (other Stripe
 *                                    surfaces/versions); kept per owner spec.
 *    coupon_max_redemptions_reached — spec-listed code; kept per owner spec.
 *    resource_missing               — the promo/coupon no longer exists
 *                                    (observed: StripeInvalidRequestError with
 *                                    code="resource_missing").
 *  Any other error (card, param, network…) returns false and rethrows upstream. */
const PROMO_UNAVAILABLE_CODES = new Set([
  "promotion_code_used_up",
  "promotion_code_max_redemptions_reached",
  "coupon_max_redemptions_reached",
  "resource_missing",
]);

export function isPromotionUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown };
  return typeof e.code === "string" && PROMO_UNAVAILABLE_CODES.has(e.code);
}

export function getBidScoutPriceId(): string {
  const id = process.env.STRIPE_BID_SCOUT_PRICE_ID;
  if (!id) {
    throw new Error(
      "STRIPE_BID_SCOUT_PRICE_ID is not set — set it to the permanent " +
        '"Contrax Bid Scout" $99/mo recurring Stripe Price id (see ' +
        "db/migrations/035_bid_scout_subscriptions.sql header + .env.example).",
    );
  }
  return id;
}

// ── Validation ───────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Loose sanity check — accepts bare domains and URLs; we never fetch it. */
const WEBSITE_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i;
/** CTA source param, e.g. ?source=dashboard — stored in the `source` column
 *  (Bid Scout placement, NOT first-touch acquisition attribution). */
const SOURCE_PATTERN = /^[a-z0-9_-]{1,64}$/i;

export const bidScoutCheckoutSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  email: z.string().trim().toLowerCase().regex(EMAIL_PATTERN).max(254),
  capabilities: z.string().trim().min(1, "Core capabilities are required").max(2000),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  naicsCodes: z.string().trim().max(500).optional().or(z.literal("")),
  certifications: z.string().trim().max(500).optional().or(z.literal("")),
  targetStates: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  source: z.string().trim().max(64).optional().or(z.literal("")),
});

export type BidScoutCheckoutInput = z.input<typeof bidScoutCheckoutSchema>;

/** Normalized shape consumed by createBidScoutCheckoutSession — optional
 *  free-text fields are null (never empty strings), CTA source is validated
 *  against its pattern (default when absent/invalid). */
export interface BidScoutNormalizedInput {
  companyName: string;
  email: string;
  capabilities: string;
  website: string | null;
  naicsCodes: string | null;
  certifications: string | null;
  targetStates: string | null;
  notes: string | null;
  source: string;
}

/** Coerce optional free-text fields to null (never empty strings in the DB),
 *  and normalize the CTA source (whitelist-ish pattern, default used when the
 *  param is absent/invalid). */
export function normalizeBidScoutInput(
  input: BidScoutCheckoutInput | z.infer<typeof bidScoutCheckoutSchema>,
  defaultSource = "bid_scout_page",
): BidScoutNormalizedInput {
  const d = input as z.infer<typeof bidScoutCheckoutSchema>;
  const website = d.website?.trim() || null;
  const source = d.source?.trim() || defaultSource;
  return {
    companyName: d.companyName,
    email: d.email,
    capabilities: d.capabilities,
    website: website && WEBSITE_PATTERN.test(website) ? website : null,
    naicsCodes: d.naicsCodes?.trim() || null,
    certifications: d.certifications?.trim() || null,
    targetStates: d.targetStates?.trim() || null,
    notes: d.notes?.trim() || null,
    source: SOURCE_PATTERN.test(source) ? source : defaultSource,
  };
}

// ── Checkout session creation ────────────────────────────────────────────────

const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";

/** Invoke-Stripe-shaped surface (real client satisfies it; tests inject a
 *  stub) — keeps this module testable without a live Stripe key. The
 *  sessions.create second arg is the Stripe request options bag (idempotency
 *  key); the real client accepts (params, options?). */
export interface BidScoutStripeLike {
  checkout: {
    sessions: {
      create: (
        params: Stripe.Checkout.SessionCreateParams,
        options?: { idempotencyKey?: string },
      ) => Promise<{
        id: string;
        url: string | null;
      }>;
    };
  };
}

/** Narrow Stripe surface for the invoice.paid ownership/verification step
 *  (GET /v1/subscriptions/:id). The real Stripe client satisfies it
 *  structurally; tests inject a stub. */
export interface BidScoutStripeSubscriptionsLike {
  subscriptions: {
    retrieve: (id: string) => Promise<{
      id: string;
      metadata?: { [key: string]: unknown } | null;
    }>;
  };
}

/** Narrow Stripe surface for the checkout.session.completed derivation (§4):
 *  re-retrieve the completed session so the APPLIED discount comes from
 *  Stripe's authoritative numbers (total_details.amount_discount + amount_total),
 *  never from app metadata. */
export interface BidScoutStripeWebhookLike extends BidScoutStripeSubscriptionsLike {
  checkout: {
    sessions: {
      retrieve: (
        id: string,
        params?: { expand?: string[] },
      ) => Promise<{
        id: string;
        total_details?: { amount_discount?: number | null } | null;
        amount_total?: number | null;
        currency?: string | null;
      }>;
    };
  };
}

export interface CreateBidScoutCheckoutOpts {
  /** Logged-in Contrax user id (from the session cookie) — metadata only. */
  userId?: number | string | null;
  /** Injectable Stripe-like client (defaults to the real getStripe()). */
  stripe?: BidScoutStripeLike;
}

export interface CreateBidScoutCheckoutResult {
  success: boolean;
  url?: string;
  recordId?: string;
  error?: string;
}

/**
 * Create the pending subscription row FIRST, then the Stripe Checkout Session
 * against the permanent price, then persist the session id. The returned URL
 * redirects the customer to Stripe's hosted checkout; the existing webhook
 * handler flips the row to 'active' on checkout.session.completed.
 */
export async function createBidScoutCheckoutSession(
  input: BidScoutNormalizedInput,
  opts: CreateBidScoutCheckoutOpts = {},
): Promise<CreateBidScoutCheckoutResult> {
  const stripe = opts.stripe ?? (getStripe() as BidScoutStripeLike);
  const priceId = getBidScoutPriceId();
  const userId = opts.userId != null && opts.userId !== "" ? String(opts.userId) : null;

  // 1) PENDING record BEFORE any Stripe call — a lost webhook never loses the lead.
  let recordId: string;
  try {
    const rows = (await sql()`
      INSERT INTO bid_scout_subscriptions (
        user_id, email, company_name, website, capabilities,
        naics_codes, certifications, target_states, notes, source, status
      )
      VALUES (
        ${userId ? Number(userId) : null}, ${input.email}, ${input.companyName},
        ${input.website ?? null}, ${input.capabilities},
        ${input.naicsCodes ?? null}, ${input.certifications ?? null},
        ${input.targetStates ?? null}, ${input.notes ?? null}, ${input.source}, 'pending'
      )
      RETURNING id
    `) as Array<{ id: string }>;
    if (rows.length === 0) throw new Error("pending row insert returned no id");
    recordId = rows[0].id;
  } catch (err) {
    console.error("[bid-scout] failed to create pending record:", (err as Error).message);
    return { success: false, error: "Could not save your submission. Please try again." };
  }

  // 2) ONE Checkout Session. Metadata on BOTH the session and
  //    subscription_data so the webhook can always attribute the event.
  //    `offerCandidate` is DIAGNOSTIC ONLY (first_five_49 | standard_99) —
  //    the webhook NEVER infers the applied discount from it; it derives the
  //    stored offer from Stripe's completed session numbers (§4).
  const founders = await getBidScoutFoundersOffer(
    opts.stripe ?? null,
  );
  const makeMetadata = (offerCandidate: "first_five_49" | "standard_99") => {
    const md: Record<string, string> = {
      product: "bid_scout",
      bidScoutId: recordId,
      offerCandidate,
    };
    if (userId) md.user_id = userId;
    return md;
  };

  const baseParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: makeMetadata(founders.available ? "first_five_49" : "standard_99"),
    subscription_data: {
      metadata: makeMetadata(founders.available ? "first_five_49" : "standard_99"),
    },
    success_url: `${BASE_URL}/bid-scout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/bid-scout?checkout=cancelled`,
    customer_email: input.email,
  };
  // Founders offer is AUTOMATIC and capped globally — never user-entered
  // (no allow_promotion_codes) and never per-checkout (no payment_method_types
  // — Stripe's dynamic payment methods stay on).
  const withDiscounts: Stripe.Checkout.SessionCreateParams = founders.available
    ? { ...baseParams, discounts: [{ promotion_code: founders.promotionCodeId! }] }
    : baseParams;

  const persistSession = async (sessionId: string) => {
    await sql()`
      UPDATE bid_scout_subscriptions
      SET stripe_checkout_session_id = ${sessionId}, updated_at = NOW()
      WHERE id = ${recordId}
    `;
  };

  try {
    // First attempt idempotency key (per pending row — unique per attempt).
    const session = await stripe.checkout.sessions.create(withDiscounts, {
      idempotencyKey: `bid-scout-checkout:${recordId}`,
    });

    if (!session.url) {
      return { success: false, error: "Stripe did not return a checkout URL" };
    }

    // 3) Persist the session id (unique — safe to re-set on retry).
    await persistSession(session.id);

    console.log(
      `[bid-scout] checkout session created: record=${recordId} session=${session.id} ` +
        `price=${priceId} offer=${
          founders.available ? "first_five_49" : "standard_99"
        } source=${input.source} user=${userId ?? "anonymous"}`,
    );
    return { success: true, url: session.url, recordId };
  } catch (err) {
    // Founders concurrency race: the retrieve said available, but by the time
    // the session-create landed, Stripe had already granted the 5th (or a
    // previous) redemption. Retry WITHOUT the discount, with a DIFFERENT
    // idempotency key (the params differ, so replaying the original key would
    // be wrong) and offerCandidate standard_99 in BOTH metadata spots.
    if (isPromotionUnavailableError(err)) {
      try {
        const retryMetadata = makeMetadata("standard_99");
        const session = await stripe.checkout.sessions.create(
          {
            ...baseParams,
            metadata: retryMetadata,
            subscription_data: { metadata: retryMetadata },
          },
          { idempotencyKey: `bid-scout-checkout-standard:${recordId}` },
        );
        if (!session.url) {
          return { success: false, error: "Stripe did not return a checkout URL" };
        }
        await persistSession(session.id);
        console.log(
          `[bid-scout] founders promo exhausted at create — retried STANDARD $99 ` +
            `(record=${recordId} session=${session.id} err=${(err as Error).message})`,
        );
        return { success: true, url: session.url, recordId };
      } catch (retryErr) {
        console.error(
          "[bid-scout] standard retry after promo-exhaustion failed:",
          (retryErr as Error).message,
        );
        return {
          success: false,
          error: "Checkout could not be started. Please try again or contact support.",
        };
      }
    }
    console.error("[bid-scout] stripe checkout session failed:", (err as Error).message);
    return {
      success: false,
      error: "Checkout could not be started. Please try again or contact support.",
    };
  }
}

// ── Phase B analytics ──────────────────────────────────────────────────────────

export interface RecordCheckoutStartedOpts {
  /** Bid Scout CTA placement (?source= on the /bid-scout page). */
  sourceLabel?: string;
  /** Logged-in Contrax user id (from the session cookie), when present. */
  userId?: number | string | null;
  /** Business email from the intake form (stamped as the event's user_email). */
  userEmail: string;
}

/**
 * `bid_scout_checkout_started` — fired by the checkout endpoint AFTER
 * validation + rate limits pass, IMMEDIATELY BEFORE the Stripe session
 * creation (i.e. only when the checkout is genuinely starting). Flows through
 * the SAME intake pipeline as every other funnel event (handleIntake →
 * funnel_events): same bot filter, same 1s dedupe, same first-touch
 * acquisition attribution (contrax_attr cookie → query → referer), same
 * geo/device context, same @test.contrax/admin write-time exclusion for the
 * summary row. The visitor's acquisition attribution is resolved from the
 * cookie but NEVER modified — the Bid Scout CTA source lives separately in the
 * subscription row's `source` column. Standalone event name: NO membership in
 * any funnel stage set. Never throws (tracking is fire-and-forget).
 */
export async function recordBidScoutCheckoutStarted(
  request: Request,
  opts: RecordCheckoutStartedOpts,
): Promise<void> {
  try {
    const cookie = request.headers.get("cookie") ?? "";
    const visitorId = getCookieValue(cookie, VISITOR_COOKIE_NAME) ?? undefined;
    const trackReq = new Request("https://www.contrax.company/api/track-visitor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "",
        referer: request.headers.get("referer") ?? "",
        cookie,
        "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
      },
      body: JSON.stringify({
        kind: "event",
        event: "bid_scout_checkout_started",
        label: opts.sourceLabel || "bid_scout_page",
        path: "/bid-scout",
        ...(visitorId ? { visitor_id: visitorId } : {}),
        ...(opts.userId != null && opts.userId !== ""
          ? { user_id: String(opts.userId) }
          : {}),
        user_email: opts.userEmail,
      }),
    });
    await handleIntake(trackReq, "event");
  } catch (trackErr) {
    // Tracking is fire-and-forget by design — a beacon hiccup must never
    // block checkout.
    console.error("[bid-scout] checkout_started event failed (non-fatal):", trackErr);
  }
}

// ── Webhook event dispatch ────────────────────────────────────────────────────

/** Customer email from a completed checkout session (may be null). */
function sessionEmail(session: Stripe.Checkout.Session): string | null {
  const details = (session as { customer_details?: { email?: string | null } | null })
    .customer_details;
  return details?.email ?? session.customer_email ?? null;
}

export interface BidScoutPurchasedEventMeta {
  recordId: string;
  sessionId: string;
  customerEmail?: string | null;
  /** Applied offer DERIVED from Stripe's completed session numbers (§4) —
   *  never from offerCandidate (diagnostic only). */
  offer?: "first_five_49" | "standard_99" | null;
  /** Actually-charged first invoice total (Stripe amount_total, e.g. 4900). */
  firstInvoiceAmount?: number | null;
  /** Recurring amount from the 2nd invoice onward — always $99 (9_900). */
  renewalAmount?: number;
  /** Session invoice currency (e.g. "usd"). */
  currency?: string | null;
}

/**
 * Server-side-only purchase event (Phase B). Written by the webhook handler
 * INSIDE the same transition guard that flips pending→active, so a replayed
 * Stripe delivery can never append a duplicate `bid_scout_purchased` row.
 *
 * The row is a standalone timeline/audit record (NOT a funnel stage): it never
 * synthesizes radar_completed / signup_completed / activated / paid, and no
 * existing funnel queries read this event name. It writes through the same
 * funnel_events table and column set the canonical analytics writer uses; the
 * Stripe signature is the bot/visitor filter — there is no user agent or
 * visitor session on a webhook. user_email is stamped from the customer's
 * checkout email so the standard read-side QA/admin exclusions apply to it.
 *
 * Dedupe: callers only invoke this when the guarded UPDATE actually
 * transitioned a row (RETURNING id non-empty). A second, belt-and-suspenders
 * guard checks for an existing purchase event carrying this record id in its
 * metadata label — permanent (not the 1s intake collapse), because replays
 * arrive at any time.
 */
export async function recordBidScoutPurchasedEvent(
  meta: BidScoutPurchasedEventMeta,
): Promise<boolean> {
  try {
    const existing = (await sql()`
      SELECT 1 FROM funnel_events
      WHERE event_name = 'bid_scout_purchased'
        AND label LIKE ${`%"bidScoutId":"${meta.recordId}"%`}
      LIMIT 1
    `) as Array<{ "?column?": number }>;
    if (existing.length > 0) return true; // already recorded — never duplicate
    const metadata = JSON.stringify({
      product: "bid_scout",
      bidScoutId: meta.recordId,
      stripeSessionId: meta.sessionId,
      amount: BID_SCOUT_PRICE_USD, // nominal recurring price (backward compatible)
      currency: meta.currency ?? "usd",
      renewal_amount: meta.renewalAmount ?? BID_SCOUT_FOUNDERS_RENEWAL_USD, // 9_900 — month 2+
      offer: meta.offer ?? "standard_99", // derived from Stripe numbers, never offerCandidate
      first_invoice_amount: meta.firstInvoiceAmount ?? BID_SCOUT_PRICE_USD, // what was actually charged
    });
    await sql()`
      INSERT INTO funnel_events (
        event_name, label, path, user_agent, ip, referrer,
        source, medium, campaign, click_id,
        visitor_id, visit_id, user_id, user_email,
        city, region, device_type, browser_label
      ) VALUES (
        'bid_scout_purchased', ${metadata}, '/bid-scout',
        NULL, NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, ${meta.customerEmail ?? null},
        NULL, NULL, NULL, NULL
      )`;
    return true;
  } catch (err) {
    console.error("[bid-scout] purchase event write failed:", (err as Error).message);
    return false;
  }
}

/**
 * Consume Stripe events that belong to Bid Scout. Returns TRUE when the event
 * was handled here (caller must stop — it must NOT fall through to the normal
 * Contrax user-plan flow). Returns FALSE for every other event, leaving the
 * existing webhook behavior byte-identical.
 *
 * Idempotency: transitions are guarded (`status <> target`) so repeated
 * deliveries of the same verified event are no-ops.
 *
 * @param event  Verified Stripe event (post constructEvent).
 * @param stripeOverride  Injectable Stripe-like client used ONLY for the
 *   invoice.paid ownership verification (GET subscription). Tests pass a stub;
 *   production callers omit it (defaults to getStripe()).
 */
export async function handleBidScoutSubscriptionEvent(
  event: Stripe.Event,
  stripeOverride?: BidScoutStripeWebhookLike | null,
): Promise<boolean> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.product !== "bid_scout") return false;

    const recordId = session.metadata?.bidScoutId ?? null;
    const subId = typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
    const customerId = typeof session.customer === "string"
      ? session.customer
      : (session.customer?.id ?? null);

    // ── Founders offer derivation (§4): store what ACTUALLY happened, not
    // what was attempted. Re-retrieve the completed session (expand brings
    // back the subscription + line items) and derive the applied offer from
    // Stripe's authoritative numbers — $50 discount AND $49 total ⇒
    // first_five_49; anything else ⇒ standard_99. offerCandidate metadata is
    // NEVER trusted here (diagnostic only). A retrieve failure leaves the
    // offer columns NULL — we never guess.
    let offerCode: "first_five_49" | "standard_99" | null = null;
    let firstInvoiceAmount: number | null = null;
    let invoiceCurrency: string | null = null;
    try {
      const completed = await (stripeOverride ?? (getStripe() as unknown as BidScoutStripeWebhookLike))
        .checkout.sessions.retrieve(session.id, { expand: ["subscription", "line_items"] });
      const amountDiscount = completed.total_details?.amount_discount ?? 0;
      const amountTotal = completed.amount_total ?? null;
      const foundersApplied =
        amountDiscount === BID_SCOUT_FOUNDERS_DISCOUNT_AMOUNT &&
        amountTotal === BID_SCOUT_FOUNDERS_FIRST_TOTAL;
      offerCode = foundersApplied ? "first_five_49" : "standard_99";
      firstInvoiceAmount = amountTotal;
      invoiceCurrency = completed.currency ?? null;
    } catch (err) {
      console.error(
        "[bid-scout] webhook completed: session retrieve failed — offer columns left NULL (never inferred):",
        (err as Error).message,
      );
    }

    try {
      // Primary path — the pending row id is in session metadata. RETURNING id
      // makes the idempotence seam visible: a delivery that actually performs
      // the pending→active transition returns the row; a REPLAY (status already
      // 'active') matches nothing. The Phase B purchase event is written ONLY
      // inside this guard, so repeated webhook deliveries can never create
      // duplicate bid_scout_purchased rows.
      let transitionedId: string | null = null;
      if (recordId) {
        const updated = (await sql()`
          UPDATE bid_scout_subscriptions
          SET status = 'active',
              stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ${session.id}),
              stripe_customer_id = ${customerId ?? null},
              stripe_subscription_id = ${subId ?? null},
              offer_code = COALESCE(offer_code, ${offerCode ?? null}),
              first_invoice_amount = COALESCE(first_invoice_amount, ${firstInvoiceAmount ?? null}),
              currency = COALESCE(currency, ${invoiceCurrency ?? null}),
              updated_at = NOW()
          WHERE id = ${recordId} AND status <> 'active'
          RETURNING id
        `) as Array<{ id: string }>;
        if (updated.length > 0) transitionedId = updated[0].id;
      } else {
        // Fallback — match by the checkout session id (hand-created links).
        const updated = (await sql()`
          UPDATE bid_scout_subscriptions
          SET status = 'active',
              stripe_customer_id = ${customerId ?? null},
              stripe_subscription_id = ${subId ?? null},
              offer_code = COALESCE(offer_code, ${offerCode ?? null}),
              first_invoice_amount = COALESCE(first_invoice_amount, ${firstInvoiceAmount ?? null}),
              currency = COALESCE(currency, ${invoiceCurrency ?? null}),
              updated_at = NOW()
          WHERE stripe_checkout_session_id = ${session.id} AND status <> 'active'
          RETURNING id
        `) as Array<{ id: string }>;
        if (updated.length > 0) transitionedId = updated[0].id;
      }
      if (transitionedId) {
        await recordBidScoutPurchasedEvent({
          recordId: transitionedId,
          sessionId: session.id,
          customerEmail: sessionEmail(session),
          offer: offerCode ?? undefined,
          firstInvoiceAmount: firstInvoiceAmount,
          renewalAmount: BID_SCOUT_FOUNDERS_RENEWAL_USD,
          currency: invoiceCurrency,
        });
      }
    } catch (err) {
      console.error("[bid-scout] webhook checkout.session.completed failed:", (err as Error).message);
      // The event IS ours (signed + metadata.product === "bid_scout") — the
      // guarded UPDATE simply did nothing (already active) or the DB hiccuped
      // (Stripe will retry). Either way: acknowledge, never fall through.
    }
    return true;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (!isBidScoutSubscription(sub)) return false;
    try {
      await sql()`
        UPDATE bid_scout_subscriptions
        SET status = 'cancelled', updated_at = NOW()
        WHERE stripe_subscription_id = ${sub.id} AND status <> 'cancelled'
      `;
    } catch (err) {
      console.error("[bid-scout] webhook subscription.deleted failed:", (err as Error).message);
      return true; // ours; do not fall through to the user-plan flow
    }
    return true;
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subId =
      (invoice as { subscription?: string | null }).subscription ?? null;
    if (!subId) return false;
    try {
      await sql()`
        UPDATE bid_scout_subscriptions
        SET status = 'past_due', updated_at = NOW()
        WHERE stripe_subscription_id = ${subId} AND status IN ('active', 'pending')
      `;
    } catch (err) {
      console.error("[bid-scout] webhook invoice.payment_failed failed:", (err as Error).message);
    }
    // We consumed the event ONLY if the subscription actually belongs to a
    // bid_scout_subscriptions row — otherwise leave it for the existing flow.
    return hasBidScoutSubscription(subId);
  }

  if (event.type === "invoice.paid") {
    // Owner rule (2026-09-11): recovery for Bid Scout ONLY. Apply when the
    // Stripe subscription carries product:"bid_scout" and the current record
    // is 'past_due' → 'active'. MUST never reactivate a cancelled record and
    // MUST never affect existing Contrax plans (non-Bid-Scout invoices fall
    // through untouched — no update, not consumed as Bid Scout).
    const invoice = event.data.object as Stripe.Invoice;
    const subId =
      (invoice as { subscription?: string | null }).subscription ?? null;
    if (!subId) return false;
    try {
      // 1) Resolve the record by stripe_subscription_id (only the Bid Scout
      //    checkout ever writes these rows). No row → not ours → fall through.
      if (!(await hasBidScoutSubscription(subId))) return false;
      // 2) Verify the LIVE subscription (or its metadata) carries
      //    product:"bid_scout" BEFORE acting. Fail-closed: an API error must
      //    never reactivate (the outer handler acknowledges with no action).
      if (!(await isBidScoutSubscriptionByStripe(subId, stripeOverride ?? null))) {
        return false;
      }
      // 3) past_due → active ONLY. cancelled/pending/active rows match nothing
      //    (a cancelled record stays cancelled; an active record stays active).
      await sql()`
        UPDATE bid_scout_subscriptions
        SET status = 'active', updated_at = NOW()
        WHERE stripe_subscription_id = ${subId} AND status = 'past_due'
      `;
    } catch (err) {
      console.error("[bid-scout] webhook invoice.paid failed:", (err as Error).message);
      return false;
    }
    return true;
  }

  return false;
}

/** Re-query helper for invoice.payment_failed ownership. */
async function hasBidScoutSubscription(subId: string | null): Promise<boolean> {
  if (!subId) return false;
  try {
    const rows = await sql()`
      SELECT id FROM bid_scout_subscriptions
      WHERE stripe_subscription_id = ${subId} LIMIT 1
    `;
    return rows.length > 0;
  } catch (err) {
    console.error("[bid-scout] ownership check failed:", (err as Error).message);
    return false;
  }
}

/** A subscription belongs to Bid Scout when its checkout metadata says so
 *  (checkout.session.completed set the same metadata on subscription_data). */
function isBidScoutSubscription(sub: Stripe.Subscription): boolean {
  const md = sub.metadata ?? {};
  return md.product === "bid_scout" || md.bidScoutId != null;
}

/** Owner rule (2026-09-11) invoice.paid verification: confirm the LIVE
 *  Stripe subscription (or its metadata) carries product:"bid_scout" before
 *  reactivating a past_due record. Fail-closed — any API error returns
 *  false so we NEVER reactivate without verification. */
async function isBidScoutSubscriptionByStripe(
  subId: string,
  stripeOverride: BidScoutStripeSubscriptionsLike | null,
): Promise<boolean> {
  try {
    const stripe =
      stripeOverride ??
      (getStripe() as unknown as BidScoutStripeSubscriptionsLike);
    const sub = await stripe.subscriptions.retrieve(subId);
    const md = sub.metadata ?? {};
    return md.product === "bid_scout" || md.bidScoutId != null;
  } catch (err) {
    console.error(
      "[bid-scout] stripe subscription verify failed (fail-closed):",
      (err as Error).message,
    );
    return false;
  }
}