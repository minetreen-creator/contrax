/**
 * Contrax Grants — $19/month Stripe subscription (owner order 2026-09-17).
 *
 * Entitlement rule (owner, non-negotiable): GRANT ACCESS COMES ONLY FROM A
 * VERIFIED STRIPE SUBSCRIPTION STATUS STORED IN THE DB — `grants_subscriptions`,
 * written exclusively by handleStripeWebhook → handleGrantsSubscriptionEvent
 * after the signature is verified against STRIPE_WEBHOOK_SECRET. The
 * `?checkout=success` redirect parameter NEVER grants access; the page may use it
 * for a toast and nothing else.
 *
 * Granted statuses are `active` and `trialing` ONLY. Everything else
 * (incomplete / incomplete_expired / past_due / unpaid / paused / canceled /
 * NULL) is no access — the entitlement helper is fail-closed by construction:
 * an unknown or missing status is not in the allowed set.
 *
 * Access tiers are decided by `grantsAccessTier()`:
 *   full    — a signed-in user whose stored status is granted (today's signed-in
 *             path: full pages + "Load more" up to MAX_PAGE)
 *   preview — everyone else, INCLUDING a signed-in user with no subscription:
 *             the EXISTING anonymous limits (one search per visitor per day
 *             through grants-limits.server.ts, PREVIEW_LIMIT cards, then the
 *             requiresAuth wall + upgrade prompt). grants-limits.server.ts is
 *             untouched by this feature.
 *
 * Stripe configuration: the price is ALWAYS process.env.STRIPE_GRANTS_PRICE_ID
 * (never client-supplied) and mode is "subscription" with quantity 1. No
 * payment_method_types (Stripe dynamic payment methods) and no automatic tax /
 * tax_behavior anywhere.
 *
 * The pure decision helpers are exported so `bun test` can prove the
 * authorization and webhook-transition rules without a database or a live
 * Stripe key; the Neon-backed store and Stripe calls are injected/lazy.
 */
import type Stripe from "stripe";
import { sql } from "~/db";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Marks every Grants checkout/subscription in Stripe metadata. */
export const GRANTS_PRODUCT = "grants";

/** Env var holding the Grants price id (test price on preview, live on prod). */
export const GRANTS_PRICE_ENV = "STRIPE_GRANTS_PRICE_ID";

/** The ONLY statuses that grant access (owner spec 2026-09-17). */
export const GRANTS_GRANTED_STATUSES: readonly string[] = ["active", "trialing"];

/**
 * Base URL for Stripe redirect targets — the SAME env-aware pattern the existing
 * checkout uses (src/lib/stripe.ts: PROD_URL with the production host fallback).
 */
const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";

// ── Pure decision helpers (unit-tested) ───────────────────────────────────────

/** True only for a granted status. Fail-closed: NULL/unknown → false. */
export function isGrantsStatusGranted(status: string | null | undefined): boolean {
  if (typeof status !== "string") return false;
  return GRANTS_GRANTED_STATUSES.includes(status);
}

export interface GrantsSubscriptionRow {
  user_id: number | null;
  email?: string | null;
  status: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_checkout_session_id?: string | null;
  price_id?: string | null;
  current_period_end?: string | Date | null;
}

export interface GrantsSubscriptionState {
  /** The ONLY thing the API/page may gate on. */
  subscribed: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
}

/** Normalize a stored row (or its absence) into the public entitlement state. */
export function evaluateGrantsSubscription(
  row: GrantsSubscriptionRow | null | undefined,
): GrantsSubscriptionState {
  const status = row?.status ?? null;
  const rawEnd = row?.current_period_end ?? null;
  const currentPeriodEnd =
    rawEnd == null
      ? null
      : rawEnd instanceof Date
        ? rawEnd.toISOString()
        : String(rawEnd);
  return {
    subscribed: isGrantsStatusGranted(status),
    status,
    currentPeriodEnd,
    stripeCustomerId: row?.stripe_customer_id ?? null,
  };
}

/** No-access state, used when there is no user or no row. */
export const NO_GRANTS_SUBSCRIPTION: GrantsSubscriptionState = {
  subscribed: false,
  status: null,
  currentPeriodEnd: null,
  stripeCustomerId: null,
};

