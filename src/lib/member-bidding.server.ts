import { Resend } from "resend";
import { sql } from "~/db";
import { MEMBER_BIDDING_REMIND_DAYS, memberBiddingReminderEmail } from "~/lib/member-bid-activity";

/**
 * "I'm bidding this" (owner 2026-11-26, src/lib/member-notice-link.server.ts): the server side.
 */

export interface BiddingBid {
  id: number;
  title: string;
  /** ISO, or null when the bid publishes no due date. */
  due: string | null;
  open: boolean;
}

/** The bid shown on the confirm page; null when there is no such bid. */
export async function loadBiddingBid(bidId: number): Promise<BiddingBid | null> {
  const [b] = (await sql()`SELECT id, title, due_date FROM bids WHERE id = ${bidId} LIMIT 1`) as { id: number; title: string | null; due_date: string | Date | null }[];
  if (!b) return null;
  const due = b.due_date ? new Date(b.due_date) : null;
  return { id: Number(b.id), title: String(b.title ?? "").trim() || "This bid", due: due ? due.toISOString() : null, open: !due || due.getTime() > Date.now() };
}

/**
 * Save the bid for the member and mark it Preparing. A bid already further along (Submitted, Won,
 * Lost) is left where it is. Tells the owner once per member and bid. Returns false when nothing
 * could be saved.
 */
export async function markMemberBidding(userId: number, bidId: number): Promise<boolean> {
  const [u] = (await sql()`SELECT id FROM users WHERE id = ${userId} LIMIT 1`) as unknown[];
  const [b] = (await sql()`SELECT id FROM bids WHERE id = ${bidId} LIMIT 1`) as unknown[];
  if (!u || !b) return false;
  await sql()`
    INSERT INTO saved_matches (user_id, bid_id, status, pursuit_status)
    VALUES (${userId}, ${bidId}, 'saved', 'preparing')
    ON CONFLICT (user_id, bid_id) DO UPDATE SET
      status = 'saved',
      pursuit_status = CASE WHEN saved_matches.pursuit_status IN ('submitted', 'won', 'lost') THEN saved_matches.pursuit_status ELSE 'preparing' END`;
  try {
    const { alertOwnerOfBidStage } = await import("~/lib/member-bid-activity.server");
    await alertOwnerOfBidStage(userId, bidId, "preparing");
  } catch (e) {
    console.error("[member-bidding] owner alert failed (non-fatal):", (e as Error).message);
  }
  return true;
}

let remindColumn = false;
/**
 * The daily reminder: every saved bid marked Preparing that is due within MEMBER_BIDDING_REMIND_DAYS
 * and has not been reminded, once. Runs with the other deadline reminders. Never throws.
 */
export async function sendMemberBiddingReminders(): Promise<{ due: number; sent: number }> {
  try {
    if (!remindColumn) {
      await sql()`ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS bidding_reminded_at TIMESTAMPTZ`;
      remindColumn = true;
    }
    const rows = (await sql()`
      SELECT sm.id, u.email, b.id AS bid_id, b.title, b.due_date
      FROM saved_matches sm JOIN users u ON u.id = sm.user_id JOIN bids b ON b.id = sm.bid_id
      WHERE sm.status = 'saved' AND sm.pursuit_status = 'preparing' AND sm.bidding_reminded_at IS NULL
        AND b.due_date > NOW() AND b.due_date <= NOW() + ${`${MEMBER_BIDDING_REMIND_DAYS} days`}::interval
        AND u.email IS NOT NULL
      ORDER BY b.due_date LIMIT 200`) as { id: number; email: string; bid_id: number; title: string | null; due_date: string | Date }[];
    const key = process.env.RESEND_API_KEY;
    if (!rows.length || !key) return { due: rows.length, sent: 0 };
    const resend = new Resend(key);
    let sent = 0;
    for (const r of rows) {
      const due = new Date(r.due_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
      const mail = memberBiddingReminderEmail({ title: String(r.title ?? ""), due, bidId: Number(r.bid_id) });
      try {
        const { error } = await resend.emails.send({ from: "Contrax <hello@contrax.company>", replyTo: "contrax.companyllc@gmail.com", to: [r.email], subject: mail.subject, text: mail.text });
        if (error) continue;
        await sql()`UPDATE saved_matches SET bidding_reminded_at = NOW() WHERE id = ${r.id}`;
        sent++;
      } catch (e) {
        console.error("[member-bidding] a reminder failed:", (e as Error).message.slice(0, 120));
      }
    }
    return { due: rows.length, sent };
  } catch (e) {
    console.error("[member-bidding] reminders failed (non-fatal):", (e as Error).message);
    return { due: 0, sent: 0 };
  }
}
