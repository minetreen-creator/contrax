import { Resend } from "resend";
import { sql } from "~/db";
import { memberWinOwnerAlert, type MemberWinSource } from "~/lib/member-win-alert";
import { OWNER_EMAIL } from "~/lib/starter-pass.server";

let ensured = false;
async function ensureColumn(): Promise<void> {
  if (ensured) return;
  await sql()`ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS won_alerted_at TIMESTAMPTZ`;
  ensured = true;
}

/**
 * Tell the owner once that this member won this bid: a phone push and an email. The first caller
 * to set won_alerted_at sends; every later save or morning check finds it set and stays quiet.
 * Never throws: a failed alert must not fail the member's save or the award job.
 */
export async function alertOwnerOfMemberWin(userId: number, bidId: number, source: MemberWinSource, amount?: number | null): Promise<boolean> {
  try {
    await ensureColumn();
    const claimed = (await sql()`
      UPDATE saved_matches SET won_alerted_at = NOW()
      WHERE user_id = ${userId} AND bid_id = ${bidId} AND status = 'saved' AND won_alerted_at IS NULL
      RETURNING id`) as unknown[];
    if (!claimed.length) return false;
    const [row] = (await sql()`
      SELECT u.email, u.is_admin, b.title, b.agency FROM users u LEFT JOIN bids b ON b.id = ${bidId} WHERE u.id = ${userId}`) as {
      email: string | null; is_admin: boolean | null; title: string | null; agency: string | null;
    }[];
    // The owner testing his own pipeline is not a member's win.
    if (!row || row.is_admin) return false;
    const alert = memberWinOwnerAlert({ memberEmail: row.email, title: row.title, agency: row.agency, amount, source, bidId });
    try {
      const { alertOwner } = await import("~/lib/live-push.server");
      await alertOwner(alert.push);
    } catch (e) {
      console.error("[member-win] owner push failed:", (e as Error).message);
    }
    if (process.env.RESEND_API_KEY) {
      try {
        await new Resend(process.env.RESEND_API_KEY).emails.send({ from: "Contrax <hello@contrax.company>", to: OWNER_EMAIL, subject: alert.subject, text: alert.text });
      } catch (e) {
        console.error("[member-win] owner email failed:", (e as Error).message);
      }
    }
    return true;
  } catch (e) {
    console.error("[member-win] alert failed (non-fatal):", (e as Error).message);
    return false;
  }
}
