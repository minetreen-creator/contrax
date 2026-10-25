import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { captureRadarLead, type RadarLeadStatus } from "~/lib/radar-lead-capture.server";
import { sendBidReminderEmail } from "~/lib/email";
import { reminderAt } from "~/lib/max";

/**
 * Max deadline reminders (owner 2026-10-25, "5": "remind me before it
 * closes"). The visitor leaves an email on a bid card; we store one reminder
 * and email it REMIND_DAYS_BEFORE days before the deadline (src/lib/max.ts).
 *
 * The email goes through the same opt-in as Radar alerts: the address becomes
 * a radar_leads row (confirmation email to that address only), and a reminder
 * is only ever sent once that address is confirmed, consented and not
 * unsubscribed. So nobody can make Max email a stranger.
 */
export async function ensureMaxRemindersTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS max_bid_reminders (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    bid_id INTEGER NOT NULL,
    remind_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (email, bid_id)
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS max_bid_reminders_due_idx ON max_bid_reminders (remind_at) WHERE sent_at IS NULL`;
}

export type CreateReminderResult =
  | { ok: true; lead: RadarLeadStatus; remindAt: string; due: string }
  | { ok: false; reason: "no_bid" | "too_soon" | "unsubscribed" | "limit" };

/** maxActive: reminders an address may have waiting at once (MAX_TIER_LIMITS; Infinity on paid plans). */
export async function createBidReminder(input: { email: string; bidId: number; visitorId: string | null; sendConfirmation: boolean; maxActive?: number }): Promise<CreateReminderResult> {
  const [bid] = (await sql().query(`SELECT id, due_date FROM bids WHERE id = $1 AND due_date > NOW() AND ${AWARD_EXCLUSION_SQL}`, [input.bidId])) as { id: number; due_date: string }[];
  if (!bid) return { ok: false, reason: "no_bid" };
  const at = reminderAt(new Date(bid.due_date).toISOString());
  if (!at) return { ok: false, reason: "too_soon" };
  const lead = await captureRadarLead({ email: input.email, visitorId: input.visitorId, radarProfile: null, source: "max_reminder", sendConfirmation: input.sendConfirmation });
  if (lead === "unsubscribed") return { ok: false, reason: "unsubscribed" };
  await ensureMaxRemindersTable();
  if (Number.isFinite(input.maxActive)) {
    const [c] = (await sql()`
      SELECT COUNT(*)::int AS n FROM max_bid_reminders
      WHERE email = ${input.email} AND sent_at IS NULL AND bid_id <> ${bid.id}`) as { n: number }[];
    if ((c?.n ?? 0) >= (input.maxActive as number)) return { ok: false, reason: "limit" };
  }
  await sql()`
    INSERT INTO max_bid_reminders (email, bid_id, remind_at) VALUES (${input.email}, ${bid.id}, ${at.toISOString()})
    ON CONFLICT (email, bid_id) DO UPDATE SET remind_at = EXCLUDED.remind_at WHERE max_bid_reminders.sent_at IS NULL`;
  return { ok: true, lead, remindAt: at.toISOString(), due: new Date(bid.due_date).toISOString() };
}

/** The daily sender (src/jobs/send-max-reminders.ts): every due reminder for a confirmed lead, once. */
export async function sendDueBidReminders(): Promise<{ due: number; sent: number }> {
  await ensureMaxRemindersTable();
  const rows = (await sql()`
    SELECT r.id, r.email, b.id AS bid_id, b.title, b.agency, b.due_date, l.unsubscribe_token
    FROM max_bid_reminders r
    JOIN radar_leads l ON l.email = r.email
    JOIN bids b ON b.id = r.bid_id
    WHERE r.sent_at IS NULL AND r.remind_at <= NOW() AND b.due_date > NOW()
      AND l.confirmed_at IS NOT NULL AND l.unsubscribed_at IS NULL AND l.consent = TRUE
    ORDER BY r.remind_at
    LIMIT 500`) as { id: number; email: string; bid_id: number; title: string; agency: string | null; due_date: string; unsubscribe_token: string }[];
  let sent = 0;
  for (const r of rows) {
    const due = new Date(r.due_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
    const unsub = `https://www.contrax.company/api/radar/lead-unsubscribe?token=${encodeURIComponent(r.unsubscribe_token)}`;
    if (await sendBidReminderEmail(r.email, { id: r.bid_id, title: r.title, agency: r.agency, due }, unsub)) {
      await sql()`UPDATE max_bid_reminders SET sent_at = NOW() WHERE id = ${r.id}`;
      sent++;
    }
  }
  return { due: rows.length, sent };
}
