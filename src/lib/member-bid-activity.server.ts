import { Resend } from "resend";
import { sql } from "~/db";
import { memberBidStageOwnerAlert, memberNoticeOpenOwnerAlert, type MemberBidStage } from "~/lib/member-bid-activity";
import { OWNER_EMAIL } from "~/lib/starter-pass.server";

type Alert = { subject: string; text: string; push: { title: string; body: string; tag: string; url: string } };

async function tellOwner(alert: Alert): Promise<void> {
  try {
    const { alertOwner } = await import("~/lib/live-push.server");
    await alertOwner(alert.push);
  } catch (e) {
    console.error("[member-bid] owner push failed:", (e as Error).message);
  }
  if (!process.env.RESEND_API_KEY) return;
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({ from: "Contrax <hello@contrax.company>", to: OWNER_EMAIL, subject: alert.subject, text: alert.text });
  } catch (e) {
    console.error("[member-bid] owner email failed:", (e as Error).message);
  }
}

async function memberAndBid(userId: number, bidId: number) {
  const [row] = (await sql()`
    SELECT u.email, u.is_admin, b.title, b.agency FROM users u LEFT JOIN bids b ON b.id = ${bidId} WHERE u.id = ${userId}`) as {
    email: string | null; is_admin: boolean | null; title: string | null; agency: string | null;
  }[];
  // The owner testing his own account is not a member working a bid.
  return row && !row.is_admin ? row : null;
}

let stageColumns = false;
/** Tell the owner once per member, bid and stage. Never throws: a failed alert must not fail the member's save. */
export async function alertOwnerOfBidStage(userId: number, bidId: number, stage: MemberBidStage): Promise<boolean> {
  try {
    if (!stageColumns) {
      await sql()`ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS preparing_alerted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS submitted_alerted_at TIMESTAMPTZ`;
      stageColumns = true;
    }
    const claimed = (stage === "submitted"
      ? await sql()`UPDATE saved_matches SET submitted_alerted_at = NOW() WHERE user_id = ${userId} AND bid_id = ${bidId} AND status = 'saved' AND submitted_alerted_at IS NULL RETURNING id`
      : await sql()`UPDATE saved_matches SET preparing_alerted_at = NOW() WHERE user_id = ${userId} AND bid_id = ${bidId} AND status = 'saved' AND preparing_alerted_at IS NULL AND submitted_alerted_at IS NULL RETURNING id`) as unknown[];
    if (!claimed.length) return false;
    const row = await memberAndBid(userId, bidId);
    if (!row) return false;
    await tellOwner(memberBidStageOwnerAlert({ memberEmail: row.email, title: row.title, agency: row.agency, stage, bidId }));
    return true;
  } catch (e) {
    console.error("[member-bid] stage alert failed (non-fatal):", (e as Error).message);
    return false;
  }
}

let opensTable = false;
/**
 * Record that a signed-in member opened a bid's official notice (one row per member and bid), and
 * tell the owner for the first one each member opens in a day. Never throws.
 */
export async function recordNoticeOpen(userId: number, bidId: number): Promise<"new" | "seen" | "failed"> {
  try {
    if (!opensTable) {
      await sql()`CREATE TABLE IF NOT EXISTS bid_notice_opens (
        user_id INTEGER NOT NULL, bid_id INTEGER NOT NULL, opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, bid_id))`;
      opensTable = true;
    }
    const added = (await sql()`INSERT INTO bid_notice_opens (user_id, bid_id) VALUES (${userId}, ${bidId}) ON CONFLICT DO NOTHING RETURNING opened_at`) as unknown[];
    if (!added.length) return "seen";
    const [today] = (await sql()`SELECT COUNT(*)::int AS n FROM bid_notice_opens WHERE user_id = ${userId} AND opened_at > NOW() - INTERVAL '24 hours'`) as { n: number }[];
    if ((today?.n ?? 0) > 1) return "new";
    const row = await memberAndBid(userId, bidId);
    if (row) await tellOwner(memberNoticeOpenOwnerAlert({ memberEmail: row.email, title: row.title, agency: row.agency, bidId }));
    return "new";
  } catch (e) {
    console.error("[member-bid] notice open failed (non-fatal):", (e as Error).message);
    return "failed";
  }
}
