/**
 * Contrax app notifications (owner 2026-11-07). Two passes, both for paid
 * members with a phone signed up in the app:
 *
 *   default      new bids from the last 24 hours that match the member's
 *                business profile (the same matcher as the 6 AM digest email);
 *                one buzz per run with the batch. Run after every bid sync.
 *   --due-soon   bids the member saved that are due in the next ~2 days.
 *                Run once a day.
 *
 * Nothing is sent between 9 PM and 7 AM Eastern; matches found overnight stay
 * unsent and go out on the first run after 7 AM. member_push_log makes every
 * bid buzz a member at most once per kind.
 */
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { buildDigestMatcher } from "~/lib/digest-match";
import { primaryProfile } from "~/lib/trial-recap.server";
import { hasPaidBidAccess } from "~/lib/head-start.server";
import { dueSoonPush, inSendingHours, newMatchesPush } from "~/lib/member-push";
import { alreadySent, claimUnsent, pushToMember, subscribedMemberIds } from "~/lib/member-push.server";

/** Most bids one buzz names; the rest wait in the app's "New for you" list. */
const MAX_PER_PUSH = 25;

async function paidMember(userId: number): Promise<boolean> {
  const rows = (await sql()`SELECT id, is_admin FROM users WHERE id = ${userId} LIMIT 1`) as { id: number; is_admin: boolean }[];
  return rows[0] ? hasPaidBidAccess(rows[0]) : false;
}

export async function pushNewMatches(): Promise<{ members: number; pushed: number }> {
  const members = await subscribedMemberIds();
  if (!members.length) return { members: 0, pushed: 0 };
  const bids = (await sql()`
    SELECT id, title, agency, location, description, category, naics_code
    FROM bids
    WHERE created_at > NOW() - INTERVAL '24 hours' AND due_date > NOW()
      AND ${sql().unsafe(LOW_CONTENT_SQL)} AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
    ORDER BY created_at DESC
  `) as { id: number; title: string | null; agency: string | null; location: string | null; description: string | null; category: string | null; naics_code: string | null }[];
  let pushed = 0;
  for (const userId of members) {
    try {
      if (!(await paidMember(userId))) continue;
      const matcher = buildDigestMatcher(await primaryProfile(userId));
      // No trade or state on file: we cannot tell what they want, so no buzz.
      if (!matcher.personal) continue;
      const mine = bids.filter((b) => matcher.matches(b));
      if (!mine.length) continue;
      const sent = await alreadySent(userId, mine.map((b) => Number(b.id)), "match");
      const fresh = mine.filter((b) => !sent.has(Number(b.id))).slice(0, MAX_PER_PUSH);
      if (!fresh.length) continue;
      const claimed = new Set(await claimUnsent(userId, fresh.map((b) => Number(b.id)), "match"));
      const batch = fresh.filter((b) => claimed.has(Number(b.id)));
      const payload = newMatchesPush(batch.map((b) => ({ id: Number(b.id), title: String(b.title ?? ""), agency: String(b.agency ?? "") })), matcher.label);
      if (payload && (await pushToMember(userId, payload)) > 0) pushed++;
    } catch (e) {
      console.error("[push-bid-alerts] member failed:", (e as Error).message);
    }
  }
  return { members: members.length, pushed };
}

export async function pushDueSoon(now: number = Date.now()): Promise<{ members: number; pushed: number }> {
  const members = await subscribedMemberIds();
  if (!members.length) return { members: 0, pushed: 0 };
  let pushed = 0;
  for (const userId of members) {
    try {
      if (!(await paidMember(userId))) continue;
      const rows = (await sql()`
        SELECT b.id, b.title, b.due_date FROM saved_matches s JOIN bids b ON b.id = s.bid_id
        WHERE s.user_id = ${userId} AND s.status = 'saved'
          AND b.due_date > NOW() + INTERVAL '12 hours' AND b.due_date <= NOW() + INTERVAL '60 hours'
        ORDER BY b.due_date ASC LIMIT 5
      `) as { id: number; title: string | null; due_date: string | Date }[];
      const claimed = new Set(await claimUnsent(userId, rows.map((r) => Number(r.id)), "due"));
      for (const r of rows) {
        if (!claimed.has(Number(r.id))) continue;
        const dueIso = new Date(r.due_date).toISOString();
        if ((await pushToMember(userId, dueSoonPush({ id: Number(r.id), title: String(r.title ?? ""), dueIso }, now))) > 0) pushed++;
      }
    } catch (e) {
      console.error("[push-bid-alerts] due-soon member failed:", (e as Error).message);
    }
  }
  return { members: members.length, pushed };
}

if (import.meta.main) {
  const dueSoon = process.argv.includes("--due-soon");
  try {
    if (!inSendingHours()) {
      console.log("[push-bid-alerts] outside 7 AM–9 PM Eastern; nothing sent (matches wait for the next run)");
      process.exit(0);
    }
    const r = dueSoon ? await pushDueSoon() : await pushNewMatches();
    console.log(`[push-bid-alerts] ${dueSoon ? "due-soon" : "new matches"}: members=${r.members} pushed=${r.pushed}`);
    process.exit(0);
  } catch (e) {
    console.error("[push-bid-alerts] failed:", e);
    process.exit(1);
  }
}
