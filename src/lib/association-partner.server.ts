import type Stripe from "stripe";
import { sql } from "~/db";
import { getStripe } from "~/lib/stripe";
import {
  PARTNER_CENTS,
  PARTNER_PRODUCT,
  PARTNER_PRODUCT_DESCRIPTION,
  PARTNER_PRODUCT_NAME,
  partnerMetadata,
  partnerOwnerAlert,
  type PartnerForm,
} from "~/lib/association-partner";

/** See src/lib/association-partner.ts (owner 2026-11-05). */
const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";
const OWNER_EMAIL = "minetreen@gmail.com";

let ready = false;
export async function ensurePartnerTable(): Promise<void> {
  if (ready) return;
  await sql()`CREATE TABLE IF NOT EXISTS association_partners (
    id SERIAL PRIMARY KEY,
    organization TEXT NOT NULL,
    contact_name TEXT,
    email TEXT NOT NULL,
    region TEXT,
    website TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  ready = true;
}

/** A Stripe Checkout URL for the $149/month Association Partner subscription. */
export async function createPartnerCheckout(form: PartnerForm): Promise<string> {
  const metadata = partnerMetadata(form);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: form.email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: PARTNER_CENTS,
          recurring: { interval: "month" },
          product_data: { name: PARTNER_PRODUCT_NAME, description: PARTNER_PRODUCT_DESCRIPTION },
        },
        quantity: 1,
      },
    ],
    metadata,
    subscription_data: { metadata },
    custom_text: { submit: { message: "Your first weekly bid list for your region arrives within one business day. Questions? Reply to any Contrax email and Nathaniel answers." } },
    success_url: `${BASE_URL}/associations?checkout=success`,
    cancel_url: `${BASE_URL}/associations?checkout=canceled#start`,
  });
  if (!session.url) throw new Error("Checkout URL unavailable");
  return session.url;
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

/**
 * Consume Association Partner events in the one verified webhook. Returns
 * false for every other product so the existing flows run unchanged.
 */
export async function handlePartnerEvent(event: Stripe.Event): Promise<boolean> {
  const supported = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"];
  if (!supported.includes(event.type)) return false;

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.metadata?.product !== PARTNER_PRODUCT) return false;
    const subId = idOf(s.subscription);
    const email = (s.customer_details?.email ?? s.customer_email ?? "").trim().toLowerCase();
    if (!subId || !email) throw new Error("Association Partner checkout missing subscription or email");
    await ensurePartnerTable();
    const m = s.metadata ?? {};
    const inserted = (await sql()`
      INSERT INTO association_partners (organization, contact_name, email, region, website, stripe_customer_id, stripe_subscription_id, status)
      VALUES (${m.organization || "Association"}, ${m.contact_name || null}, ${email}, ${m.region || null}, ${m.website || null}, ${idOf(s.customer)}, ${subId}, 'active')
      ON CONFLICT (stripe_subscription_id) DO NOTHING
      RETURNING id`) as { id: number }[];
    if (inserted.length) await tellOwner(m.organization || "An association", email, m.region || "");
    return true;
  }

  const obj = event.data.object as unknown as Record<string, unknown>;
  const subId = event.type.startsWith("customer.subscription.") ? idOf(obj.id) : idOf(obj.subscription);
  if (!subId) return false;
  await ensurePartnerTable();
  const known = (await sql()`SELECT id FROM association_partners WHERE stripe_subscription_id = ${subId}`) as { id: number }[];
  const tagged = event.type.startsWith("customer.subscription.") && (obj.metadata as Record<string, string> | undefined)?.product === PARTNER_PRODUCT;
  if (!known.length && !tagged) return false;
  if (!known.length) return true; // the checkout event will create the row
  const status =
    event.type === "customer.subscription.deleted"
      ? "canceled"
      : event.type === "invoice.payment_failed"
        ? "past_due"
        : String(obj.status ?? "active");
  await sql()`UPDATE association_partners SET status = ${status}, updated_at = NOW() WHERE stripe_subscription_id = ${subId}`;
  return true;
}

async function tellOwner(organization: string, email: string, region: string): Promise<void> {
  const alert = partnerOwnerAlert(organization, email);
  try {
    const { alertOwner } = await import("~/lib/live-push.server");
    await alertOwner(alert);
  } catch (e) {
    console.error("[association-partner] owner push failed:", (e as Error).message);
  }
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = await import("resend");
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Contrax <hello@contrax.company>",
      to: OWNER_EMAIL,
      subject: `💰 New Association Partner: ${organization} ($149/month)`,
      text: `${organization} just subscribed to the $149/month Association Partner plan.\n\nContact: ${email}\nRegion: ${region || "(not given)"}\n\nSend their first weekly bid list within one business day (the checkout page promised it). Build it with the "Association bid list" workflow.`,
    });
  } catch (e) {
    console.error("[association-partner] owner email failed:", (e as Error).message);
  }
}

/** Active partners and this month's partner revenue, for the Command Center. */
export async function partnerCounts(): Promise<{ active: number; newThisWeek: number }> {
  try {
    await ensurePartnerTable();
    const [r] = (await sql()`SELECT COUNT(*) FILTER (WHERE status IN ('active','trialing'))::int AS active,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_week FROM association_partners`) as { active: number; new_week: number }[];
    return { active: Number(r?.active ?? 0), newThisWeek: Number(r?.new_week ?? 0) };
  } catch {
    return { active: 0, newThisWeek: 0 };
  }
}
