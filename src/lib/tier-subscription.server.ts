/**
 * Contrax PLAN TIERS (Starter $19 / Professional $79 / Agency $199) — Stripe
 * subscription LIFECYCLE HARDENING (owner order 2026-09-18; queued as bfcc0c18,
 * starts after the Bid Scout invoice_payment.paid fix #400/53afe46).
 *
 * WHERE TIER STATE LIVES (verified by reading the code — see the PR data-model
 * note): there is NO tier subscriptions table. The three paid ladder tiers are
 * stored ON THE `users` ROW, which the verified webhook is the only writer of:
 *
 *   users.plan_tier                       'starter' | 'professional' | 'agency'
 *                                         ('basic' = the free tier, 'demo' =
 *                                         internal demo account)
 *   users.subscription_status             Stripe subscription status
 *   users.stripe_customer_id              Stripe customer
 *   users.stripe_subscription_id          Stripe subscription (migration 006)
 *   users.subscription_current_period_end TIMESTAMPTZ (migration 042, NEW here)
 *   users.trial_started_at                cleared by a completed checkout
 *
 * Access is decided by `plan_tier` (see TIER_ORDER in src/lib/trial.ts), so the
 * ONLY way a lifecycle event can revoke access is to downgrade the plan:
 *
 *   revoke  → plan_tier = 'basic'   (statuses canceled / incomplete_expired /
 *                                    unpaid / paused / incomplete)
 *   keep    → plan_tier untouched   (active / trialing / past_due — a failed
 *                                    payment is a grace state, not a downgrade;
 *                                    Stripe's retries either recover the invoice
 *                                    (invoice.paid) or end the subscription
 *                                    (customer.subscription.deleted), which is
 *                                    when access actually goes away)
 *
 * Conventions MIRRORED EXACTLY from the two product-line handlers
 * (src/lib/grants-subscription.server.ts and src/lib/bid-scout.ts):
 *
 *   • Narrow, verified Stripe surface — only the events the owner's live webhook
 *     endpoint is configured with (webauth we_1UH6Tv…): customer.subscription
 *     .updated / .deleted, invoice.paid, invoice_payment.paid,
 *     invoice.payment_failed. `checkout.session.completed` is DELIBERATELY NOT
 *     handled here — the existing user-plan flow in src/lib/stripe.ts owns it
 *     byte-identically (it is the only path that mints a session token and the
 *     welcome email).
 *   • Fail-closed attribution, never fabricated — an event is acted on ONLY when
 *     it resolves to a Contrax user (a) whose stored `stripe_subscription_id` IS
 *     this subscription, or (b) whose id is carried in the SUBSCRIPTION's own
 *     metadata together with a valid tier `plan_tier` (metadata only our server
 *     can write) AND whose stored subscription id is empty or this one. No
 *     email matching, no customer-id guessing: a Stripe CUSTOMER can be shared
 *     between a tier plan and a Grants subscription (getOrCreateCustomer reuses
 *     users.stripe_customer_id), so customer-id attribution could write one
 *     product line's state onto another's. Unresolvable → log + NO write.
 *   • Never affects the other product lines — the Grants and Bid Scout handlers
 *     run FIRST and consume their own events; this module only ever touches the
 *     `users` row, never grants_subscriptions / bid_scout_subscriptions, and it
 *     returns false for every event it does not positively own.
 *   • Replay-safe & no-op-free — a delivery that would not change any stored
 *     value performs NO write at all (see shouldWriteTransition), so Stripe
 *     retries and replays are free and idempotent.
 *   • The pure decision helpers are exported so `bun test` can prove every
 *     transition (including the fail-closed paths) with no database and no
 *     Stripe key; the Neon store and the Stripe client are injected/lazy.
 *
 * NO pricing changes, NO Grants changes, NO Bid Scout changes.
 */
import type Stripe from "stripe";
import { sql } from "~/db";

// ── Constants ─────────────────────────────────────────────────────────────────

/** The three paid ladder tiers (matching PlanTier in src/lib/stripe.ts minus
 *  `savings_premium`, which is a one-time price and therefore has no
 *  subscription lifecycle at all). */
export const TIER_PLANS = ["starter", "professional", "agency"] as const;

export type TierPlan = (typeof TIER_PLANS)[number];

