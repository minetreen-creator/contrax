import type Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "./stripe";
import { REPORT_DELIVERY, REPORT_PRICE_CENTS, REPORT_PRODUCT, orderAlert, orderFromMetadata, orderMetadata, ownerNotice, type ReportOrder } from "./pipeline-report";
import { STATE_NAMES } from "./contract-map";

const SITE = "https://www.contrax.company";

/** A Stripe Checkout page for one report. The price is inline, so nothing is set up in Stripe. */
export async function createReportCheckout(order: ReportOrder, stripe: Stripe = getStripe()): Promise<{ url: string; sessionId: string }> {
  const metadata = orderMetadata(order);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.email,
    metadata,
    payment_intent_data: { metadata },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: REPORT_PRICE_CENTS,
        product_data: {
          name: "Contrax Pipeline Report",
          description: `${order.trade} in ${STATE_NAMES[order.state]}. One report, delivered by email within ${REPORT_DELIVERY}.`,
        },
      },
    }],
    success_url: `${SITE}/teams?report=paid`,
    cancel_url: `${SITE}/teams?report=cancelled`,
  });
  if (!session.url) throw new Error("Checkout unavailable");
  return { url: session.url, sessionId: session.id };
}

export function isPaidReportSession(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.product === REPORT_PRODUCT && session.mode === "payment" && session.payment_status === "paid"
    && session.amount_total === REPORT_PRICE_CENTS && session.currency === "usd";
}

/**
 * Called after the shared Stripe endpoint verifies the signature. A paid report emails the owner,
 * who prepares it. Returns true when the event belonged to this product. A failed notice throws so
 * Stripe retries: the payment is the order, and an order nobody hears about is never delivered.
 */
export async function handleReportEvent(
  event: Stripe.Event,
  send?: (m: { subject: string; text: string; replyTo: string }) => Promise<void>,
): Promise<boolean> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return false;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.product !== REPORT_PRODUCT) return false;
  if (!isPaidReportSession(session)) return true;
  const order = orderFromMetadata(session.metadata);
  if (!order) throw new Error("Invalid pipeline report metadata");
  if (!send) {
    const { alertReportOrder } = await import("./live-push.server");
    await alertReportOrder(orderAlert(order, session.id, true));
  }
  const notice = ownerNotice(order, session.id);
  const deliver = send ?? (async (m) => {
    if (!process.env.RESEND_API_KEY) throw new Error("Email service unavailable");
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Contrax <hello@contrax.company>",
      to: ["contrax.companyllc@gmail.com"],
      replyTo: m.replyTo,
      subject: m.subject,
      text: m.text,
    });
    if (result.error) throw result.error;
  });
  await deliver({ ...notice, replyTo: order.email });
  return true;
}