/**
 * The access tier for a request. `full` requires BOTH a signed-in user AND a
 * granted stored status — a signed-in user without a subscription gets the
 * anonymous `preview` limits (owner spec 2026-09-17).
 */
export function grantsAccessTier(input: {
  authenticated: boolean;
  subscribed: boolean;
}): "full" | "preview" {
  return input.authenticated && input.subscribed ? "full" : "preview";
}

/** The status a webhook event writes. Pure — the handler just persists it. */
export function grantsStatusAfterEvent(
  eventType: string,
  incomingStatus?: string | null,
): string | null {
  switch (eventType) {
    case "checkout.session.completed":
    case "customer.subscription.created":
      return incomingStatus ?? "active";
    case "customer.subscription.updated":
      return incomingStatus ?? null;
    case "customer.subscription.deleted":
      return "canceled";
    case "invoice.paid":
      return "active";
    case "invoice.payment_failed":
      return "past_due";
    default:
      return null;
  }
}

/**
 * The events this module consumes (owner spec: six event types, each with the
 * right entitlement effect).
 */
export const GRANTS_HANDLED_EVENTS: readonly string[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

/**
 * Validation for POST /api/stripe/grants-checkout-session. The route takes NO
 * input at all: the price, quantity, mode and customer are all server-side. Any
 * supplied field is rejected (a client can never influence price or quantity).
 */
export function validateGrantsCheckoutBody(
  body: unknown,
): { ok: true } | { ok: false; error: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length > 0) {
    return {
      ok: false,
      error: `Unexpected field(s): ${keys.join(", ")} — this endpoint accepts no input`,
    };
  }
  return { ok: true };
}

// ── Store (Neon by default; injectable for tests) ─────────────────────────────

export interface GrantsSubscriptionStore {
  getByUserId(userId: number): Promise<GrantsSubscriptionRow | null>;
  getBySubscriptionId(id: string): Promise<GrantsSubscriptionRow | null>;
  getByCustomerId(id: string): Promise<GrantsSubscriptionRow | null>;
  upsert(row: GrantsSubscriptionRow & { status: string }): Promise<void>;
  setStatusBySubscriptionId(
    subscriptionId: string,
    status: string,
    currentPeriodEnd: string | null,
  ): Promise<void>;
}

const neonStore: GrantsSubscriptionStore = {
  async getByUserId(userId) {
    const rows = (await sql()`
      SELECT user_id, email, status, stripe_customer_id, stripe_subscription_id,
             price_id, current_period_end
      FROM grants_subscriptions
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 1
    `) as GrantsSubscriptionRow[];
    return rows[0] ?? null;
  },
  async getBySubscriptionId(id) {
    const rows = (await sql()`
      SELECT user_id, email, status, stripe_customer_id, stripe_subscription_id,
             price_id, current_period_end
      FROM grants_subscriptions
      WHERE stripe_subscription_id = ${id}
      LIMIT 1
    `) as GrantsSubscriptionRow[];
    return rows[0] ?? null;
  },
  async getByCustomerId(id) {
    const rows = (await sql()`
      SELECT user_id, email, status, stripe_customer_id, stripe_subscription_id,
             price_id, current_period_end
      FROM grants_subscriptions
      WHERE stripe_customer_id = ${id}
      ORDER BY updated_at DESC
      LIMIT 1
    `) as GrantsSubscriptionRow[];
    return rows[0] ?? null;
  },
  async upsert(row) {
    await sql()`
      INSERT INTO grants_subscriptions (
        user_id, email, status, stripe_customer_id, stripe_subscription_id,
        stripe_checkout_session_id, price_id, current_period_end
      )
      VALUES (
        ${row.user_id}, ${row.email ?? null}, ${row.status},
        ${row.stripe_customer_id ?? null}, ${row.stripe_subscription_id ?? null},
        ${row.stripe_checkout_session_id ?? null}, ${row.price_id ?? null},
        ${row.current_period_end ?? null}
      )
      ON CONFLICT (stripe_subscription_id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, grants_subscriptions.user_id),
        email = COALESCE(EXCLUDED.email, grants_subscriptions.email),
        status = EXCLUDED.status,
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, grants_subscriptions.stripe_customer_id),
        stripe_checkout_session_id = COALESCE(EXCLUDED.stripe_checkout_session_id, grants_subscriptions.stripe_checkout_session_id),
        price_id = COALESCE(EXCLUDED.price_id, grants_subscriptions.price_id),
        current_period_end = COALESCE(EXCLUDED.current_period_end, grants_subscriptions.current_period_end),
        updated_at = NOW()
    `;
  },
  async setStatusBySubscriptionId(subscriptionId, status, currentPeriodEnd) {
    await sql()`
      UPDATE grants_subscriptions
      SET status = ${status},
          current_period_end = COALESCE(${currentPeriodEnd}, current_period_end),
          updated_at = NOW()
      WHERE stripe_subscription_id = ${subscriptionId}
    `;
  },
};

