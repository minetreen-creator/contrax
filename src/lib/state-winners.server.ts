/**
 * The paid state winners list: Stripe checkout, the webhook step and the file (see state-winners.ts).
 * The price is inline, so nothing is set up in Stripe. The file is built from USAspending.gov when
 * the buyer downloads it, so it is never stored.
 */
import type Stripe from "stripe";
import { getStripe } from "~/lib/stripe";
import {
  WINNERS_PATH, WINNERS_PRICE_CENTS, WINNERS_PRODUCT, WINNERS_FORMAT_NOTE,
  buyerEmail, ownerNotice, paidWinnersState, winnerRowFromApi, winnersProductName, winnersSearchBody, type WinnerRow,
} from "~/lib/state-winners";

const SITE = "https://www.contrax.company";
const API = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const MAX_PAGES = 40;
const BATCH = 4;

export async function createWinnersCheckout(state: string, stripe: Stripe = getStripe()): Promise<string> {
  const metadata = { product: WINNERS_PRODUCT, winners_state: state };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    metadata,
    payment_intent_data: { metadata },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: WINNERS_PRICE_CENTS,
        product_data: { name: winnersProductName(state), description: `One-time purchase. ${WINNERS_FORMAT_NOTE}` },
      },
    }],
    custom_text: { submit: { message: "One payment, nothing renews. Your file downloads on the next page and the link is emailed to you." } },
    success_url: `${SITE}${WINNERS_PATH}?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/federal-construction-by-state?list=cancelled#list`,
  });
  if (!session.url) throw new Error("Checkout unavailable");
  return session.url;
}

async function fetchPage(state: string, page: number, endDate: string, fetcher: typeof fetch): Promise<{ rows: WinnerRow[]; hasNext: boolean }> {
  const res = await fetcher(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Contrax/1.0 (+https://www.contrax.company)" },
    body: JSON.stringify(winnersSearchBody(state, page, endDate)),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`USAspending answered ${res.status}`);
  const j = (await res.json()) as { results?: Record<string, unknown>[]; page_metadata?: { hasNext?: boolean } };
  return { rows: (j.results ?? []).map((r) => winnerRowFromApi(r, state)), hasNext: !!j.page_metadata?.hasNext };
}

/** Every row for one state, largest contract first. Throws if the federal site cannot be read: a partial file is never sold. */
export async function fetchWinners(state: string, today: string, fetcher: typeof fetch = fetch): Promise<WinnerRow[]> {
  const out: WinnerRow[] = [];
  for (let first = 1; first <= MAX_PAGES; first += BATCH) {
    const pages = await Promise.all(Array.from({ length: BATCH }, (_, i) => fetchPage(state, first + i, today, fetcher)));
    let more = true;
    for (const p of pages) {
      out.push(...p.rows);
      if (!p.hasNext) { more = false; break; }
    }
    if (!more) break;
  }
  return out;
}

/** The state a Stripe session paid for, or null. Reads the session from Stripe, so a made-up id opens nothing. */
export async function paidStateForSession(sessionId: string, stripe: Stripe = getStripe()): Promise<string | null> {
  try {
    return paidWinnersState(await stripe.checkout.sessions.retrieve(sessionId));
  } catch {
    return null;
  }
}

/**
 * Called after the shared Stripe endpoint verifies the signature. Consumes this product's checkout
 * events so they never reach the plan flow, tells the owner and emails the buyer the download link.
 * Returns false for every other event. Emails never throw: the buyer already has the download page.
 */
export async function handleWinnersEvent(
  event: Stripe.Event,
  send?: (m: { to: string; subject: string; text: string; key: string }) => Promise<void>,
): Promise<boolean> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return false;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.product !== WINNERS_PRODUCT) return false;
  const state = paidWinnersState(session);
  if (!state) return true;
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
    await deliver({ to: "contrax.companyllc@gmail.com", ...ownerNotice(state, session.id, email), key: `winners-owner-${session.id}` });
  } catch (e) {
    console.error("[state-winners] owner notice failed:", (e as Error).message);
  }
  if (email) {
    try {
      await deliver({ to: email, ...buyerEmail(state, session.id), key: `winners-buyer-${session.id}` });
    } catch (e) {
      console.error("[state-winners] buyer email failed:", (e as Error).message);
    }
  }
  return true;
}
