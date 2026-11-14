/**
 * $9 "What did this sell for?" (see price-lookup.ts): Stripe checkout, the webhook step, and the
 * check the bid page makes before showing winners and amounts.
 */
import type Stripe from "stripe";
import { sql } from "~/db";
import { getStripe } from "~/lib/stripe";
import { PRICE_LOOKUP_PRICE_CENTS, PRICE_LOOKUP_PRODUCT, lookupSessionId } from "~/lib/price-lookup";

const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";

export async function ensurePriceLookups(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS price_lookups (
    id SERIAL PRIMARY KEY,
    checkout_session_id TEXT NOT NULL UNIQUE,
    bid_id INTEGER NOT NULL,
    email TEXT,
    amount INTEGER,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

export async function createPriceLookupCheckout(bidId: number, title: string, email: string | null): Promise<string> {
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: PRICE_LOOKUP_PRICE_CENTS,
          product_data: {
            name: `What similar jobs sold for: ${title}`.slice(0, 120),
            description: "Who won similar federal contracts in this state and what each was paid, from USAspending.gov. One-time, for this bid.",
          },
        },
        quantity: 1,
      },
    ],
    ...(email ? { customer_email: email } : {}),
    metadata: { product: PRICE_LOOKUP_PRODUCT, bid_id: String(bidId) },
    success_url: `${BASE_URL}/bid/${bidId}?lookup={CHECKOUT_SESSION_ID}#typical-size`,
    cancel_url: `${BASE_URL}/bid/${bidId}#typical-size`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

async function record(session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.metadata?.product !== PRICE_LOOKUP_PRODUCT || session.payment_status !== "paid") return false;
  const bidId = Number(session.metadata.bid_id);
  if (!Number.isInteger(bidId) || bidId <= 0) return false;
  await ensurePriceLookups();
  await sql()`
    INSERT INTO price_lookups (checkout_session_id, bid_id, email, amount)
    VALUES (${session.id}, ${bidId}, ${session.customer_details?.email?.toLowerCase() ?? null}, ${session.amount_total ?? null})
    ON CONFLICT (checkout_session_id) DO NOTHING`;
  return true;
}

/** Consumes a paid price-lookup checkout; false for every other event. */
export async function handlePriceLookupEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return false;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.product !== PRICE_LOOKUP_PRODUCT) return false;
  await record(session);
  return true;
}

/**
 * Has this viewer bought the lookup for this bid? Checks the browser's session ids and the
 * signed-in email. A session id not recorded yet (the buyer is back before the webhook) is asked
 * of Stripe directly, at most 3 per call.
 */
export async function hasPriceLookup(bidId: number, sessions: string[], email: string | null): Promise<boolean> {
  const ids = sessions.map(lookupSessionId).filter((s): s is string => !!s);
  if (!ids.length && !email) return false;
  await ensurePriceLookups();
  const mail = email?.toLowerCase() ?? null;
  const found = (await sql()`
    SELECT checkout_session_id FROM price_lookups
    WHERE bid_id = ${bidId} AND (checkout_session_id = ANY(${ids}) OR (${mail}::text IS NOT NULL AND email = ${mail}))
    LIMIT 1`) as unknown[];
  if (found.length) return true;
  for (const id of ids.slice(-3)) {
    try {
      const s = await getStripe().checkout.sessions.retrieve(id);
      if (Number(s.metadata?.bid_id) === bidId && (await record(s))) return true;
    } catch {
      // Unknown or foreign session id: not a purchase.
    }
  }
  return false;
}
