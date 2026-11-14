import type Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "./stripe";
import { REPORT_DELIVERY, REPORT_PRICE_CENTS, REPORT_PRODUCT, REPORT_FOLLOW_UP_DAYS, buyerConfirmation, buyerFollowUp, orderAlert, orderFromMetadata, orderMetadata, ownerNotice, tradeForText, type ReportOrder } from "./pipeline-report";
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
  if (!send) await tellBuyer(order, session.id);
  return true;
}

/**
 * The buyer's own emails: a confirmation now and one follow-up in REPORT_FOLLOW_UP_DAYS days, which
 * the email service holds and sends on its own. Each carries an idempotency key from the Stripe
 * session, so a webhook delivered twice sends once. Never throws: the order already reached the owner.
 */
async function tellBuyer(order: ReportOrder, sessionId: string): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const base = { from: "Nathaniel at Contrax <hello@contrax.company>", to: [order.email], replyTo: "contrax.companyllc@gmail.com" };
    const now = buyerConfirmation(order);
    const first = await resend.emails.send({ ...base, subject: now.subject, text: now.text }, { idempotencyKey: `report-confirm-${sessionId}` });
    if (first.error) console.error("[pipeline-report] buyer confirmation failed:", first.error.message);
    // The largest contract ending soon in their market, when their words map to a trade.
    let top: { holder: string; agency: string | null; endDate: string } | null = null;
    const slug = tradeForText(order.trade);
    if (slug) {
      try {
        const { reportData } = await import("./pipeline-report-data.server");
        const c = (await reportData(order.state, slug, 12)).largest[0];
        if (c) top = { holder: c.recipient_name, agency: c.sub_agency ?? c.agency, endDate: c.end_date };
      } catch (e) {
        console.error("[pipeline-report] follow-up contract lookup failed (sending without it):", (e as Error).message);
      }
    }
    const paidAt = new Date();
    const later = buyerFollowUp(order, paidAt, top);
    const second = await resend.emails.send(
      { ...base, subject: later.subject, text: later.text, scheduledAt: new Date(paidAt.getTime() + REPORT_FOLLOW_UP_DAYS * 86_400_000).toISOString() },
      { idempotencyKey: `report-followup-${sessionId}` },
    );
    if (second.error) console.error("[pipeline-report] buyer follow-up failed:", second.error.message);
  } catch (e) {
    console.error("[pipeline-report] buyer emails failed (order already reached the owner):", (e as Error).message);
  }
}
