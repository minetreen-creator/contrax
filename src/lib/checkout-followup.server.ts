/**
 * Sends the checkout follow-up (rules in checkout-followup.ts). Run hourly by
 * Vercel Cron via /api/cron/checkout-followup, because only Vercel holds the
 * Stripe key and the secret that signs unsubscribe links.
 *
 * The address comes from the Contrax account (metadata.user_id) when the buyer
 * was signed in, else from what they typed on the Stripe page. Skipped: paying
 * accounts, anyone who completed any checkout in the window, admin and test
 * addresses, outreach suppressions, and addresses already followed up.
 */
import { Resend } from "resend";
import type Stripe from "stripe";
import { sql } from "~/db";
import { isAdminEmail } from "~/lib/admin";
import { checkoutFollowupEmail, followupCandidate, FOLLOWUP_WINDOW_HOURS } from "~/lib/checkout-followup";
import { validPostalAddress } from "~/lib/outreach";
import { ensureOutreach, getPostalAddress, OUTREACH_FROM, OUTREACH_REPLY_TO, unsubscribeUrl } from "~/lib/outreach.server";
import { getStripe } from "~/lib/stripe";

export async function runCheckoutFollowups(nowMs: number = Date.now()): Promise<{ checked: number; sent: number; failed: number }> {
  await ensureOutreach();
  await sql()`CREATE TABLE IF NOT EXISTS checkout_followups (
    email TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    plan_tier TEXT,
    resend_id TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  const postal = await getPostalAddress();
  if (!validPostalAddress(postal)) {
    console.warn("[checkout-followup] no mailing address set; nothing sent");
    return { checked: 0, sent: 0, failed: 0 };
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[checkout-followup] RESEND_API_KEY not set; nothing sent");
    return { checked: 0, sent: 0, failed: 0 };
  }

  const sessions: Stripe.Checkout.Session[] = [];
  const gte = Math.floor(nowMs / 1000) - FOLLOWUP_WINDOW_HOURS * 3600;
  for await (const s of getStripe().checkout.sessions.list({ created: { gte }, limit: 100 })) sessions.push(s);

  const emailOf = async (s: (typeof sessions)[number]): Promise<{ email: string | null; paying: boolean }> => {
    const uid = s.metadata?.user_id;
    if (uid && /^\d+$/.test(uid)) {
      const [u] = (await sql()`SELECT email, subscription_status FROM users WHERE id = ${Number(uid)}`) as { email: string | null; subscription_status: string | null }[];
      if (u?.email) return { email: u.email, paying: u.subscription_status === "active" };
    }
    return { email: s.customer_details?.email ?? s.customer_email ?? null, paying: false };
  };

  // Anyone who finished a checkout in the window is never chased for an older one.
  const done = new Set<string>();
  for (const s of sessions) {
    if (s.status !== "complete") continue;
    const { email } = await emailOf(s);
    if (email) done.add(email.trim().toLowerCase());
  }

  const resend = new Resend(key);
  let checked = 0;
  let sent = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (const s of sessions) {
    const lite = { id: s.id, status: s.status, paymentStatus: s.payment_status, created: s.created, metadata: s.metadata as Record<string, string> | null };
    if (!followupCandidate(lite, nowMs)) continue;
    checked++;
    const { email: raw, paying } = await emailOf(s);
    const email = raw?.trim().toLowerCase();
    if (!email || paying || done.has(email) || seen.has(email)) continue;
    seen.add(email);
    if (isAdminEmail(email) || email.endsWith("@test.contrax")) continue;
    const [suppressed] = (await sql()`SELECT 1 AS x FROM outreach_suppressions WHERE email = ${email}`) as unknown[];
    if (suppressed) continue;
    const claimed = (await sql()`
      INSERT INTO checkout_followups (email, session_id, plan_tier) VALUES (${email}, ${s.id}, ${s.metadata?.plan_tier ?? null})
      ON CONFLICT (email) DO NOTHING RETURNING email`) as unknown[];
    if (!claimed.length) continue;
    const unsub = unsubscribeUrl(email);
    const mail = checkoutFollowupEmail({ metadata: lite.metadata, postalAddress: postal!, unsubscribeUrl: unsub });
    try {
      const { data, error } = await resend.emails.send({
        from: OUTREACH_FROM,
        to: email,
        replyTo: OUTREACH_REPLY_TO,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      if (error) throw new Error(error.message);
      await sql()`UPDATE checkout_followups SET resend_id = ${data?.id ?? null} WHERE email = ${email}`;
      sent++;
    } catch (e) {
      // Release the claim so the next hourly run retries.
      await sql()`DELETE FROM checkout_followups WHERE email = ${email}`;
      console.error("[checkout-followup] send failed:", e instanceof Error ? e.message : e);
      failed++;
    }
  }
  console.log(`[checkout-followup] ${sessions.length} session(s), ${checked} unpaid in range, ${sent} sent, ${failed} failed`);
  return { checked, sent, failed };
}
