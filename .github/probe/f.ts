// Read-only probe: Thursday check-in, counts only; robots and admin accounts excluded. Removed after.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const A = "2026-11-09T05:00:00Z", B = "2026-11-02T05:00:00Z";
for (const [label, from, to] of [["since Nov 9", A, "2100-01-01"], ["7 days before", B, A]] as const) {
  const [v] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM page_views WHERE created_at >= ${from} AND created_at < ${to} AND path LIKE '/bid/%' AND ${NOT_BOT}`) as { n: number }[];
  const ev = (await s`SELECT event_name, COUNT(DISTINCT COALESCE(visitor_id, user_id, ip))::int AS n FROM funnel_events
    WHERE created_at >= ${from} AND created_at < ${to} AND ${NOT_BOT}
      AND event_name = ANY(${["bid_top_starter_click","bid_lock_starter_click","bid_contact_upgrade_click","bid_lock_sheet_shown","bid_lock_sheet_continue","plan_checkout_redirected","open_to_all_shown","open_to_all_click","open_to_all_more"]})
    GROUP BY 1 ORDER BY 1`) as { event_name: string; n: number }[];
  const [p] = (await s`SELECT COUNT(*)::int AS n FROM users WHERE starter_pass_bought_at >= ${from} AND starter_pass_bought_at < ${to} AND NOT COALESCE(is_admin,false) AND email NOT ILIKE '%@test.contrax'`) as { n: number }[];
  console.log("CHK", label, "bid-page visitors", v.n, "passes", p.n, JSON.stringify(ev));
}
const ota = (await s`SELECT split_part(label, ':', 1) AS w, event_name, COUNT(DISTINCT COALESCE(visitor_id, user_id, ip))::int AS n FROM funnel_events
  WHERE created_at >= ${A} AND event_name LIKE 'open_to_all%' AND ${NOT_BOT} GROUP BY 1,2 ORDER BY 1,2`) as unknown[];
console.log("CHK open_to_all by where", JSON.stringify(ota));
const dg = (await s`SELECT to_char(sent_at AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI') AS t, bids, recipients FROM bid_digest_log WHERE sent_at >= '2026-11-10' ORDER BY sent_at`) as unknown[];
console.log("CHK digests", JSON.stringify(dg));
process.exit(0);