/** The free tier — the plan_tier a cancelled/lapsed tier user is downgraded to. */
export const FREE_PLAN_TIER = "basic";

/**
 * Statuses we are willing to STORE. The same eight Stripe subscription statuses
 * the product-line tables accept (see the CHECK in migration 041/039). Anything
 * else is logged and ignored — an unknown status never overwrites a known one.
 */
export const TIER_KNOWN_STATUSES: readonly string[] = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
];

/**
 * Statuses that mean "this subscription no longer entitles the customer", so the
 * stored plan_tier is downgraded to the free tier. Fail-closed by construction:
 * only `active` and `trialing` keep a paid tier, everything else that is a known
 * status revokes.
 */
export const TIER_REVOKING_STATUSES: readonly string[] = [
  "canceled",
  "incomplete_expired",
  "unpaid",
  "paused",
  "incomplete",
];

/** Statuses that keep the stored plan tier (paying, or grace). */
export const TIER_ENTITLED_STATUSES: readonly string[] = ["active", "trialing"];

/**
 * The events this module consumes. `invoice_paid` naming note: the owner's live
 * webhook endpoint is configured with `invoice_payment.paid`; `invoice.paid` is
 * kept as a backward-compatible alias — both mean "an invoice was paid".
 */
export const TIER_HANDLED_EVENTS: readonly string[] = [
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice_payment.paid",
  "invoice.paid",
  "invoice.payment_failed",
];

/**
 * Base URL for Stripe redirect targets — the SAME env-aware pattern the other
 * Stripe modules use (PROD_URL with the production host fallback).
 */
const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";

// ── Pure decision helpers (unit-tested) ───────────────────────────────────────

/** True for one of the three paid ladder tiers. Fail-closed: anything else
 *  (null, 'basic', 'demo', 'savings_premium', a number, an object) is false. */
export function isTierPlan(value: unknown): value is TierPlan {
  return (
    typeof value === "string" && (TIER_PLANS as readonly string[]).includes(value)
  );
}

/** True for a status we are willing to store. */
export function isKnownTierStatus(status: unknown): status is string {
  return typeof status === "string" && TIER_KNOWN_STATUSES.includes(status);
}

/** True when a stored/incoming status no longer entitles the customer. */
export function isRevokingTierStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TIER_REVOKING_STATUSES.includes(status);
}

/**
 * Product markers that belong to the OTHER product lines. A subscription that
 * carries one of these can never be attributed to a Contrax user PLAN, so this
 * module can not touch a Grants or Bid Scout subscription's lifecycle.
 */
export const OTHER_PRODUCT_MARKERS: readonly string[] = ["grants", "bid_scout"];

/**
 * True when a SUBSCRIPTION's metadata proves it belongs to a plan tier: it
 * carries a valid tier `plan_tier` and is NOT tagged with another product line's
 * marker. Only our own server (createCheckoutSession) can write these fields.
 */
export function isTierSubscriptionMetadata(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  if (!metadata) return false;
  const product = metadata.product;
  if (typeof product === "string" && OTHER_PRODUCT_MARKERS.includes(product)) {
    return false;
  }
  return isTierPlan(metadata.plan_tier);
}

export interface TierBillingTransition {
  /** The value to store in users.subscription_status. */
  status: string;
  /**
   * The tier to store in users.plan_tier, or null to LEAVE the stored plan
   * untouched (the handler then leaves the column alone — never guessed).
   */
  planTier: string | null;
}

/**
 * The stored-state transition a lifecycle event implies. Pure — the handler only
 * persists the result (and decides whether it changes anything at all).
 *
 * @param incomingStatus  the subscription's status (subscription events only)
 * @param metadataPlanTier the tier carried in the subscription's own metadata
 *
 * Returns null when the event implies NO state change (an unknown status on an
 * update, or an event type this module does not map) — the caller then logs and
 * writes nothing.
 */
