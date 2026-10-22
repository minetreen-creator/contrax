/**
 * One-click Stripe setup check/fix for /admin/data-access (owner 2026-10-22:
 * "you need to do stripe settings" — done with the live key the site already
 * holds, so nobody has to click through the Stripe dashboard).
 *
 * Checks: the secret key is set (and whether it is live or test), the webhook
 * signing secret is set, a webhook endpoint points at this site and sends every
 * event the plan flows need, and a customer-portal configuration exists.
 * Fix: adds the missing events to this site's endpoint(s) and, when the account
 * has no portal configuration at all, creates one. It never creates a webhook
 * endpoint: a new endpoint gets a new signing secret that must then be copied
 * into Vercel by hand, which would break verification until it is.
 */
import type Stripe from "stripe";
import { getStripe } from "~/lib/stripe";

/**
 * Every event a plan flow consumes: data-feed-billing.server.ts's
 * DATA_FEED_WEBHOOK_EVENTS (listed here, not imported: that module imports this
 * one) plus async card payments (handleStripeWebhook, stripe.ts).
 */
export const SITE_WEBHOOK_EVENTS: readonly string[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

export function missingSiteWebhookEvents(enabled: readonly string[]): string[] {
  if (enabled.includes("*")) return [];
  return SITE_WEBHOOK_EVENTS.filter((e) => !enabled.includes(e));
}

export interface StripeSetupStatus {
  keyMode: "live" | "test" | "missing";
  webhookSecretSet: boolean;
  endpoints: { id: string; url: string; status: string; missing: string[] }[];
  portal: { ready: boolean; isDefault: boolean; configurationId: string | null };
}

const isOurEndpoint = (url: string) => url.includes("/api/stripe/webhook");

export function keyMode(key: string | undefined): StripeSetupStatus["keyMode"] {
  if (!key) return "missing";
  return key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";
}

async function portalState(stripe: Stripe): Promise<StripeSetupStatus["portal"]> {
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 20 });
  const def = list.data.find((c) => c.is_default);
  const any = def ?? list.data[0];
  return { ready: Boolean(any), isDefault: Boolean(def), configurationId: any?.id ?? null };
}

export async function stripeSetupStatus(stripe: Stripe = getStripe()): Promise<StripeSetupStatus> {
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  return {
    keyMode: keyMode(process.env.STRIPE_SECRET_KEY),
    webhookSecretSet: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    endpoints: list.data
      .filter((e) => isOurEndpoint(e.url))
      .map((e) => ({ id: e.id, url: e.url, status: e.status, missing: missingSiteWebhookEvents(e.enabled_events) })),
    portal: await portalState(stripe),
  };
}

/** The portal lets a customer update their card, see invoices and cancel at period end. */
export const PORTAL_CONFIGURATION: Stripe.BillingPortal.ConfigurationCreateParams = {
  business_profile: { headline: "Manage your Contrax plan" },
  features: {
    customer_update: { enabled: true, allowed_updates: ["email", "address"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
  },
};

export async function fixStripeSetup(stripe: Stripe = getStripe()): Promise<StripeSetupStatus> {
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const e of list.data) {
    if (!isOurEndpoint(e.url)) continue;
    const missing = missingSiteWebhookEvents(e.enabled_events);
    if (!missing.length) continue;
    await stripe.webhookEndpoints.update(e.id, {
      enabled_events: [...e.enabled_events, ...missing] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
    });
  }
  if (!(await portalState(stripe)).ready) await stripe.billingPortal.configurations.create(PORTAL_CONFIGURATION);
  return stripeSetupStatus(stripe);
}

/**
 * Extra params for `billingPortal.sessions.create`. A configuration created by
 * the API is never the account's DEFAULT (only one saved in the Dashboard is),
 * and a session without `configuration` needs a default, so when there is no
 * default this names the active one. Any lookup failure returns `{}`: the
 * session call then behaves exactly as before.
 */
export async function portalSessionParams(stripe: Stripe): Promise<{ configuration?: string }> {
  try {
    const p = await portalState(stripe);
    return p.ready && !p.isDefault && p.configurationId ? { configuration: p.configurationId } : {};
  } catch {
    return {};
  }
}
