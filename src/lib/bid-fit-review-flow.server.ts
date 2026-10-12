import { createHash, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { sql } from "~/db";
import { ensureBidFitReviewTable } from "./bid-fit-review.server";
import { getStripe } from "./stripe";

export const REVIEW_PRICE = 9900;
export const DOCUMENT_BUDGET = 3_000_000;
export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function validReviewToken(token: string) { return /^[a-f0-9]{64}$/.test(token); }
export function validPdf(bytes: Uint8Array) {
  return bytes.length > 5 && bytes.length <= DOCUMENT_BUDGET && Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-";
}
export async function issueReviewAccess(id: number) {
  await ensureBidFitReviewTable();
  const token = randomBytes(32).toString("hex");
  const rows = await sql()`UPDATE bid_fit_review_requests SET access_hash=${tokenHash(token)},
    access_expires_at=NOW()+INTERVAL '30 days' WHERE id=${id} RETURNING id`;
  if (!rows.length) throw new Error("Request not found");
  return token;
}
export async function getReviewByToken(token: string) {
  if (!validReviewToken(token)) return null;
  await ensureBidFitReviewTable();
  const rows = await sql()`SELECT id, status, payment_status, paid_at, accepted_at
    FROM bid_fit_review_requests WHERE access_hash=${tokenHash(token)} AND access_expires_at>NOW()`;
  return rows[0] ?? null;
}

export function isPaidReviewSession(session: Stripe.Checkout.Session) {
  return session.metadata?.product === "bid_fit_review" && session.mode === "payment"
    && session.payment_status === "paid" && session.amount_total === REVIEW_PRICE && session.currency === "usd";
}

export async function createReviewCheckout(id: number, deps?: { db: ReturnType<typeof sql>; stripe: Stripe }) {
  if (!deps) await ensureBidFitReviewTable();
  const db = deps?.db ?? sql();
  const rows = await db`SELECT id, email, status, accepted_at, checkout_session_id, payment_status
    FROM bid_fit_review_requests WHERE id=${id}`;
  const row = rows[0];
  if (!row) throw new Error("Request not found");
  if (!row.accepted_at || row.status !== "awaiting_payment" || row.payment_status === "paid")
    throw new Error("Accept this request before offering payment");
  const stripe = deps?.stripe ?? getStripe();
  if (row.checkout_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
    if (existing.status === "open" && existing.url) return existing.url;
    if (existing.status === "complete") throw new Error("Checkout completed; wait for payment confirmation");
  }
  const metadata = { product: "bid_fit_review", review_request_id: String(id) };
  const session = await stripe.checkout.sessions.create({
    mode: "payment", customer_email: row.email, metadata,
    payment_intent_data: { metadata },
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: REVIEW_PRICE,
      product_data: { name: "Contrax Bid Fit Review", description: "One solicitation — one-time review" } } }],
    success_url: "https://www.contrax.company/bid-fit-review?payment=submitted",
    cancel_url: "https://www.contrax.company/bid-fit-review?payment=cancelled",
  }, { idempotencyKey: `bid-fit-review-${id}-${row.checkout_session_id ?? "first"}` });
  if (!session.url) throw new Error("Checkout unavailable");
  const saved = await db`UPDATE bid_fit_review_requests SET checkout_session_id=${session.id}, checkout_url=${session.url},
    updated_at=NOW() WHERE id=${id} AND payment_status<>'paid' AND status='awaiting_payment'
    AND (checkout_session_id IS NOT DISTINCT FROM ${row.checkout_session_id ?? null} OR checkout_session_id=${session.id}) RETURNING id`;
  if (!saved.length) {
    await stripe.checkout.sessions.expire(session.id);
    throw new Error('Request changed while checkout was being created; refresh the request');
  }
  return session.url;
}

// Called only after the shared Stripe endpoint verifies the event signature.
export async function handleReviewPaymentEvent(event: Stripe.Event, db?: ReturnType<typeof sql>) {
  const supported = ["checkout.session.completed", "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed", "checkout.session.expired"];
  if (!supported.includes(event.type)) return false;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.product !== "bid_fit_review") return false;
  const id = Number(session.metadata.review_request_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid review payment metadata");
  if (!db) await ensureBidFitReviewTable();
  const query = db ?? sql();
  const rows = await query`SELECT id, accepted_at, checkout_session_id FROM bid_fit_review_requests WHERE id=${id}`;
  if (!rows[0]?.accepted_at || rows[0].checkout_session_id !== session.id) {
    if(event.type === "checkout.session.expired") return true;
    throw new Error("Review payment session mismatch");
  }
  if (isPaidReviewSession(session)) {
    const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    await query`UPDATE bid_fit_review_requests SET payment_status='paid', paid_at=COALESCE(paid_at,NOW()),
      paid_amount=${REVIEW_PRICE}, payment_intent_id=${intent ?? null},
      status=CASE WHEN status='awaiting_payment' THEN 'in_progress' ELSE status END, updated_at=NOW()
      WHERE id=${id} AND checkout_session_id=${session.id}`;
  } else if (session.payment_status !== "paid") {
    const status = event.type === "checkout.session.async_payment_failed" ? "failed"
      : event.type === "checkout.session.expired" ? "expired" : "processing";
    await query`UPDATE bid_fit_review_requests SET payment_status=${status}, updated_at=NOW()
      WHERE id=${id} AND payment_status<>'paid' AND checkout_session_id=${session.id}`;
  } else throw new Error("Unexpected review payment amount or currency");
  return true;
}
