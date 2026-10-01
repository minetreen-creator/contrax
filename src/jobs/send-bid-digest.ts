/**
 * Morning bid digest — CLI entrypoint (`bun run bid-digest`).
 *
 * Runs once a day from .github/workflows/daily-emails.yml (owner 2026-10-01:
 * "people shouldn't get emails every 4 hours, just once a day in the
 * morning"). The 4-hourly sync no longer emails anyone.
 *
 * It sends ONE email listing the open bids added since the last digest that
 * was actually sent (src/lib/digest-recipients.ts → digestWindowStart), to the
 * paying/trial/Bid Scout/admin users chosen by digestRecipients. A send is
 * recorded in bid_digest_log only when Resend accepted it, so a failed morning
 * is covered by the next one instead of being lost.
 */
import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { sendBidDigest, type NewBidSummary } from "~/lib/email";
import { digestRecipients, digestWindowStart, type DigestUserRow } from "~/lib/digest-recipients";

export async function ensureBidDigestLog(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS bid_digest_log (
      id SERIAL PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      window_start TIMESTAMPTZ NOT NULL,
      bids INTEGER NOT NULL,
      recipients INTEGER NOT NULL
    )
  `;
}

export async function sendMorningBidDigest(): Promise<{ bids: number; recipients: number; sent: boolean }> {
  await ensureBidDigestLog();
  const last = (await sql()`SELECT MAX(sent_at) AS last FROM bid_digest_log`) as { last: string | null }[];
  const since = digestWindowStart(last[0]?.last ?? null);
  const now = new Date();

  const bids = (await sql()`
    SELECT id AS bid_id, title, agency, source_url, location, due_date, set_aside, source
    FROM bids
    WHERE created_at > ${since.toISOString()}
      AND created_at <= ${now.toISOString()}
      AND due_date > NOW()
      AND ${sql().unsafe(LOW_CONTENT_SQL)}
      AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
  `) as any[];
  const newBids: NewBidSummary[] = bids.map((b) => ({
    bid_id: Number(b.bid_id),
    title: String(b.title ?? ""),
    agency: String(b.agency ?? ""),
    source_url: String(b.source_url ?? ""),
    location: String(b.location ?? ""),
    due_date: b.due_date ? new Date(b.due_date).toISOString() : null,
    set_aside: b.set_aside ?? null,
    source: b.source ?? undefined,
  }));
  console.log(`📧 Morning digest window ${since.toISOString()} → ${now.toISOString()}: ${newBids.length} new open bid(s)`);
  if (newBids.length === 0) return { bids: 0, recipients: 0, sent: false };

  const users = (await sql()`
    SELECT u.email, u.is_admin, u.plan_tier, u.trial_started_at, u.subscription_status,
           u.access_expires_at, u.full_access,
           EXISTS (
             SELECT 1 FROM bid_scout_subscriptions s
             WHERE s.user_id = u.id AND s.status = 'active'
           ) AS has_bid_scout
    FROM users u
  `) as DigestUserRow[];
  const recipients = digestRecipients(users);
  if (recipients.length === 0) {
    console.log(`📧 No paying or trial users among ${users.length} accounts — no digest sent`);
    return { bids: newBids.length, recipients: 0, sent: false };
  }

  const sent = await sendBidDigest(recipients, newBids);
  if (sent) {
    await sql()`
      INSERT INTO bid_digest_log (sent_at, window_start, bids, recipients)
      VALUES (${now.toISOString()}, ${since.toISOString()}, ${newBids.length}, ${recipients.length})
    `;
  }
  return { bids: newBids.length, recipients: recipients.length, sent };
}

if (import.meta.main) {
  try {
    const r = await sendMorningBidDigest();
    console.log(`🏁 Morning digest finished — bids=${r.bids} recipients=${r.recipients} sent=${r.sent}`);
    process.exit(0);
  } catch (e) {
    console.error("💥 Morning digest crashed:", e);
    process.exit(1);
  }
}
