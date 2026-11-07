/**
 * Contrax app notifications — storage and sending. See ~/lib/member-push.
 *
 * Members' phones live in their own table, never in Mission Control's
 * `push_subscriptions` (that one is the owner's visitor alerts; a member row
 * there would get them). The VAPID keys are the site's existing ones.
 * `member_push_log` is the dedupe gate: a bid is pushed to a member once per
 * kind ("match" or "due"), however many times the job runs.
 */
import webpush from "web-push";
import { sql } from "~/db";
import { vapidPublicKey } from "~/lib/live-push.server";
import { subscriptionExpired, type PushSubscriptionInput } from "~/lib/live-push";
import type { PushPayload } from "~/lib/member-push";

let ready: Promise<void> | null = null;
export function ensureMemberPushTables(): Promise<void> {
  ready ??= (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS member_push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_ok_at TIMESTAMPTZ,
      last_error TEXT
    )`;
    await sql()`CREATE INDEX IF NOT EXISTS member_push_subscriptions_user_idx ON member_push_subscriptions (user_id)`;
    await sql()`CREATE TABLE IF NOT EXISTS member_push_log (
      user_id INT NOT NULL,
      bid_id INT NOT NULL,
      kind TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, bid_id, kind)
    )`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export async function saveMemberSubscription(userId: number, s: PushSubscriptionInput): Promise<void> {
  await ensureMemberPushTables();
  await sql()`INSERT INTO member_push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${userId}, ${s.endpoint}, ${s.p256dh}, ${s.auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_error = NULL`;
}

export async function removeMemberSubscription(userId: number, endpoint: string): Promise<void> {
  await ensureMemberPushTables();
  await sql()`DELETE FROM member_push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${userId}`;
}

export async function memberDeviceOn(userId: number, endpoint: string | null): Promise<boolean> {
  if (!endpoint) return false;
  await ensureMemberPushTables();
  const rows = (await sql()`SELECT 1 FROM member_push_subscriptions WHERE user_id = ${userId} AND endpoint = ${endpoint} LIMIT 1`) as unknown[];
  return rows.length > 0;
}

/** Members with at least one phone signed up for notifications. */
export async function subscribedMemberIds(): Promise<number[]> {
  await ensureMemberPushTables();
  const rows = (await sql()`SELECT DISTINCT user_id FROM member_push_subscriptions`) as { user_id: number }[];
  return rows.map((r) => Number(r.user_id));
}

/** Of these bids, the ones not yet pushed to this member for `kind`; claims them. */
export async function claimUnsent(userId: number, bidIds: number[], kind: "match" | "due"): Promise<number[]> {
  if (!bidIds.length) return [];
  await ensureMemberPushTables();
  const rows = (await sql()`
    INSERT INTO member_push_log (user_id, bid_id, kind)
    SELECT ${userId}, x, ${kind} FROM unnest(${bidIds}::int[]) AS x
    ON CONFLICT DO NOTHING
    RETURNING bid_id`) as { bid_id: number }[];
  const claimed = new Set(rows.map((r) => Number(r.bid_id)));
  return bidIds.filter((id) => claimed.has(id));
}

/** Bids this member was already pushed for `kind`, of those given. */
export async function alreadySent(userId: number, bidIds: number[], kind: "match" | "due"): Promise<Set<number>> {
  if (!bidIds.length) return new Set();
  await ensureMemberPushTables();
  const rows = (await sql()`
    SELECT bid_id FROM member_push_log WHERE user_id = ${userId} AND kind = ${kind} AND bid_id = ANY(${bidIds}::int[])`) as { bid_id: number }[];
  return new Set(rows.map((r) => Number(r.bid_id)));
}

/** Send to every phone this member signed up; returns how many accepted it. */
export async function pushToMember(userId: number, payload: PushPayload): Promise<number> {
  await ensureMemberPushTables();
  await vapidPublicKey(); // loads the site's VAPID keys into web-push
  const subs = (await sql()`SELECT id, endpoint, p256dh, auth FROM member_push_subscriptions WHERE user_id = ${userId}`) as {
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600, urgency: "normal", timeout: 8000 },
      );
      ok++;
      await sql()`UPDATE member_push_subscriptions SET last_ok_at = NOW(), last_error = NULL WHERE id = ${s.id}`;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (subscriptionExpired(code)) {
        await sql()`DELETE FROM member_push_subscriptions WHERE id = ${s.id}`;
      } else {
        const msg = `${code ?? ""} ${(err as Error).message ?? err}`.trim().slice(0, 200);
        await sql()`UPDATE member_push_subscriptions SET last_error = ${msg} WHERE id = ${s.id}`;
      }
    }
  }
  return ok;
}
