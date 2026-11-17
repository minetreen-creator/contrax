import type Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "./stripe";
import { intakeNotice, type BidPrepIntake, BID_PREP_DELIVERY, BID_PREP_PRICE_CENTS, BID_PREP_PRODUCT, prepAlert, prepBuyerConfirmation, prepFromMetadata, prepMetadata, prepOwnerNotice, type BidPrepOrder } from "./bid-prep";

const SITE = "https://www.contrax.company";

/** A Stripe Checkout page for one bid package. The price is inline, so nothing is set up in Stripe. */
export async function createBidPrepCheckout(order: BidPrepOrder, stripe: Stripe = getStripe()): Promise<{ url: string; sessionId: string }> {
  const metadata = prepMetadata(order);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.email,
    metadata,
    payment_intent_data: { metadata },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: BID_PREP_PRICE_CENTS,
        product_data: {
          name: "Contrax Bid Prep",
          description: `We prepare your bid package for: ${order.bidTitle.slice(0, 180)}. Delivered by email within ${BID_PREP_DELIVERY}. One-time payment.`,
        },
      },
    }],
    success_url: `${SITE}/order-received?kind=bidprep&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/bid/${order.bidId}?prep=cancelled#bid-prep`,
  });
  if (!session.url) throw new Error("Checkout unavailable");
  return { url: session.url, sessionId: session.id };
}

export function isPaidBidPrepSession(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.product === BID_PREP_PRODUCT && session.mode === "payment" && session.payment_status === "paid"
    && session.amount_total === BID_PREP_PRICE_CENTS && session.currency === "usd";
}

/**
 * Called after the shared Stripe endpoint verifies the signature. A paid order emails the owner,
 * who prepares the package. Returns true when the event belonged to this product. A failed notice
 * throws so Stripe retries: the payment is the order, and an order nobody hears about is never delivered.
 */
export async function handleBidPrepEvent(
  event: Stripe.Event,
  send?: (m: { subject: string; text: string; replyTo: string }) => Promise<void>,
): Promise<boolean> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return false;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.product !== BID_PREP_PRODUCT) return false;
  if (!isPaidBidPrepSession(session)) return true;
  const order = prepFromMetadata(session.metadata);
  if (!order) throw new Error("Invalid bid prep metadata");
  if (!send) {
    const { alertReportOrder } = await import("./live-push.server");
    await alertReportOrder(prepAlert(order, session.id, true));
  }
  const notice = prepOwnerNotice(order, session.id);
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
  if (!send) {
    // The buyer's confirmation, with the questions to answer. Never throws: the order already reached the owner.
    try {
      if (process.env.RESEND_API_KEY) {
        const now = prepBuyerConfirmation(order, session.id);
        const r = await new Resend(process.env.RESEND_API_KEY).emails.send(
          { from: "Nathaniel at Contrax <hello@contrax.company>", to: [order.email], replyTo: "contrax.companyllc@gmail.com", subject: now.subject, text: now.text },
          { idempotencyKey: `prep-confirm-${session.id}` },
        );
        if (r.error) console.error("[bid-prep] buyer confirmation failed:", r.error.message);
      }
    } catch (e) {
      console.error("[bid-prep] buyer confirmation failed (order already reached the owner):", (e as Error).message);
    }
  }
  return true;
}

/**
 * The intake form's answers, tied to a paid order by its Stripe session id. The session is read
 * back from Stripe, so answers are accepted only for a real, paid Bid Prep order.
 */
export async function sendBidPrepIntake(sessionId: string, answers: BidPrepIntake, stripe: Stripe = getStripe()): Promise<"sent" | "not_paid"> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!isPaidBidPrepSession(session)) return "not_paid";
  const order = prepFromMetadata(session.metadata);
  if (!order) return "not_paid";
  if (!process.env.RESEND_API_KEY) throw new Error("Email service unavailable");
  const m = intakeNotice(order, answers, session.id);
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: "Contrax <hello@contrax.company>",
    to: ["contrax.companyllc@gmail.com"],
    replyTo: order.email,
    subject: m.subject,
    text: m.text,
  });
  if (result.error) throw result.error;
  return "sent";
}
