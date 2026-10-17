import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { sql } from "~/db";
import { getStripe } from "~/lib/stripe";
import {
  foundingBusinessSchema,
  FOUNDING_BUSINESS_LIMIT,
  FOUNDING_BUSINESS_TERMS,
  type FoundingBusinessProfile,
} from "./founding-business";

const BASE = process.env.PROD_URL || "https://www.contrax.company";
const COUPON = "contrax_founding_business_first_year_91_v1";
// Fixed rows are the inventory. A row is never reused after payment. Expiration
// is proven with Stripe, never inferred from a local timer or the return URL.
export async function ensureFoundingBusinesses() {
  await sql()`CREATE TABLE IF NOT EXISTS founding_businesses (
    slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 10),
    user_id INTEGER UNIQUE REFERENCES users(id), reservation TEXT UNIQUE,
    profile JSONB, checkout_session_id TEXT UNIQUE, checkout_url TEXT,
    reserved_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, subscription_id TEXT,
    published_at TIMESTAMPTZ, feature_expires_at TIMESTAMPTZ,
    spotlight_at TIMESTAMPTZ, hidden BOOLEAN NOT NULL DEFAULT FALSE,
    terms_version TEXT, paid_amount INTEGER
  )`;
  await sql()`INSERT INTO founding_businesses (slot) SELECT generate_series(1, 10) ON CONFLICT DO NOTHING`;
}

export async function foundingBusinessPageData() {
  try {
    await ensureFoundingBusinesses();
    await releaseExpiredFoundingReservations();
    const counts =
      await sql()`SELECT COUNT(*) FILTER (WHERE user_id IS NULL)::int AS remaining FROM founding_businesses`;
    const rows = await sql()`SELECT slot, profile FROM founding_businesses
      WHERE paid_at IS NOT NULL AND published_at IS NOT NULL AND NOT hidden AND feature_expires_at > NOW() ORDER BY slot`;
    return {
      available: true,
      remaining: Number(counts[0].remaining),
      listings: rows.map((r) => ({
        slot: Number(r.slot),
        company: r.profile.company as string,
        services: r.profile.services as string,
        serviceArea: r.profile.serviceArea as string,
        website: r.profile.website as string,
        logoUrl: (r.profile.logoUrl || "") as string,
      })),
    };
  } catch (e) {
    console.error("[founding-business] public read unavailable", e);
    return { available: false, remaining: null, listings: [] };
  }
}

export function foundingBusinessCheckoutParams(
  userId: number,
  email: string,
  reservation: string,
  slot: number,
): Stripe.Checkout.SessionCreateParams {
  const metadata = {
    plan_tier: "starter",
    user_id: String(userId),
    billing_interval: "year",
    founding_business: reservation,
    founding_business_slot: String(slot),
  };
  return {
    mode: "subscription",
    customer_email: email,
    client_reference_id: String(userId),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 19000,
          recurring: { interval: "year" },
          product_data: {
            name: "Contrax Starter — Founding Business",
            metadata: { plan_tier: "starter" },
          },
        },
      },
    ],
    discounts: [{ coupon: COUPON }],
    metadata,
    subscription_data: { metadata },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    custom_text: { submit: { message: FOUNDING_BUSINESS_TERMS } },
    success_url: `${BASE}/founding-businesses?checkout=returned#membership`,
    cancel_url: `${BASE}/founding-businesses?checkout=canceled#join`,
  };
}

async function ensureCoupon() {
  const stripe = getStripe();
  let coupon: Stripe.Coupon;
  try {
    coupon = await stripe.coupons.retrieve(COUPON);
  } catch (e) {
    if ((e as { code?: string }).code !== "resource_missing") throw e;
    try {
      coupon = await stripe.coupons.create(
        {
          id: COUPON,
          amount_off: 9100,
          currency: "usd",
          duration: "once",
          name: "Founding Business: $99 first year",
        },
        { idempotencyKey: COUPON },
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "resource_already_exists")
        throw error;
      coupon = await stripe.coupons.retrieve(COUPON);
    }
  }
  if (
    coupon.amount_off !== 9100 ||
    coupon.currency !== "usd" ||
    coupon.duration !== "once" ||
    !coupon.valid
  )
    throw new Error("Founding Business discount is unavailable.");
}

export async function releaseExpiredFoundingReservations() {
  const pending =
    await sql()`SELECT reservation, checkout_session_id FROM founding_businesses WHERE paid_at IS NULL AND checkout_session_id IS NOT NULL AND reserved_at < NOW() - INTERVAL '30 minutes'`;
  for (const row of pending) {
    const session = await getStripe().checkout.sessions.retrieve(
      row.checkout_session_id,
    );
    if (session.status === "expired")
      await releaseReservation(row.reservation, session.id);
  }
}
async function releaseReservation(reservation: string, sessionId: string) {
  await sql()`UPDATE founding_businesses SET user_id = NULL, reservation = NULL, profile = NULL,
    checkout_session_id = NULL, checkout_url = NULL, reserved_at = NULL, terms_version = NULL
    WHERE reservation = ${reservation} AND checkout_session_id = ${sessionId} AND paid_at IS NULL`;
}

