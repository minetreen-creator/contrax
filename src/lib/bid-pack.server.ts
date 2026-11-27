/**
 * The Public Bid Paperwork Pack: Stripe checkout, the webhook step and the paid-order check (see
 * bid-pack.ts). The price is inline, so nothing is set up in Stripe.
 */
import type Stripe from "stripe";
import { getStripe } from "~/lib/stripe";
import {
  BID_PACK_FORMAT_NOTE, BID_PACK_NAME, BID_PACK_PATH, BID_PACK_PRICE_CENTS, BID_PACK_PRODUCT,
  bidPackBuyerEmail, bidPackOwnerNotice, paidBidPack,
} from "~/lib/bid-pack";

const SITE = "https://www.contrax.company";

export async function createBidPackCheckout(stripe: Stripe = getStripe()): Promise<string> {
  const metadata = { product: BID_PACK_PRODUCT };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    metadata,
    payment_intent_data: { metadata },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: BID_PACK_PRICE_CENTS,
        product_data: { name: BID_PACK_NAME, description: `One-time purchase. ${BID_PACK_FORMAT_NOTE}` },
      },
    }],
    custom_text: { submit: { message: "One payment, nothing renews. Your files download on the next page and the link is emailed to you." } },
    success_url: `${SITE}${BID_PACK_PATH}?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}${BID_PACK_PATH}?pack=cancelled`,
  });
  if (!session.url) throw new Error("Checkout unavailable");
  return session.url;
}

/** True when the Stripe session is a paid order for the pack. Reads the session from Stripe, so a made-up id opens nothing. */
export async function bidPackPaidForSession(sessionId: string, stripe: Stripe = getStripe()): Promise<boolean> {
  try {
    return paidBidPack(await stripe.checkout.sessions.retrieve(sessionId));
  } catch {
    return false;
  }
}

/**
 * Called after the shared Stripe endpoint verifies the signature. Consumes this product's checkout
 * events so they never reach the plan flow, tells the owner and emails the buyer the download link.
 * Returns false for every other event. Emails never throw: the buyer already has the download page.
 */
export async function handleBidPackEvent(
  event: Stripe.Event,
  send?: (m: { to: string; subject: string; text: string; key: string }) => Promise<void>,
): Promise<boolean> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return false;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.product !== BID_PACK_PRODUCT) return false;
  if (!paidBidPack(session)) return true;
  const deliver = send ?? (async (m) => {
    if (!process.env.RESEND_API_KEY) return;
    const { Resend } = await import("resend");
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
      { from: "Nathaniel at Contrax <hello@contrax.company>", to: [m.to], replyTo: "contrax.companyllc@gmail.com", subject: m.subject, text: m.text },
      { idempotencyKey: m.key },
    );
    if (result.error) throw result.error;
  });
  const email = session.customer_details?.email ?? null;
  try {
    await deliver({ to: "contrax.companyllc@gmail.com", ...bidPackOwnerNotice(session.id, email), key: `bid-pack-owner-${session.id}` });
  } catch (e) {
    console.error("[bid-pack] owner notice failed:", (e as Error).message);
  }
  if (email) {
    try {
      await deliver({ to: email, ...bidPackBuyerEmail(session.id), key: `bid-pack-buyer-${session.id}` });
    } catch (e) {
      console.error("[bid-pack] buyer email failed:", (e as Error).message);
    }
  }
  return true;
}
