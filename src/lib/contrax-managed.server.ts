import type Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "./stripe";
import { REPORT_PRICE_CENTS } from "./pipeline-report";
import {
  MANAGED_FIRST_REPORT, MANAGED_PRICE_CENTS, MANAGED_PRODUCT, managedFromMetadata, managedMetadata, managedNotice,
  snapshotCreditApplies, type ManagedMoment, type ManagedOrder,
} from "./contrax-managed";

const SITE = "https://www.contrax.company";

/** Whether this email paid for the one-time snapshot recently enough to earn the credit. Never throws. */
async function earnedCredit(email: string, stripe: Stripe): Promise<boolean> {
  try {
    const list = await stripe.checkout.sessions.list({ customer_details: { email }, limit: 50 });
    return snapshotCreditApplies(list.data, Date.now());
  } catch (err) {
    console.error("[contrax-managed] credit lookup failed; continuing without it", err);
    return false;
  }
}

/** A Stripe Checkout page for the monthly subscription. The price is inline, so nothing is set up in Stripe. */
export async function createManagedCheckout(order: ManagedOrder, stripe: Stripe = getStripe()): Promise<{ url: string; sessionId: string; credited: boolean }> {
  const credited = await earnedCredit(order.email, stripe);
  const metadata = { ...managedMetadata(order), snapshot_credit: credited ? "yes" : "no" };
  // The credit is a one-time coupon for the snapshot's price, used on the first invoice only.
  const coupon = credited
    ? await stripe.coupons.create({ amount_off: REPORT_PRICE_CENTS, currency: "usd", duration: "once", max_redemptions: 1, name: "Pipeline Snapshot credit" })
    : null;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: order.email,
    metadata,
    subscription_data: { metadata },
    ...(coupon ? { discounts: [{ coupon: coupon.id }] } : {}),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: MANAGED_PRICE_CENTS,
        recurring: { interval: "month" },
        product_data: {
          name: "Contrax Managed",
          description: `A monthly pipeline report for ${order.trade} in ${order.states}. First report within ${MANAGED_FIRST_REPORT}.`.slice(0, 250),
        },
      },
    }],
    success_url: `${SITE}/order-received?kind=managed`,
    cancel_url: `${SITE}/teams?managed=cancelled#done-for-you`,
  });
  if (!session.url) throw new Error("Checkout unavailable");
  return { url: session.url, sessionId: session.id, credited };
}

async function tell(order: ManagedOrder, moment: ManagedMoment, ref: string, credited: boolean): Promise<void> {
  const notice = managedNotice(order, moment, ref, credited);
  const { alertReportOrder } = await import("./live-push.server");
  await alertReportOrder({ title: notice.title, body: notice.body, tag: notice.tag, url: "/admin/live" });
  if (!process.env.RESEND_API_KEY) throw new Error("Email service unavailable");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: "Contrax <hello@contrax.company>",
    to: ["contrax.companyllc@gmail.com"],
    replyTo: order.email,
    subject: notice.subject,
    text: notice.text,
  });
  if (result.error) throw result.error;
}

/**
 * Called after the shared Stripe endpoint verifies the signature. Owns every event that carries
 * product "contrax_managed" so none reaches the plan-tier flow: a started subscription, a
 * cancellation and a failed payment each tell the owner. Returns true when the event was ours.
 */
export async function handleManagedEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.product !== MANAGED_PRODUCT) return false;
    const order = managedFromMetadata(session.metadata);
    if (!order) throw new Error("Invalid Contrax Managed metadata");
    await tell(order, "started", session.id, session.metadata?.snapshot_credit === "yes");
    return true;
  }
  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.product !== MANAGED_PRODUCT) return false;
    if (event.type === "customer.subscription.deleted") {
      const order = managedFromMetadata(sub.metadata);
      if (order) await tell(order, "cancelled", sub.id, false);
    }
    return true;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as unknown as {
      id: string;
      subscription?: string | { id: string } | null;
      subscription_details?: { metadata?: Record<string, string> | null } | null;
      parent?: { subscription_details?: { metadata?: Record<string, string> | null } | null } | null;
    };
    const meta = invoice.subscription_details?.metadata ?? invoice.parent?.subscription_details?.metadata ?? null;
    if (meta?.product !== MANAGED_PRODUCT) return false;
    if (event.type === "invoice.payment_failed") {
      const order = managedFromMetadata(meta);
      if (order) await tell(order, "payment_failed", invoice.id, false);
    }
    return true;
  }
  return false;
}