export async function startFoundingBusinessCheckout(
  userId: number,
  profile: FoundingBusinessProfile,
) {
  profile = foundingBusinessSchema.parse(profile);
  await ensureFoundingBusinesses();
  const users =
    await sql()`SELECT email, stripe_subscription_id, plan_tier FROM users WHERE id = ${userId}`;
  if (!users.length) throw new Error("Account not found.");
  if (
    users[0].stripe_subscription_id ||
    ![null, "", "basic"].includes(users[0].plan_tier)
  )
    throw new Error(
      "This launch offer is for businesses without an existing paid plan. Contact Contrax about your account.",
    );
  await ensureCoupon();
  await releaseExpiredFoundingReservations();
  let rows =
    await sql()`SELECT * FROM founding_businesses WHERE user_id = ${userId}`;
  if (rows[0]?.paid_at)
    throw new Error("Your Founding Business membership is already purchased.");
  if (!rows.length) {
    const reservation = randomUUID();
    // Locks one of exactly ten inventory rows. Concurrent buyers cannot reserve
    // the same seat. The unique user_id also prevents duplicate user purchases.
    rows = await sql()`WITH seat AS (
      SELECT slot FROM founding_businesses WHERE user_id IS NULL ORDER BY slot FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE founding_businesses f SET user_id = ${userId}, reservation = ${reservation},
      profile = ${JSON.stringify(profile)}::jsonb, reserved_at = NOW(), terms_version = '2026-10-17-v1'
      FROM seat WHERE f.slot = seat.slot RETURNING f.*`;
  }
  if (!rows.length)
    throw new Error(
      `All ${FOUNDING_BUSINESS_LIMIT} places are purchased or temporarily reserved. Please check again later.`,
    );
  const row = rows[0];
  if (row.checkout_url) return row.checkout_url as string;
  // Retry with the SAME reservation and parameters after an ambiguous network
  // failure; never free a seat while a charge could still complete.
  const params = foundingBusinessCheckoutParams(
    userId,
    users[0].email,
    row.reservation,
    Number(row.slot),
  );
  params.expires_at =
    Math.floor(new Date(row.reserved_at).getTime() / 1000) + 3600;
  const session = await getStripe().checkout.sessions.create(params, {
    idempotencyKey: `founding-business-${row.reservation}`,
  });
  if (!session.url)
    throw new Error("Checkout URL unavailable. Please try again.");
  await sql()`UPDATE founding_businesses SET checkout_session_id = ${session.id}, checkout_url = ${session.url} WHERE reservation = ${row.reservation} AND paid_at IS NULL`;
  return session.url;
}

export function isPaidFoundingBusinessSession(
  session: Stripe.Checkout.Session,
): boolean {
  return (
    !!session.metadata?.founding_business &&
    session.mode === "subscription" &&
    session.payment_status === "paid" &&
    session.currency === "usd" &&
    session.amount_total === 9900 &&
    !!session.subscription &&
    /^\d+$/.test(session.metadata.user_id || "")
  );
}

/** Observes only this promotion; normal Starter provisioning still runs next. */
export async function handleFoundingBusinessEvent(
  event: Stripe.Event,
): Promise<void> {
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.expired",
      "checkout.session.async_payment_failed",
    ].includes(event.type)
  )
    return;
  const session = event.data.object as Stripe.Checkout.Session;
  if (!session.metadata?.founding_business) return;
  await ensureFoundingBusinesses();
  if (
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    await releaseReservation(session.metadata.founding_business, session.id);
    return;
  }
  if (!isPaidFoundingBusinessSession(session)) {
    // Delayed methods can complete unpaid. Hold the seat, grant nothing until
    // async success; the shared tier handler must also skip unpaid checkout.
    if (session.payment_status !== "paid") return;
    throw new Error("Founding Business payment does not match the offer.");
  }
  const subscription =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription!.id;
  const rows =
    await sql()`UPDATE founding_businesses SET paid_at = COALESCE(paid_at, to_timestamp(${event.created})),
    paid_amount = 9900, subscription_id = ${subscription}, checkout_session_id = ${session.id}, checkout_url = NULL
    WHERE reservation = ${session.metadata.founding_business} AND user_id = ${Number(session.metadata.user_id)}
      AND (checkout_session_id IS NULL OR checkout_session_id = ${session.id}) RETURNING slot`;
  if (!rows.length)
    throw new Error(
      "Founding Business reservation not found; payment needs reconciliation.",
    );
}

export async function getFoundingBusinessAdminRows() {
  await ensureFoundingBusinesses();
  return await sql()`SELECT f.*, u.email FROM founding_businesses f LEFT JOIN users u ON u.id = f.user_id WHERE f.user_id IS NOT NULL ORDER BY f.slot`;
}
export async function updateFoundingBusiness(
  slot: number,
  action: "publish" | "hide" | "spotlight",
) {
  await ensureFoundingBusinesses();
  if (action === "publish")
    await sql()`UPDATE founding_businesses SET published_at = COALESCE(published_at, NOW()),
    feature_expires_at = COALESCE(feature_expires_at, NOW() + INTERVAL '1 year'), hidden = FALSE WHERE slot = ${slot} AND paid_at IS NOT NULL`;
  if (action === "hide")
    await sql()`UPDATE founding_businesses SET hidden = TRUE WHERE slot = ${slot} AND paid_at IS NOT NULL`;
  if (action === "spotlight")
    await sql()`UPDATE founding_businesses SET spotlight_at = COALESCE(spotlight_at, NOW()) WHERE slot = ${slot} AND paid_at IS NOT NULL`;
}

export async function getOwnFoundingBusiness(userId: number) {
  await ensureFoundingBusinesses();
  const rows =
    await sql()`SELECT paid_at, published_at, feature_expires_at, spotlight_at, hidden FROM founding_businesses WHERE user_id = ${userId}`;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    paid: !!r.paid_at,
    published: !!r.published_at && !r.hidden,
    featureEnds: r.feature_expires_at ? String(r.feature_expires_at) : null,
    spotlight: !!r.spotlight_at,
  };
}
