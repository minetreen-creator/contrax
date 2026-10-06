/**
 * Contrax bid data feed — self-serve Stripe billing (owner 2026-10-06: "we
 * should set prices and add on stripe").
 *
 *   Starter  $299/month — up to 5 states (chosen at checkout)
 *   Pro      $799/month — every state plus federal
 *
 * Checkout builds the line item inline (`price_data` + `product_data`), so no
 * Stripe dashboard setup or price-id env vars are needed. Ownership of every
 * webhook event is proven by `metadata.product === "contrax_data_feed"` on the
 * subscription (or an existing data_feed_access row holding its id); anything
 * else returns false and falls through untouched. Access is written ONLY from
 * verified webhook events, re-reading the subscription from Stripe so delayed
 * or out-of-order events can't resurrect a canceled plan.
 */
import { createHash, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { sql } from "~/db";
import { getStripe } from "~/lib/stripe";
import { ensureDataFeedTables } from "~/lib/data-feed.server";
import { parseFeedQuery } from "~/lib/data-feed";

export const DATA_FEED_PRODUCT = "contrax_data_feed";
const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";

export type DataFeedTier = "starter" | "pro";
export const DATA_FEED_PLANS: Record<DataFeedTier, { label: string; cents: number; maxStates: number | null; product: string }> = {
  starter: { label: "Starter", cents: 29900, maxStates: 5, product: "Contrax Bid Data — Starter (up to 5 states)" },
  pro: { label: "Pro", cents: 79900, maxStates: null, product: "Contrax Bid Data — Pro (all states + federal)" },
};

export function isDataFeedTier(v: unknown): v is DataFeedTier {
  return v === "starter" || v === "pro";
}

/** Starter needs 1–5 valid USPS codes; Pro takes none. Returns the normalized list or an error. */
export function validatePlanStates(tier: DataFeedTier, raw: unknown): { ok: true; states: string[] } | { ok: false; error: string } {
  if (tier === "pro") return { ok: true, states: [] };
  const parsed = parseFeedQuery(new URLSearchParams({ state: typeof raw === "string" ? raw : "" }));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const states = [...new Set(parsed.query.states)];
  if (states.length === 0) return { ok: false, error: "Choose the states you need (up to 5), e.g. VA, NC, MD." };
  if (states.length > 5) return { ok: false, error: "Starter covers up to 5 states. Choose Pro for every state." };
  return { ok: true, states };
}

/** Columns live in ensureDataFeedTables (shared with the feed's auth read). */
export async function ensureDataFeedBillingColumns(): Promise<void> {
  await ensureDataFeedTables();
}

export async function createDataFeedCheckout(userId: number, tier: DataFeedTier, states: string[]): Promise<string> {
  await ensureDataFeedBillingColumns();
  const existing = await sql()`SELECT status FROM data_feed_access WHERE user_id = ${userId} AND active = TRUE AND status IN ('active','trialing')`;
  if (existing.length) throw new Error("You already have an active data feed plan. Manage it from the link in your welcome email.");
  const stripe = getStripe();
  const users = (await sql()`SELECT email, stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1`) as { email: string; stripe_customer_id: string | null }[];
  if (!users.length) throw new Error("Account not found");
  let customerId = users[0].stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: users[0].email, metadata: { user_id: String(userId) } });
    customerId = customer.id;
    await sql()`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${userId} AND stripe_customer_id IS NULL`;
  }
  const plan = DATA_FEED_PLANS[tier];
  const metadata = { product: DATA_FEED_PRODUCT, user_id: String(userId), tier, states: states.join(",") };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: String(userId),
    line_items: [
      {
        price_data: { currency: "usd", unit_amount: plan.cents, recurring: { interval: "month" }, product_data: { name: plan.product } },
        quantity: 1,
      },
    ],
    metadata,
    subscription_data: { metadata },
    success_url: `${BASE_URL}/data?checkout=success`,
    cancel_url: `${BASE_URL}/data?checkout=canceled#plans`,
  });
  if (!session.url) throw new Error("Checkout URL unavailable");
  return session.url;
}

export async function createDataFeedPortal(userId: number): Promise<string> {
  await ensureDataFeedBillingColumns();
  const rows = (await sql()`SELECT stripe_customer_id FROM data_feed_access WHERE user_id = ${userId}`) as { stripe_customer_id: string | null }[];
  const customer = rows[0]?.stripe_customer_id;
  if (!customer) throw new Error("No data feed billing profile for this account");
  const session = await getStripe().billingPortal.sessions.create({ customer, return_url: `${BASE_URL}/data` });
  if (!session.url) throw new Error("Billing portal unavailable");
  return session.url;
}

