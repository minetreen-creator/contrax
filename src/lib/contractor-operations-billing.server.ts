import type Stripe from "stripe";
import { sql } from "~/db";
import { getStripe } from "~/lib/stripe";

export const PRODUCT = "contrax_payments";
const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";
export type BillingInterval = "month" | "year";

export function priceFor(interval: BillingInterval): string | null {
  const value = process.env[interval === "month" ? "STRIPE_CONTRAX_PAYMENTS_MONTHLY_PRICE_ID" : "STRIPE_CONTRAX_PAYMENTS_ANNUAL_PRICE_ID"];
  return value?.startsWith("price_") ? value : null;
}

export function grantsOperationsAccess(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

/** Prevent an accidental price-id swap from charging a different amount or cadence. */
export function matchesOperationsPrice(
  price: Pick<Stripe.Price, "active" | "currency" | "unit_amount" | "recurring">,
  interval: BillingInterval,
): boolean {
  return price.active && price.currency === "usd" &&
    price.unit_amount === (interval === "month" ? 900 : 9000) &&
    (interval === "month"
      ? price.recurring?.interval === "month" && price.recurring?.interval_count === 1
      : (price.recurring?.interval === "year" && price.recurring?.interval_count === 1) ||
        (price.recurring?.interval === "month" && price.recurring?.interval_count === 12));
}

type State = { subscribed: boolean; status: string | null; customerId: string | null; interval: BillingInterval | null };
export async function getOperationsSubscription(userId: number): Promise<State> {
  try {
    const rows = await sql()`SELECT status, stripe_customer_id, price_id
      FROM contractor_operations_subscriptions WHERE user_id = ${userId}`;
    const row = rows[0];
    return {
      subscribed: grantsOperationsAccess(row?.status), status: row?.status ?? null,
      customerId: row?.stripe_customer_id ?? null,
      interval: row?.price_id === priceFor("year") ? "year" : row?.price_id === priceFor("month") ? "month" : null,
    };
  } catch (error) {
    console.error("[contractor-operations] entitlement read failed", error);
    return { subscribed: false, status: null, customerId: null, interval: null };
  }
}

export async function createOperationsCheckout(userId: number, interval: BillingInterval): Promise<string> {
  const price = priceFor(interval);
  if (!price) throw new Error("Contrax Payments checkout is not configured");
  const state = await getOperationsSubscription(userId);
  if (state.subscribed) throw new Error("Already subscribed; manage your plan in billing");
  const stripe = getStripe();
  const configuredPrice = await stripe.prices.retrieve(price);
  if (!matchesOperationsPrice(configuredPrice, interval)) {
    throw new Error("Contrax Payments price configuration mismatch");
  }
  const users = await sql()`SELECT email, stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1`;
  if (!users.length) throw new Error("Account not found");
  let customerId = users[0].stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: users[0].email,
      metadata: { user_id: String(userId) } });
    customerId = customer.id;
    await sql()`UPDATE users SET stripe_customer_id = ${customerId}
      WHERE id = ${userId} AND stripe_customer_id IS NULL`;
  }
  const metadata = { product: PRODUCT, user_id: String(userId) };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription", customer: customerId, client_reference_id: String(userId),
    line_items: [{ price, quantity: 1 }], metadata, subscription_data: { metadata },
    success_url: `${BASE_URL}/contract-payments?checkout=success`,
    cancel_url: `${BASE_URL}/contract-payments`,
  });
  if (!session.url) throw new Error("Checkout URL unavailable");
  return session.url;
}

export async function createOperationsPortal(userId: number): Promise<string> {
  const state = await getOperationsSubscription(userId);
  if (!state.customerId) throw new Error("No billing profile for this product");
  const session = await getStripe().billingPortal.sessions.create({
    customer: state.customerId, return_url: `${BASE_URL}/contract-payments`,
  });
  if (!session.url) throw new Error("Billing portal unavailable");
  return session.url;
}

function id(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

async function persist(sub: Stripe.Subscription, userId: number): Promise<void> {
  const current = await sql()`SELECT stripe_subscription_id, status
    FROM contractor_operations_subscriptions WHERE user_id = ${userId}`;
  // A delayed event from an older subscription must not replace the current
  // paid subscription after a customer cancels and re-subscribes.
  if (current[0]?.stripe_subscription_id && current[0].stripe_subscription_id !== sub.id &&
      (grantsOperationsAccess(current[0].status) || !grantsOperationsAccess(sub.status))) return;
  const customer = id(sub.customer);
  const price = sub.items.data[0]?.price?.id ?? null;
  const end = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? (sub.items.data[0] as unknown as { current_period_end?: number })?.current_period_end;
  await sql()`INSERT INTO contractor_operations_subscriptions
    (user_id, status, stripe_customer_id, stripe_subscription_id, price_id, current_period_end)
    VALUES (${userId}, ${sub.status}, ${customer}, ${sub.id}, ${price}, ${end ? new Date(end * 1000).toISOString() : null})
    ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status,
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      price_id = EXCLUDED.price_id, current_period_end = EXCLUDED.current_period_end,
      updated_at = NOW()`;
}

/** Called only after the shared Stripe webhook verifies the signature. */
export async function handleOperationsEvent(event: Stripe.Event): Promise<boolean> {
  const supported = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted", "invoice.paid", "invoice_payment.paid", "invoice.payment_failed"];
  if (!supported.includes(event.type)) return false;
  const object = event.data.object as unknown as Record<string, unknown>;
  let subscriptionId: string | null = null;
  let tagged = false;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.product !== PRODUCT) return false;
    tagged = true;
    subscriptionId = id(session.subscription);
    if (!subscriptionId) throw new Error("Contractor checkout missing subscription");
  } else if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    subscriptionId = sub.id;
    tagged = sub.metadata?.product === PRODUCT;
  } else {
    subscriptionId = id(object.subscription);
    if (!subscriptionId && object.invoice) {
      const invoice = typeof object.invoice === "string"
        ? await getStripe().invoices.retrieve(object.invoice)
        : object.invoice as Record<string, unknown>;
      subscriptionId = id((invoice as unknown as { subscription?: unknown }).subscription);
    }
  }
  if (!subscriptionId) return false;
  const existing = await sql()`SELECT user_id FROM contractor_operations_subscriptions
    WHERE stripe_subscription_id = ${subscriptionId} LIMIT 1`;
  if (!tagged && !existing.length) return false;
  // Read Stripe's current status so delayed/out-of-order webhook events never
  // resurrect a canceled or past-due subscription.
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  if (sub.metadata.product !== PRODUCT && !existing.length) return false;
  const userId = existing[0]?.user_id ?? Number(sub.metadata.user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Contractor subscription has no account");
  if (!existing.length && ![priceFor("month"), priceFor("year")].includes(sub.items.data[0]?.price?.id ?? null)) {
    throw new Error("Contractor subscription price mismatch");
  }
  await persist(sub, userId);
  return true;
}
