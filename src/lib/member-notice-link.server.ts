/**
 * Links in the paid morning email (owner 2026-11-26: "Nobody has put in a bid or won a bid").
 *
 * The email used to link each bid straight to the government's own page, so a member could read
 * and bid from their inbox and Contrax recorded nothing: ten paying members, seven with no visit
 * after the day they paid, and no way to tell whether they were using what they paid for.
 *
 * Each bid now links to /api/member/notice, which records that this member opened this notice
 * (src/lib/member-bid-activity.server.ts, the same record the bid page makes) and sends them on
 * to the same government page. The link is signed, so it only opens the notice for the member it
 * was emailed to; a link that fails the check opens the bid's Contrax page instead, which applies
 * the members-only lock.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const MEMBER_NOTICE_PATH = "https://www.contrax.company/api/member/notice";
/** Notices one member may open inside SWEEP_SECONDS before the opens stop being recorded: a mail
 *  security scanner follows every link in an email at once, and that is not a person reading. */
export const NOTICE_SWEEP_LIMIT = 3;
export const NOTICE_SWEEP_SECONDS = 60;

function key(env: Record<string, string | undefined> = process.env): Buffer | null {
  // The mail key first: every place that sends the email has it, so the link and the check agree.
  const secret = env.RESEND_API_KEY || env.CRON_SECRET || env.OUTREACH_SECRET;
  return secret ? createHmac("sha256", "contrax-member-notice").update(secret).digest() : null;
}

function sign(userId: number, bidId: number, k: Buffer): string {
  return createHmac("sha256", k).update(`${userId}:${bidId}`).digest("base64url").slice(0, 22);
}

/** The signed link for one member and bid, or null when it cannot be signed (the caller keeps the plain link). */
export function memberNoticeUrl(userId: number, bidId: number, env?: Record<string, string | undefined>): string | null {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(bidId) || bidId <= 0) return null;
  const k = key(env);
  if (!k) return null;
  return `${MEMBER_NOTICE_PATH}?b=${bidId}&u=${userId}&s=${sign(userId, bidId, k)}`;
}

/** True when `sig` is this member's signature for this bid. */
export function verifyMemberNotice(userId: number, bidId: number, sig: string, env?: Record<string, string | undefined>): boolean {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(bidId) || bidId <= 0) return false;
  const k = key(env);
  if (!k) return false;
  const a = Buffer.from(String(sig ?? ""));
  const b = Buffer.from(sign(userId, bidId, k));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The email's bids with each link swapped for the member's signed one. Bids without an id, and every bid when signing is unavailable, keep their own link. */
export function withMemberNoticeLinks<T extends { source_url: string; bid_id?: number }>(userId: number | null | undefined, bids: readonly T[], env?: Record<string, string | undefined>): T[] {
  const id = Number(userId);
  return bids.map((b) => {
    const url = b.bid_id ? memberNoticeUrl(id, Number(b.bid_id), env) : null;
    return url ? { ...b, source_url: url } : { ...b };
  });
}
