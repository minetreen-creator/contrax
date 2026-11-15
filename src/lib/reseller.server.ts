import type Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "./stripe";
import { PARTNER_PRODUCT, partnerFromMetadata, partnerMetadata, partnerNotice, partnerUnitCents, type PartnerMoment, type PartnerOrder } from "./reseller";

const SITE = "https://www.contrax.company";

/** A Stripe Checkout page for the reseller subscription: one line, quantity = clients, price by volume. Inline price, so nothing is set up in Stripe. */
export async function createPartnerCheckout(order: PartnerOrder, stripe: Stripe = getStripe()): Promise<{ url: string; sessionId: string }> {
  const metadata = partnerMetadata(order);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: order.email,
    metadata,
    subscription_data: { metadata },
    line_items: [{
      quantity: order.clients,
      price_data: {
        currency: "usd",
        unit_amount: partnerUnitCents(order.clients),
        recurring: { interval: "month" },
        product_data: { name: "Contrax pipeline report, partner price (per client)", description: `Monthly pipeline reports under the name of ${order.firm}.`.slice(0, 250) },
      },
    }],
    success_url: `${SITE}/resellers?reseller=started#order`,
    cancel_url: `${SITE}/resellers?reseller=cancelled#order`,
  });
  if (!session.url) throw new Error("Checkout unavailable");
  return { url: session.url, sessionId: session.id };
}

async function tell(order: PartnerOrder, moment: PartnerMoment, ref: string): Promise<void> {
  const notice = partnerNotice(order, moment, ref);
  const { alertReportOrder } = await import("./live-push.server");
  await alertReportOrder({ title: notice.title, body: notice.body, tag: notice.tag, url: "/admin/live" });
  if (!process.env.RESEND_API_KEY) throw new Error("Email service unavailable");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: "Contrax <hello@contrax.company>", to: ["contrax.companyllc@gmail.com"], replyTo: order.email, subject: notice.subject, text: notice.text,
  });
  if (result.error) throw result.error;
}

/**
 * Called after the shared Stripe endpoint verifies the signature. Owns every event that carries
 * product "contrax_reseller" so none reaches the plan-tier flow. Returns true when the event was ours.
 */
export async function handleResellerEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.product !== PARTNER_PRODUCT) return false;
    const order = partnerFromMetadata(session.metadata);
    if (!order) throw new Error("Invalid partner metadata");
    await tell(order, "started", session.id);
    return true;
  }
  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.product !== PARTNER_PRODUCT) return false;
    if (event.type === "customer.subscription.deleted") {
      const order = partnerFromMetadata(sub.metadata);
      if (order) await tell(order, "cancelled", sub.id);
    }
    return true;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as unknown as {
      id: string;
      subscription_details?: { metadata?: Record<string, string> | null } | null;
      parent?: { subscription_details?: { metadata?: Record<string, string> | null } | null } | null;
    };
    const meta = invoice.subscription_details?.metadata ?? invoice.parent?.subscription_details?.metadata ?? null;
    if (meta?.product !== PARTNER_PRODUCT) return false;
    if (event.type === "invoice.payment_failed") {
      const order = partnerFromMetadata(meta);
      if (order) await tell(order, "payment_failed", invoice.id);
    }
    return true;
  }
  return false;
}
