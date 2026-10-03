/**
 * Weekly bid digest for free Basic users — CLI entrypoint
 * (`bun run weekly-digest`).
 *
 * Runs every morning from .github/workflows/daily-emails.yml right after the
 * daily digest, and sends only on Mondays (New York) — never twice within
 * WEEKLY_DIGEST_MIN_GAP_DAYS, so a manual re-run is safe. Set
 * WEEKLY_DIGEST_FORCE=1 to send on another day (the gap rule still applies).
 *
 * Who and what: src/lib/weekly-digest.ts. Unsubscribes and each address's
 * unsubscribe token live in `email_preferences`; a send is recorded in
 * weekly_digest_log only when Resend accepted at least one email.
 */
import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { sendWeeklyBidDigest, type NewBidSummary } from "~/lib/email";
import { foundingSpotsRemaining } from "~/lib/stripe";
import type { DigestUserRow } from "~/lib/digest-recipients";
import {
  shouldSendWeeklyDigest,
  weeklyDigestRecipients,
  weeklyUnsubscribeUrl,
  weeklyWindowBounds,
} from "~/lib/weekly-digest";

export async function ensureWeeklyDigestTables(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS email_preferences (
      email_lower TEXT PRIMARY KEY,
      unsubscribe_token TEXT NOT NULL UNIQUE,
      weekly_digest_unsubscribed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql()`
    CREATE TABLE IF NOT EXISTS weekly_digest_log (
      id SERIAL PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      window_start TIMESTAMPTZ NOT NULL,
      bids INTEGER NOT NULL,
      recipients INTEGER NOT NULL
    )
  `;
}

export async function sendWeeklyDigest(
  force: boolean = process.env.WEEKLY_DIGEST_FORCE === "1",
): Promise<{ bids: number; recipients: number; sent: boolean; reason?: string }> {
  await ensureWeeklyDigestTables();
  const last = (await sql()`SELECT MAX(sent_at) AS last FROM weekly_digest_log`) as { last: string | null }[];
  const lastSent = last[0]?.last ?? null;
  const now = new Date();
  if (!shouldSendWeeklyDigest(lastSent, now.getTime(), force)) {
    return { bids: 0, recipients: 0, sent: false, reason: "not the weekly send day (or sent within the last 6 days)" };
  }
  // The window ends 72 hours ago: newer bids are in their paid head start
  // (src/lib/head-start.ts) and are only counted, never listed.
  const { start: since, end: until } = weeklyWindowBounds(lastSent, now.getTime());

  const bids = (await sql()`
    SELECT id AS bid_id, title, agency, source_url, location, due_date, set_aside, source
    FROM bids
    WHERE created_at > ${since.toISOString()}
      AND created_at <= ${until.toISOString()}
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
  const headStart = (await sql()`
    SELECT COUNT(*)::int AS n FROM bids
    WHERE created_at > ${until.toISOString()}
      AND due_date > NOW()
      AND ${sql().unsafe(LOW_CONTENT_SQL)}
      AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
  `) as { n: number }[];
  const headStartCount = Number(headStart[0]?.n ?? 0);
  console.log(`📧 Weekly digest window ${since.toISOString()} → ${until.toISOString()}: ${newBids.length} open bid(s); ${headStartCount} newer in head start`);
  if (newBids.length === 0) return { bids: 0, recipients: 0, sent: false, reason: "no new bids" };

  const users = (await sql()`
    SELECT u.email, u.is_admin, u.plan_tier, u.trial_started_at, u.subscription_status,
           u.access_expires_at, u.full_access,
           EXISTS (
             SELECT 1 FROM bid_scout_subscriptions s
             WHERE s.user_id = u.id AND s.status = 'active'
           ) AS has_bid_scout
    FROM users u
  `) as DigestUserRow[];
  const optedOut = (await sql()`
    SELECT email_lower FROM email_preferences WHERE weekly_digest_unsubscribed_at IS NOT NULL
  `) as { email_lower: string }[];
  const recipients = weeklyDigestRecipients(users, new Set(optedOut.map((r) => r.email_lower)), now.getTime());
  if (recipients.length === 0) return { bids: newBids.length, recipients: 0, sent: false, reason: "no free recipients" };

  const lowered = recipients.map((e) => e.toLowerCase());
  await sql()`
    INSERT INTO email_preferences (email_lower, unsubscribe_token)
    SELECT e, replace(gen_random_uuid()::text, '-', '') FROM unnest(${lowered}::text[]) AS e
    ON CONFLICT (email_lower) DO NOTHING
  `;
  const tokens = (await sql()`
    SELECT email_lower, unsubscribe_token FROM email_preferences WHERE email_lower = ANY(${lowered}::text[])
  `) as { email_lower: string; unsubscribe_token: string }[];
  const tokenOf = new Map(tokens.map((t) => [t.email_lower, t.unsubscribe_token]));
  const addressed = recipients
    .filter((e) => tokenOf.has(e.toLowerCase()))
    .map((e) => ({ email: e, unsubscribeUrl: weeklyUnsubscribeUrl(tokenOf.get(e.toLowerCase())!) }));

  // Founding-member spots left (null when Stripe can't be read: the email then shows $19/month).
  const foundingSpots = await foundingSpotsRemaining();
  const accepted = await sendWeeklyBidDigest(addressed, newBids, headStartCount, foundingSpots);
  if (accepted > 0) {
    await sql()`
      INSERT INTO weekly_digest_log (sent_at, window_start, bids, recipients)
      VALUES (${now.toISOString()}, ${since.toISOString()}, ${newBids.length}, ${accepted})
    `;
  }
  return { bids: newBids.length, recipients: accepted, sent: accepted > 0 };
}

if (import.meta.main) {
  try {
    const r = await sendWeeklyDigest();
    console.log(
      `🏁 Weekly digest finished — bids=${r.bids} recipients=${r.recipients} sent=${r.sent}${r.reason ? ` (${r.reason})` : ""}`,
    );
    process.exit(0);
  } catch (e) {
    console.error("💥 Weekly digest crashed:", e);
    process.exit(1);
  }
}