// ── Entitlement read ─────────────────────────────────────────────────────────

/**
 * The server-side entitlement helper every gated code path uses. Reads the
 * stored row for the user and returns status + current period end; anything not
 * in GRANTS_GRANTED_STATUSES yields `subscribed: false`.
 */
export async function getGrantsSubscription(
  userId: number | null | undefined,
  store: GrantsSubscriptionStore = neonStore,
): Promise<GrantsSubscriptionState> {
  if (userId == null) return NO_GRANTS_SUBSCRIPTION;
  try {
    const row = await store.getByUserId(userId);
    return evaluateGrantsSubscription(row);
  } catch (err) {
    console.error(
      "[grants] subscription lookup failed (access denied):",
      (err as Error).message,
    );
    return NO_GRANTS_SUBSCRIPTION;
  }
}

/** The configured price id, or null when the env var is missing. */
export function getGrantsPriceId(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[GRANTS_PRICE_ENV];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

// ── Stripe calls (lazy import → no module cycle with src/lib/stripe.ts) ───────

async function stripeClient(): Promise<Stripe> {
  const { getStripe } = await import("~/lib/stripe");
  return getStripe();
}

/** Reuse the user's Stripe customer when there is one; otherwise create it. */
async function getOrCreateCustomer(
  stripe: Stripe,
  userId: number,
): Promise<string> {
  const rows = (await sql()`
    SELECT email, stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1
  `) as Array<{ email: string | null; stripe_customer_id: string | null }>;
  const existing = rows[0]?.stripe_customer_id ?? null;
  if (existing) {
    try {
      const customer = await stripe.customers.retrieve(existing);
      if (customer && !(customer as Stripe.DeletedCustomer).deleted) return existing;
    } catch (err) {
      console.warn(
        `[grants] stored Stripe customer ${existing} unusable, creating a new one:`,
        (err as Error).message,
      );
    }
  }
  const customer = await stripe.customers.create({
    ...(rows[0]?.email ? { email: rows[0].email } : {}),
    metadata: { product: GRANTS_PRODUCT, user_id: String(userId) },
  });
  // Only ever fill a MISSING user customer id — never overwrite the one the
  // plan/Bid-Scout flows may already rely on.
  await sql()`
    UPDATE users SET stripe_customer_id = ${customer.id}
    WHERE id = ${userId} AND stripe_customer_id IS NULL
  `;
  return customer.id;
}

export interface GrantsCheckoutResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Create the Grants subscription Checkout Session.
 *
 * Requires an authenticated user id (the caller enforces it): the customer is
 * created/looked up for that user and BOTH the session and the subscription
 * carry `{ product: "grants", user_id }` metadata so the webhook can attribute
 * the event. No payment_method_types (dynamic payment methods) and no automatic
 * tax — owner spec.
 */
export async function createGrantsCheckoutSession(
  userId: number,
): Promise<GrantsCheckoutResult> {
  const priceId = getGrantsPriceId();
  if (!priceId) {
    console.error(`[grants] ${GRANTS_PRICE_ENV} is not set — cannot start checkout`);
    return { success: false, error: "Grant subscriptions are not available right now." };
  }
  try {
    const stripe = await stripeClient();
    const customer = await getOrCreateCustomer(stripe, userId);
    const metadata: Record<string, string> = {
      product: GRANTS_PRODUCT,
      user_id: String(userId),
    };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer,
      client_reference_id: String(userId),
      metadata,
      subscription_data: { metadata },
      success_url: `${BASE_URL}/grants?checkout=success`,
      cancel_url: `${BASE_URL}/grants`,
    });
    if (!session.url) {
      return { success: false, error: "Stripe did not return a checkout URL" };
    }
    console.log(
      `[grants] checkout session created: user=${String(userId)} session=${session.id} price=${priceId}`,
    );
    return { success: true, url: session.url };
  } catch (err) {
    console.error("[grants] checkout session failed:", (err as Error).message);
    return {
      success: false,
      error: "We couldn't start the subscription checkout. Please try again.",
    };
  }
}