export function tierBillingAfterEvent(
  eventType: string,
  incomingStatus?: string | null,
  metadataPlanTier?: unknown,
): TierBillingTransition | null {
  switch (eventType) {
    case "customer.subscription.updated": {
      // Never guess a status: an unknown value leaves the stored state alone.
      if (!isKnownTierStatus(incomingStatus)) return null;
      if (isRevokingTierStatus(incomingStatus)) {
        return { status: incomingStatus, planTier: FREE_PLAN_TIER };
      }
      // Entitled or grace (past_due): keep access. A tier carried in the
      // subscription's own metadata reflects a plan change (e.g. via the
      // Customer Portal); without one the stored tier stays as it is.
      return {
        status: incomingStatus,
        planTier: isTierPlan(metadataPlanTier) ? metadataPlanTier : null,
      };
    }
    case "customer.subscription.deleted":
      // Cancellation revokes access immediately (the plan is downgraded).
      return { status: "canceled", planTier: FREE_PLAN_TIER };
    case "invoice.paid":
    case "invoice_payment.paid":
      // Payment succeeded → active. The tier is never inferred from an invoice;
      // it is only adopted when the subscription's own metadata carries it.
      return {
        status: "active",
        planTier: isTierPlan(metadataPlanTier) ? metadataPlanTier : null,
      };
    case "invoice.payment_failed":
      // Grace state: the customer keeps their tier while Stripe retries.
      return { status: "past_due", planTier: null };
    default:
      return null;
  }
}

/** The billing fields this module reads from / writes to `users`. */
export interface TierBillingRow {
  id: number;
  plan_tier?: string | null;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  subscription_current_period_end?: string | Date | null;
}

/**
 * True when applying `transition` to `row` would actually change something.
 * Replay-safety: a second delivery of the same event (or any delivery whose
 * values are already stored) performs NO database write at all.
 */
export function shouldWriteTransition(
  row: TierBillingRow,
  transition: TierBillingTransition,
  input: {
    /** The subscription the event is about (fills an empty stored id only). */
    subscriptionId?: string | null;
    /** ISO period end, when the event carried one. */
    currentPeriodEnd?: string | null;
  } = {},
): boolean {
  if (row.subscription_status !== transition.status) return true;
  if (transition.planTier != null && row.plan_tier !== transition.planTier) return true;
  const subscriptionId = input.subscriptionId ?? null;
  if (subscriptionId != null && !row.stripe_subscription_id) return true;
  const currentPeriodEnd = input.currentPeriodEnd ?? null;
  if (currentPeriodEnd != null && periodEndValue(row) !== currentPeriodEnd) return true;
  return false;
}

/** Stored period end normalised to ISO (or null) for comparison. */
function periodEndValue(row: TierBillingRow): string | null {
  const raw = row.subscription_current_period_end ?? null;
  if (raw == null) return null;
  return raw instanceof Date ? raw.toISOString() : String(raw);
}

/** The public billing state of a Contrax user. */
export interface TierBillingState {
  /** The stored plan tier, or null. */
  planTier: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  /** True when the stored tier is one of the three paid ladder tiers. */
  isPaidTier: boolean;
}

/** No-subscription state (no user, no row, or a lookup failure). */
export const NO_TIER_BILLING: TierBillingState = {
  planTier: null,
  status: null,
  currentPeriodEnd: null,
  stripeCustomerId: null,
  isPaidTier: false,
};

/** Normalise a stored row (or its absence) into the public billing state. */
export function evaluateTierBilling(
  row: TierBillingRow | null | undefined,
): TierBillingState {
  return {
    planTier: row?.plan_tier ?? null,
    status: row?.subscription_status ?? null,
    currentPeriodEnd: row ? periodEndValue(row) : null,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    isPaidTier: isTierPlan(row?.plan_tier),
  };
}

