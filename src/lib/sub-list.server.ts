/**
 * Paid local-subcontractor list: Stripe checkout and the webhook step (see
 * sub-list.ts). The list itself is built by hand from public business listings
 * and emailed by the owner; this records the order and tells the owner.
 */
import type Stripe from "stripe";
import { Resend } from "resend";
import { sql } from "~/db";
import { getStripe } from "~/lib/stripe";
import { SUB_LIST_DESCRIPTION, SUB_LIST_NAME, SUB_LIST_PRICE_CENTS, SUB_LIST_PRODUCT } from "~/lib/sub-list";

const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";
const OWNER_EMAIL = "minetreen@gmail.com";

export async function ensureSubListOrders(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS sub_list_orders (
    id SERIAL PRIMARY KEY,
    checkout_session_id TEXT NOT NULL UNIQUE,
    email TEXT,
    trade TEXT NOT NULL,
    city TEXT NOT NULL,
    amount INTEGER,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

export async function createSubListCheckout(trade: string, city: string): Promise<string> {
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: SUB_LIST_PRICE_CENTS,
          product_data: { name: `${SUB_LIST_NAME}: ${trade}, ${city}`.slice(0, 120), description: SUB_LIST_DESCRIPTION },
        },
        quantity: 1,
      },
    ],
    metadata: { product: SUB_LIST_PRODUCT, trade, city },
    custom_text: { submit: { message: "Your list arrives by email within one business day. Questions? Reply to the receipt." } },
    success_url: `${BASE_URL}/sub-list?paid=1`,
    cancel_url: `${BASE_URL}/sub-list?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Consumes a paid sub-list checkout; false for every other event. */
export async function handleSubListEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return false;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.product !== SUB_LIST_PRODUCT) return false;
  if (session.payment_status !== "paid") return true;
  await ensureSubListOrders();
  const email = session.customer_details?.email ?? null;
  const trade = session.metadata.trade ?? "?";
  const city = session.metadata.city ?? "?";
  const rows = (await sql()`
    INSERT INTO sub_list_orders (checkout_session_id, email, trade, city, amount)
    VALUES (${session.id}, ${email}, ${trade}, ${city}, ${session.amount_total ?? null})
    ON CONFLICT (checkout_session_id) DO NOTHING RETURNING id`) as unknown[];
  if (rows.length && process.env.RESEND_API_KEY) {
    try {
      await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: "Contrax <hello@contrax.company>",
        to: OWNER_EMAIL,
        subject: `Paid sub list: ${trade}, ${city}`,
        text: `A $${((session.amount_total ?? 0) / 100).toFixed(2)} local subcontractor list was paid.\n\nTrade: ${trade}\nCity: ${city}\nBuyer: ${email ?? "(no email)"}\n\nPromise: emailed within one business day.`,
      });
    } catch (e) {
      console.error("[sub-list] owner email failed:", (e as Error).message);
    }
  }
  return true;
}