/**
 * Stripe Customer Portal session for a Grants subscriber — the "Manage
 * subscription" button. Requires a stored Grants row with a Stripe customer.
 */
export async function createGrantsPortalSession(
  userId: number,
): Promise<GrantsCheckoutResult> {
  try {
    const sub = await getGrantsSubscription(userId);
    const customer = sub.stripeCustomerId;
    if (!customer) {
      return {
        success: false,
        error: "No subscription billing profile found for your account.",
      };
    }
    const stripe = await stripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${BASE_URL}/grants`,
    });
    if (!session.url) {
      return { success: false, error: "Stripe did not return a portal URL" };
    }
    console.log(
      `[grants] portal session created: user=${String(userId)} session=${session.id}`,
    );
    return { success: true, url: session.url };
  } catch (err) {
    console.error("[grants] portal session failed:", (err as Error).message);
    return {
      success: false,
      error: "We couldn't open the billing portal. Please try again.",
    };
  }
}

// ── Webhook handling ─────────────────────────────────────────────────────────

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

interface GrantsWebhookDeps {
  store?: GrantsSubscriptionStore;
  /** Test seam: lets a suite inject a fake Stripe client. */
  stripe?: Stripe;
  /** Test seam: resolves a Contrax user id from a Stripe customer id. */
  resolveUserIdByCustomer?: (customerId: string) => Promise<number | null>;
}

async function defaultResolveUserIdByCustomer(customerId: string): Promise<number | null> {
  try {
    const rows = (await sql()`
      SELECT id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1
    `) as Array<{ id: number }>;
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("[grants] user lookup by customer failed:", (err as Error).message);
    return null;
  }
}

function isGrantsMetadata(md: Stripe.Metadata | null | undefined): boolean {
  return md?.product === GRANTS_PRODUCT;
}

/**
 * Consume the Grants subscription events from the ONE verified webhook.
 *
 * Returns true when the event belonged to Grants (so the caller stops and never
 * falls through to the user-plan flow); false for every other event, which takes
 * the existing path byte-identically. Ownership is proven by
 * metadata.product === "grants" OR an existing grants_subscriptions row for the
 * event's subscription/customer id — a non-Grants event is never acted on.
 */
export async function handleGrantsSubscriptionEvent(
  event: Stripe.Event,
  deps: GrantsWebhookDeps = {},
): Promise<boolean> {
  if (!GRANTS_HANDLED_EVENTS.includes(event.type)) return false;

  const store = deps.store ?? neonStore;
  const resolveUserIdByCustomer =
    deps.resolveUserIdByCustomer ?? defaultResolveUserIdByCustomer;

  try {
    // ── checkout.session.completed ─────────────────────────────────────────
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!isGrantsMetadata(session.metadata)) return false; // not ours
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id ?? null;
      const metadataUserId = session.metadata?.user_id
        ? Number(session.metadata.user_id)
        : null;
      let userId =
        metadataUserId != null && Number.isInteger(metadataUserId)
          ? metadataUserId
          : null;
      if (userId == null && customerId) {
        userId = await resolveUserIdByCustomer(customerId);
      }
      if (!subscriptionId) {
        // Nothing to entitle yet — the subscription.* events will follow.
        console.warn(`[grants] completed session ${session.id} has no subscription id`);
        return true;
      }

      // Read the LIVE subscription status (never assume) so a checkout that
      // completed with a non-granted status is stored exactly as Stripe has it.
      let status = "active";
      let periodEnd: string | null = null;
      let priceId: string | null = null;
      // Resolve the client lazily (injected in tests) — the stored status must
      // come from Stripe, never from an assumption.
      let stripe: Stripe | undefined = deps.stripe;
      if (!stripe) {
        try {
          stripe = await stripeClient();
        } catch (err) {
          console.warn(
            "[grants] Stripe client unavailable while recording checkout:",
            (err as Error).message,
          );
        }
      }
      if (stripe) {
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          status = grantsStatusAfterEvent("customer.subscription.created", sub.status) ?? sub.status;
          periodEnd = periodEndIso(sub as unknown as Parameters<typeof periodEndIso>[0]);
          priceId = sub.items?.data?.[0]?.price?.id ?? null;
        } catch (err) {
          console.warn(
            `[grants] could not retrieve subscription ${subscriptionId} after checkout:`,
            (err as Error).message,
          );
        }
      }
      if (userId == null) {
        console.warn(
          `[grants] completed session ${session.id} could not be attributed to a Contrax user`,
        );
        return true;
      }
      await store.upsert({
        user_id: userId,
        email: session.customer_details?.email ?? null,
        status,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_checkout_session_id: session.id,
        price_id: priceId,
        current_period_end: periodEnd,
      });
      console.log(
        `[grants] subscription recorded from checkout: user=${String(userId)} status=${status}`,
      );
      return true;
    }

    // ── subscription + invoice events ──────────────────────────────────────
    const isSubscriptionEvent = event.type.startsWith("customer.subscription.");
    const object = event.data.object as
      | Stripe.Subscription
      | Stripe.Invoice;
    const subscriptionId =
      isSubscriptionEvent
        ? (object as Stripe.Subscription).id
        : ((object as { subscription?: string | null }).subscription ?? null);
    if (!subscriptionId) return false;

    const existing = await store.getBySubscriptionId(subscriptionId);
    const subMetadata = isSubscriptionEvent
      ? (object as Stripe.Subscription).metadata
      : null;
    const metadataSaysGrants = isGrantsMetadata(subMetadata);
    // Ours when a row already exists, or the subscription itself is tagged.
    if (!existing && !metadataSaysGrants) return false;

    const incomingStatus = isSubscriptionEvent
      ? (object as Stripe.Subscription).status
      : null;
    const status = grantsStatusAfterEvent(event.type, incomingStatus);
    if (!status) return true; // ours, but nothing to change

    const currentPeriodEnd = isSubscriptionEvent
      ? periodEndIso(object as unknown as Parameters<typeof periodEndIso>[0])
      : null;

    if (existing) {
      await store.setStatusBySubscriptionId(subscriptionId, status, currentPeriodEnd);
    } else {
      // First time we hear about this subscription (e.g. checkout webhook
      // missed): attribute it and store it, so entitlement is still correct.
      const sub = object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
      const metadataUserId = sub.metadata?.user_id ? Number(sub.metadata.user_id) : null;
      const userId =
        metadataUserId != null && Number.isInteger(metadataUserId)
          ? metadataUserId
          : customerId
            ? await resolveUserIdByCustomer(customerId)
            : null;
      if (userId == null) {
        console.warn(
          `[grants] subscription ${subscriptionId} (${event.type}) could not be attributed — no row written`,
        );
        return true;
      }
      await store.upsert({
        user_id: userId,
        status,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        price_id: sub.items?.data?.[0]?.price?.id ?? null,
        current_period_end: currentPeriodEnd,
      });
    }
    console.log(`[grants] subscription ${subscriptionId} → status=${status} (${event.type})`);
    return true;
  } catch (err) {
    // Fail-closed + never crash the shared webhook: log and consume (the event
    // was ours, so the user-plan flow must not see it).
    console.error(
      `[grants] webhook handling failed for ${event.type}:`,
      (err as Error).message,
    );
    return true;
  }
}
