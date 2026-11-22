/**
 * Trim notifications — CLI entrypoint (`bun run trim-notifications`), run by hand from
 * .github/workflows/trim-notifications.yml (owner 2026-11-22: "delete them"). Deletes "new bid
 * match" notifications beyond the newest 200 per account and prints the counts. The same trim runs
 * after each batch of new notifications, so this is only needed for the backlog.
 */
import { sql } from "~/db";
import { MATCH_NOTIFICATIONS_KEPT, trimMatchNotifications } from "~/lib/notification-trim.server";

async function main() {
  const s = sql();
  const count = async () => ((await s`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE type <> 'new_bid_match')::int AS other FROM notifications`) as { n: number; other: number }[])[0];
  const before = await count();
  const deleted = await trimMatchNotifications();
  const after = await count();
  console.log(`TRIM kept newest ${MATCH_NOTIFICATIONS_KEPT} per account | before ${before.n} | deleted ${deleted} | after ${after.n} | other kinds before ${before.other}, after ${after.other}`);
  await s.query("VACUUM (ANALYZE) notifications").catch((e: unknown) => console.log(`TRIM vacuum skipped: ${(e instanceof Error ? e.message : "").slice(0, 80)}`));
  const size = (await s`SELECT pg_size_pretty(pg_total_relation_size('notifications')) AS size`) as { size: string }[];
  console.log(`TRIM table size now ${size[0].size}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("trim-notifications failed:", e instanceof Error ? e.message : e); process.exit(1); });