function id(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

const paying = (status: string | null | undefined) => status === "active" || status === "trialing";

/** Issue a fresh API key (raw key returned once; only the hash is stored). */
async function issueKey(userId: number): Promise<string> {
  const key = `cx_live_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  await sql()`INSERT INTO api_keys (user_id, key_hash, name) VALUES (${userId}, ${hash}, 'Data feed key')`;
  return key;
}

/** Called only after the shared Stripe webhook verifies the signature. */
export async function handleDataFeedEvent(event: Stripe.Event): Promise<boolean> {
  const supported = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice_payment.paid",
    "invoice.payment_failed",
  ];
  if (!supported.includes(event.type)) return false;
  const object = event.data.object as unknown as Record<string, unknown>;
  let subscriptionId: string | null = null;
  let tagged = false;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.product !== DATA_FEED_PRODUCT) return false;
    tagged = true;
    subscriptionId = id(session.subscription);
    if (!subscriptionId) throw new Error("Data feed checkout missing subscription");
  } else if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    subscriptionId = sub.id;
    tagged = sub.metadata?.product === DATA_FEED_PRODUCT;
  } else {
    subscriptionId = id(object.subscription);
    if (!subscriptionId && object.invoice) {
      const invoice = typeof object.invoice === "string" ? await getStripe().invoices.retrieve(object.invoice) : (object.invoice as Record<string, unknown>);
      subscriptionId = id((invoice as unknown as { subscription?: unknown }).subscription);
    }
  }
  if (!subscriptionId) return false;
  await ensureDataFeedBillingColumns();
  const existing = (await sql()`SELECT user_id FROM data_feed_access WHERE stripe_subscription_id = ${subscriptionId} LIMIT 1`) as { user_id: number }[];
  if (!tagged && !existing.length) return false;

  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  if (sub.metadata.product !== DATA_FEED_PRODUCT && !existing.length) return false;
  const userId = existing[0]?.user_id ?? Number(sub.metadata.user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Data feed subscription has no account");
  const tier = isDataFeedTier(sub.metadata.tier) ? sub.metadata.tier : null;
  const states = tier === "starter" ? sub.metadata.states || null : null;
  const active = paying(sub.status);

  const before = (await sql()`SELECT active, stripe_subscription_id FROM data_feed_access WHERE user_id = ${userId}`) as { active: boolean; stripe_subscription_id: string | null }[];
  // A delayed event from an older subscription must not replace a current paid one.
  if (before[0]?.stripe_subscription_id && before[0].stripe_subscription_id !== sub.id && before[0].active && !active) return true;

  await sql()`
    INSERT INTO data_feed_access (user_id, active, tier, states, status, stripe_customer_id, stripe_subscription_id, note)
    VALUES (${userId}, ${active}, ${tier}, ${states}, ${sub.status}, ${id(sub.customer)}, ${sub.id}, ${tier ? `${DATA_FEED_PLANS[tier].label} (Stripe)` : "Stripe"})
    ON CONFLICT (user_id) DO UPDATE SET
      active = EXCLUDED.active, tier = EXCLUDED.tier, states = EXCLUDED.states, status = EXCLUDED.status,
      stripe_customer_id = EXCLUDED.stripe_customer_id, stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      note = EXCLUDED.note`;

  // First activation: issue a key and email it (a webhook can't show it on screen).
  const wasActive = !!before[0]?.active && before[0]?.stripe_subscription_id === sub.id;
  if (active && !wasActive) {
    const keys = await sql()`SELECT 1 FROM api_keys WHERE user_id = ${userId} AND revoked = FALSE AND name = 'Data feed key' LIMIT 1`;
    if (!keys.length) {
      const key = await issueKey(userId);
      const u = (await sql()`SELECT email FROM users WHERE id = ${userId}`) as { email: string }[];
      if (u[0]?.email) {
        const { sendDataFeedWelcomeEmail } = await import("~/lib/email");
        await sendDataFeedWelcomeEmail(u[0].email, key, tier ? DATA_FEED_PLANS[tier].label : "Data feed", states);
      }
    }
  }
  return true;
}
