import type Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "./stripe";
import { intakeNotice, type BidPrepIntake, BID_PREP_DELIVERY, BID_PREP_PRICE_CENTS, BID_PREP_PRODUCT, prepAlert, prepBuyerConfirmation, prepFromMetadata, prepMetadata, prepOwnerNotice, type BidPrepOrder } from "./bid-prep";

const SITE = "https://www.contrax.company";

/** The catalog product's fixed id, so it is created once and found again. */
export const BID_PREP_STRIPE_PRODUCT = "contrax_bid_prep";

/**
 * Bid Prep as a product in the Stripe catalog (owner 2026-11-17: "Bid Prep needs to be on stripe").
 * Created on first use and reused after, so it shows under Products in the dashboard and every sale
 * is counted against it. The amount is still set here, never read from Stripe.
 */
export async function ensureBidPrepProduct(stripe: Stripe = getStripe()): Promise<void> {
  try {
    const found = await stripe.products.retrieve(BID_PREP_STRIPE_PRODUCT);
    if (!found.active) await stripe.products.update(BID_PREP_STRIPE_PRODUCT, { active: true });
    return;
  } catch (e) {
    if ((e as { code?: string }).code !== "resource_missing") throw e;
  }
  try {
    await stripe.products.create(
      {
        id: BID_PREP_STRIPE_PRODUCT,
        name: "Contrax Bid Prep",
        description: `We prepare your bid package for one state or local bid: the checklist, the forms filled in, a cover letter and qualifications, the price sheet laid out, and the packet assembled. Delivered by email within ${BID_PREP_DELIVERY} of your company details. One-time payment.`,
        metadata: { product: BID_PREP_PRODUCT },
      },
      { idempotencyKey: BID_PREP_STRIPE_PRODUCT },
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "resource_already_exists") throw error;
  }
}

/** A Stripe Checkout page for one bid package. The amount is set here, on the catalog product. */
export async function createBidPrepCheckout(order: BidPrepOrder, stripe: Stripe = getStripe()): Promise<{ url: string; sessionId: string }> {
  const metadata = prepMetadata(order);
  await ensureBidPrepProduct(stripe);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.email,
    metadata,
    // The bid is named on the payment, so each sale reads on its own in Stripe's Payments list.
    payment_intent_data: { metadata, description: `Bid Prep: ${order.bidTitle}`.slice(0, 500) },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: BID_PREP_PRICE_CENTS,
        product: BID_PREP_STRIPE_PRODUCT,
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
