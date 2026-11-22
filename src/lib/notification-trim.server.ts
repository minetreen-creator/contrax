import { sql } from "~/db";

/**
 * Match notifications kept per account (owner 2026-11-22, "delete them"): 418,616 "new bid match"
 * notifications had piled up, none ever read, 414,155 of them beyond the newest 200 on their
 * account. The bell shows the newest 50, so nothing past 200 can be seen.
 */
export const MATCH_NOTIFICATIONS_KEPT = 200;

/**
 * Delete "new bid match" notifications beyond the newest MATCH_NOTIFICATIONS_KEPT per account, for
 * the given accounts or for every account. Other notification types are never touched. Returns the
 * number deleted.
 */
export async function trimMatchNotifications(userIds?: readonly number[]): Promise<number> {
  const s = sql();
  if (userIds && !userIds.length) return 0;
  const ids = userIds
    ? [...new Set(userIds)]
    : ((await s`SELECT user_id FROM notifications WHERE type = 'new_bid_match' GROUP BY user_id HAVING COUNT(*) > ${MATCH_NOTIFICATIONS_KEPT}`) as { user_id: number }[]).map((r) => Number(r.user_id));
  let deleted = 0;
  for (const uid of ids) {
    const out = (await s`
      DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications
        WHERE user_id = ${uid} AND type = 'new_bid_match'
        ORDER BY created_at DESC, id DESC
        OFFSET ${MATCH_NOTIFICATIONS_KEPT}
      ) RETURNING id`) as unknown[];
    deleted += out.length;
  }
  return deleted;
}