/** Stripe unix-seconds period end → ISO string (null when unavailable). */
export function periodEndIso(sub: {
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> };
}): string | null {
  const seconds =
    sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** A Stripe id field as a plain string, or null (ids arrive as a string or an
 *  expanded `{ id }` object depending on the event's expansion). */
function stripeIdOrNull(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

/**
 * The subscription an INVOICE-family event is about, resolved without guessing.
 * Same three-step shape as the Bid Scout resolver (resolveInvoiceEventSubscript
 * ionId in src/lib/bid-scout.ts) and the Grants one:
 *
 *   1. the object itself carries `subscription` (Invoice shape) → use it;
 *   2. an invoice expanded onto the object → use its `subscription`;
 *   3. only an invoice id → ONE verified Stripe read of that invoice. The
 *      Stripe client is loaded lazily, so an event with nothing to resolve never
 *      touches Stripe at all.
 *
 * `invoice_payment.paid` delivers an InvoicePayment, whose documented field set
 * has neither `subscription` nor `customer` — hence step 3. Any other shape (no
 * invoice, no client, a failed read) → null: fail-closed, nothing is written.
 */
export async function resolveTierInvoiceSubscriptionId(
  object: Record<string, unknown>,
  loadStripe: () => Promise<Stripe | undefined>,
): Promise<string | null> {
  const direct = stripeIdOrNull(object.subscription);
  if (direct) return direct;

  const invoice = object.invoice;
  const expanded =
    typeof invoice === "object" && invoice !== null
      ? (invoice as Record<string, unknown>)
      : null;
  const fromExpandedInvoice = expanded ? stripeIdOrNull(expanded.subscription) : null;
  if (fromExpandedInvoice) return fromExpandedInvoice;

  const invoiceId = stripeIdOrNull(invoice);
  if (!invoiceId) return null;
  const stripe = await loadStripe();
  if (!stripe) return null;
  try {
    const fetched = await stripe.invoices.retrieve(invoiceId);
    return stripeIdOrNull((fetched as unknown as { subscription?: unknown }).subscription);
  } catch (err) {
    console.warn(
      `[tier] could not read invoice ${invoiceId} to attribute the event:`,
      (err as Error).message,
    );
    return null;
  }
}

// ── Store (Neon by default; injectable for tests) ─────────────────────────────

export interface TierTransitionWrite {
  userId: number;
  status: string;
  /** null → leave users.plan_tier untouched. */
  planTier: string | null;
  /** Fills an EMPTY users.stripe_subscription_id; never overwrites one. */
  stripeSubscriptionId?: string | null;
  /** ISO period end; null → leave the stored value untouched. */
  currentPeriodEnd?: string | null;
}

export interface TierBillingStore {
  /** The user's own billing row (used by the read path and the portal). */
  getByUserId(userId: number): Promise<TierBillingRow | null>;
  /** The user whose stored subscription IS this subscription id. */
  getBySubscriptionId(subscriptionId: string): Promise<TierBillingRow | null>;
  /** Persist one transition on the user's row. */
  applyTransition(write: TierTransitionWrite): Promise<void>;
}

const neonStore: TierBillingStore = {
  async getByUserId(userId) {
    const rows = (await sql()`
      SELECT id, plan_tier, subscription_status, stripe_customer_id,
             stripe_subscription_id, subscription_current_period_end
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `) as TierBillingRow[];
    return rows[0] ?? null;
  },
  async getBySubscriptionId(subscriptionId) {
    const rows = (await sql()`
      SELECT id, plan_tier, subscription_status, stripe_customer_id,
             stripe_subscription_id, subscription_current_period_end
      FROM users
      WHERE stripe_subscription_id = ${subscriptionId}
      LIMIT 1
    `) as TierBillingRow[];
    return rows[0] ?? null;
  },
  async applyTransition(write) {
    // COALESCE, never overwrite: a null planTier leaves the stored tier alone
    // (e.g. past_due keeps the customer's tier) and stripe_subscription_id is
    // only ever FILLED — an existing, newer subscription id is never clobbered
    // by a late event for an older one. The status is the one field always set.
    await sql()`
      UPDATE users
      SET subscription_status = ${write.status},
          plan_tier = COALESCE(${write.planTier}, plan_tier),
          stripe_subscription_id = COALESCE(stripe_subscription_id, ${write.stripeSubscriptionId ?? null}),
          subscription_current_period_end =
            COALESCE(${write.currentPeriodEnd ?? null}::timestamptz, subscription_current_period_end)
      WHERE id = ${write.userId}
    `;
  },
};

// ── Entitlement / billing read ───────────────────────────────────────────────

/** The billing state of a signed-in user. Fail-closed: any lookup error or
 *  missing user yields the no-subscription state. */
export async function getTierBilling(
  userId: number | null | undefined,
  store: TierBillingStore = neonStore,
): Promise<TierBillingState> {
  if (userId == null) return NO_TIER_BILLING;
  try {
    return evaluateTierBilling(await store.getByUserId(userId));
  } catch (err) {
    console.error(
      "[tier] billing lookup failed (treated as no subscription):",
      (err as Error).message,
    );
    return NO_TIER_BILLING;
  }
}

// ── Stripe calls (lazy import → no module cycle with src/lib/stripe.ts) ───────

async function stripeClient(): Promise<Stripe> {
  const { getStripe } = await import("~/lib/stripe");
  return getStripe();
}

/**
 * The Stripe error a portal session raises when the ACCOUNT has no billing
 * portal configuration. The portal must be configured on the Stripe account
 * before it can be opened by anyone, so this is surfaced as a clear,
 * distinguishable failure instead of a generic 500.
 */
export function isPortalConfigMissingError(err: unknown): boolean {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = (typeof e.message === "string" ? e.message : "").toLowerCase();
  return (
    code === "billing_portal_configuration_missing" ||
    message.includes("no configuration provided") ||
    message.includes("no default configuration") ||
    message.includes("default configuration has not been created")
  );
}

/** The user-facing message when the account's portal configuration is missing. */
export const PORTAL_NOT_CONFIGURED_MESSAGE =
  "Subscription management isn't available yet. Please try again later.";

export interface TierPortalResult {
  success: boolean;
  url?: string;
  error?: string;
  /** Machine-readable code so routes can pick the right status (503 vs 500). */
  code?: "portal_not_configured" | "stripe_error";
}

/**
 * Open the Stripe Customer Portal for a Contrax customer (the "Manage
 * subscription" button on Settings). Requires a stored Stripe customer — a user
 * without one has nothing to manage and is rejected by the route with a 403.
 *
 * The portal CONFIGURATION lives on the Stripe account, not in code: when it has
 * not been created yet, Stripe rejects the call and this returns a clearly
 * labelled `portal_not_configured` failure (never a silent generic error).
 */
export async function createTierPortalSession(
  userId: number,
  deps: { store?: TierBillingStore; stripe?: Stripe } = {},
): Promise<TierPortalResult> {
  try {
    const state = await getTierBilling(userId, deps.store ?? neonStore);
    const customer = state.stripeCustomerId;
    if (!customer) {
      return {
        success: false,
        code: "stripe_error",
        error: "No paid Contrax subscription found for your account.",
      };
    }
    const stripe = deps.stripe ?? (await stripeClient());
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${BASE_URL}/settings`,
    });
    if (!session.url) {
      return { success: false, code: "stripe_error", error: "Stripe did not return a portal URL" };
    }
    console.log(
      `[tier] portal session created: user=${String(userId)} session=${session.id}`,
    );
    return { success: true, url: session.url };
  } catch (err) {
    if (isPortalConfigMissingError(err)) {
      console.error(
        "[tier] billing portal NOT CONFIGURED on the Stripe account:",
        (err as Error).message,
      );
      return {
        success: false,
        code: "portal_not_configured",
        error: PORTAL_NOT_CONFIGURED_MESSAGE,
      };
    }
    console.error("[tier] portal session failed:", (err as Error).message);
    return {
      success: false,
      code: "stripe_error",
      error: "We couldn't open the billing portal. Please try again.",
    };
  }
}

// ── Webhook handling ─────────────────────────────────────────────────────────

export interface TierWebhookDeps {
  store?: TierBillingStore;
  /** Test seam: lets a suite inject a fake Stripe client. */
  stripe?: Stripe;
}

/**
 * Consume the plan-tier lifecycle events from the ONE verified webhook.
 *
 * Returns true when the event belonged to a Contrax plan tier (the caller then
 * stops and never falls through to the checkout-only flow); false for every
 * other event — including an event that DOES look like ours but cannot be
 * attributed to a user, which is logged and writes nothing (fail-closed).
 *
 * The `users` row is the only thing this function ever touches: the Grants and
 * Bid Scout tables are unreachable from here, so neither product line can be
 * affected by a plan-tier event (and vice versa — those handlers run first).
 */
export async function handleTierSubscriptionEvent(
  event: Stripe.Event,
  deps: TierWebhookDeps = {},
): Promise<boolean> {
  if (!TIER_HANDLED_EVENTS.includes(event.type)) return false;

  const store = deps.store ?? neonStore;

  try {
    const isSubscriptionEvent = event.type.startsWith("customer.subscription.");

    let subscriptionId: string | null = null;
    let incomingStatus: string | null = null;
    let metadataPlanTier: unknown = undefined;
    let currentPeriodEnd: string | null = null;
    let subscriptionMetadata: Stripe.Metadata | null = null;

    if (isSubscriptionEvent) {
      const sub = event.data.object as Stripe.Subscription;
      subscriptionId = stripeIdOrNull(sub.id);
      incomingStatus = typeof sub.status === "string" ? sub.status : null;
      subscriptionMetadata = sub.metadata ?? null;
      metadataPlanTier = subscriptionMetadata?.plan_tier;
      currentPeriodEnd = periodEndIso(
        sub as unknown as Parameters<typeof periodEndIso>[0],
      );
    } else {
      // Invoice family. An Invoice carries `subscription`; an InvoicePayment has
      // neither `subscription` nor `customer`, so the id comes from its invoice
      // (one verified read when the invoice is not inline). No resolvable id →
      // nothing is consumed and nothing is written.
      const object = event.data.object as unknown as Record<string, unknown>;
      subscriptionId = await resolveTierInvoiceSubscriptionId(object, async () => {
        if (deps.stripe) return deps.stripe;
        try {
          return await stripeClient();
        } catch (err) {
          console.warn(
            "[tier] Stripe client unavailable while attributing an invoice event:",
            (err as Error).message,
          );
          return undefined;
        }
      });
    }

    if (!subscriptionId) {
      console.warn(`[tier] ${event.type} names no subscription — nothing written`);
      return false;
    }

    // ── Attribution (fail-closed, never guessed) ───────────────────────────
    // (a) the user whose stored subscription IS this subscription.
    let row = await store.getBySubscriptionId(subscriptionId);
    // (b) the user named by the SUBSCRIPTION's own metadata (only our server
    //     writes it) — and only when it is tagged as a plan tier, never when it
    //     carries another product line's marker. Only ever fills an empty
    //     stored subscription id.
    if (!row && isTierSubscriptionMetadata(subscriptionMetadata)) {
      const rawUserId = subscriptionMetadata?.user_id;
      const metadataUserId =
        typeof rawUserId === "string" && /^\d+$/.test(rawUserId.trim())
          ? Number(rawUserId.trim())
          : null;
      if (metadataUserId != null) {
        const candidate = await store.getByUserId(metadataUserId);
        if (
          candidate &&
          (candidate.stripe_subscription_id == null ||
            candidate.stripe_subscription_id === subscriptionId)
        ) {
          row = candidate;
        }
      }
    }

    if (!row) {
      // Not ours, or ours but unattributable → the existing flow sees it and
      // nothing is written (no attribution is ever fabricated).
      console.warn(
        `[tier] ${event.type} (subscription ${subscriptionId}) could not be attributed to a Contrax user — no row written`,
      );
      return false;
    }

    const transition = tierBillingAfterEvent(
      event.type,
      incomingStatus,
      metadataPlanTier,
    );
    if (!transition) {
      console.warn(
        `[tier] ${event.type} for user ${String(row.id)} implies no change (status=${String(incomingStatus)}) — no row written`,
      );
      return true;
    }

    if (!shouldWriteTransition(row, transition, { subscriptionId, currentPeriodEnd })) {
      // Replay / no-op: the stored row already reflects this event. Nothing to
      // write — keeps repeated deliveries free and idempotent.
      console.log(
        `[tier] ${event.type} for user ${String(row.id)} already stored (status=${transition.status}) — no write`,
      );
      return true;
    }

    await store.applyTransition({
      userId: row.id,
      status: transition.status,
      planTier: transition.planTier,
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd,
    });
    console.log(
      `[tier] ${event.type} → user=${String(row.id)} status=${transition.status}` +
        (transition.planTier ? ` plan_tier=${transition.planTier}` : "") +
        ` (subscription ${subscriptionId})`,
    );
    return true;
  } catch (err) {
    // Fail-closed AND never crash the shared webhook: log and consume (the
    // event was ours, so the checkout-only flow must not see it).
    console.error(
      `[tier] webhook handling failed for ${event.type}:`,
      (err as Error).message,
    );
    return true;
  }
}
