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
 *  stub) — keeps this module testable without a live Stripe key. */
export interface BidScoutStripeLike {
  checkout: {
    sessions: {
      create: (params: Stripe.Checkout.SessionCreateParams) => Promise<{
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
  const metadata: Record<string, string> = {
    product: "bid_scout",
    bidScoutId: recordId,
  };
  if (userId) metadata.user_id = userId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: `${BASE_URL}/bid-scout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/bid-scout?checkout=cancelled`,
      customer_email: input.email,
    });

    if (!session.url) {
      return { success: false, error: "Stripe did not return a checkout URL" };
    }

    // 3) Persist the session id (unique — safe to re-set on retry).
    await sql()`
      UPDATE bid_scout_subscriptions
      SET stripe_checkout_session_id = ${session.id}, updated_at = NOW()
      WHERE id = ${recordId}
    `;

    console.log(
      `[bid-scout] checkout session created: record=${recordId} session=${session.id} ` +
        `price=${priceId} source=${input.source} user=${userId ?? "anonymous"}`,
    );
    return { success: true, url: session.url, recordId };
  } catch (err) {
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
      amount: BID_SCOUT_PRICE_USD,
      currency: "usd",
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
  stripeOverride?: BidScoutStripeSubscriptionsLike | null,
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