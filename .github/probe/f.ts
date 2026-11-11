// Read-only probe: the sales funnel, 7 days, by day, and since the no-account $5 checkout went live.
// Counts only. Robots and admin accounts excluded. No emails, IPs or visitor ids are printed.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const who = s`COUNT(DISTINCT COALESCE(visitor_id, user_id, ip))::int`;
const GUEST_LIVE = "2026-11-10T19:45:00Z";
const windows: [string, ReturnType<typeof s>][] = [
  ["7d", s`created_at > NOW() - INTERVAL '7 days'`],
  ["24h", s`created_at > NOW() - INTERVAL '24 hours'`],
  ["since-guest", s`created_at > ${GUEST_LIVE}`],
];
const steps: [string, string[]][] = [
  ["radar search started", ["radar_scan_start"]],
  ["radar search finished", ["radar_scan_complete"]],
  ["saw signup page", ["signup_view", "signup_view_with_score", "signup_viewed_from_radar", "signup_landed_radar"]],
  ["signup succeeded", ["signup_success", "signup_completed_from_radar"]],
  ["clicked a $5 / buy button", ["bid_top_starter_click", "radar_bids_first_starter", "pricing_starter_click", "home_starter_pass_click", "bid_lock_starter_click", "checklist_starter", "basic_upgrade_bar_click", "resume_checkout_click"]],
  ["checkout started", ["plan_checkout_started"]],
  ["reached Stripe", ["checkout_session_created", "plan_checkout_redirected"]],
  ["checkout failed", ["plan_checkout_failed"]],
  ["signin required at checkout", ["plan_checkout_signin_required"]],
];
for (const [name, w] of windows) {
  const [v] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(*)::int AS views FROM page_views WHERE ${w} AND ${NOT_BOT}`) as Record<string, number>[];
  console.log(`F ${name} | real visitors ${v.visitors} | page views ${v.views}`);
  const [up] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM page_views WHERE ${w} AND ${NOT_BOT} AND path LIKE '/upgrade%'`) as { n: number }[];
  const [pr] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM page_views WHERE ${w} AND ${NOT_BOT} AND path LIKE '/pricing%'`) as { n: number }[];
  const [bd] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM page_views WHERE ${w} AND ${NOT_BOT} AND (path LIKE '/bid/%' OR path LIKE '/bids/%')`) as { n: number }[];
  console.log(`F ${name} | opened a bid page ${bd.n} | saw /pricing ${pr.n} | saw /upgrade ($5 page) ${up.n}`);
  for (const [label, names] of steps) {
    const [r] = (await s`SELECT ${who} AS n FROM funnel_events WHERE ${w} AND event_name = ANY(${names}) AND ${NOT_BOT}`) as { n: number }[];
    console.log(`F ${name} | ${label}: ${r.n}`);
  }
}
// By day (US Eastern), 8 days.
const days = (await s`
  SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'America/New_York'), 'Mon DD') AS d,
         MIN(created_at) AS t, COUNT(DISTINCT visitor_id)::int AS visitors
  FROM page_views WHERE created_at > NOW() - INTERVAL '8 days' AND ${NOT_BOT} GROUP BY 1 ORDER BY 2`) as { d: string; visitors: number }[];
const evDays = (await s`
  SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'America/New_York'), 'Mon DD') AS d, event_name, ${who} AS n
  FROM funnel_events WHERE created_at > NOW() - INTERVAL '8 days' AND ${NOT_BOT}
    AND event_name IN ('radar_scan_start','radar_scan_complete','signup_success','plan_checkout_started','checkout_session_created','plan_checkout_redirected','plan_checkout_failed')
  GROUP BY 1, 2`) as { d: string; event_name: string; n: number }[];
for (const d of days) {
  const g = (e: string) => evDays.find((x) => x.d === d.d && x.event_name === e)?.n ?? 0;
  console.log(`DAY ${d.d} | visitors ${d.visitors} | search start ${g("radar_scan_start")} done ${g("radar_scan_complete")} | signups ${g("signup_success")} | checkout started ${g("plan_checkout_started")} | stripe ${Math.max(g("checkout_session_created"), g("plan_checkout_redirected"))} | failed ${g("plan_checkout_failed")}`);
}
// Where visitors come from (7 days): traffic source label, or referrer host. No full URLs.
const src = (await s`
  SELECT COALESCE(NULLIF(source, ''), NULLIF(substring(referrer from '^https?://([^/]+)'), ''), '(direct)') AS src, COUNT(DISTINCT visitor_id)::int AS n
  FROM page_views WHERE created_at > NOW() - INTERVAL '7 days' AND ${NOT_BOT} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`) as { src: string; n: number }[];
console.log("SRC7 " + src.map((x) => `${x.src} ${x.n}`).join(" | "));
// First page a visitor lands on (7 days), ids collapsed.
const land = (await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, regexp_replace(regexp_replace(split_part(path, '?', 1), '^/(bid|bids|trade-package|megaprojects|share|p)/[^/]+', '/\\1/*'), '[0-9a-f]{8}-[0-9a-f-]{20,}', '*') AS p
             FROM page_views WHERE created_at > NOW() - INTERVAL '7 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL ORDER BY visitor_id, created_at)
  SELECT p, COUNT(*)::int AS n FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 14`) as { p: string; n: number }[];
console.log("LAND7 " + land.map((x) => `${x.p} ${x.n}`).join(" | "));
// One-page visits (7 days).
const [b] = (await s`
  WITH c AS (SELECT visitor_id, COUNT(*) AS n FROM page_views WHERE created_at > NOW() - INTERVAL '7 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT COUNT(*)::int AS all_v, COUNT(*) FILTER (WHERE n = 1)::int AS one_page FROM c`) as Record<string, number>[];
console.log(`BOUNCE7 visitors ${b.all_v} | saw only one page ${b.one_page}`);
// Devices (7 days).
const dev = (await s`SELECT COALESCE(device_type, '?') AS d, COUNT(DISTINCT visitor_id)::int AS n FROM page_views WHERE created_at > NOW() - INTERVAL '7 days' AND ${NOT_BOT} GROUP BY 1 ORDER BY 2 DESC LIMIT 5`) as { d: string; n: number }[];
console.log("DEV7 " + dev.map((x) => `${x.d} ${x.n}`).join(" | "));
// Subs Wanted and Sub Finder activity (all time since launch on Nov 10).
const subs = (await s`
  SELECT event_name, ${who} AS n FROM funnel_events
  WHERE created_at > '2026-11-10' AND ${NOT_BOT} AND (event_name LIKE 'subs_wanted%' OR event_name LIKE 'sub_finder%' OR event_name LIKE 'trade_package%')
  GROUP BY 1 ORDER BY 2 DESC`) as { event_name: string; n: number }[];
console.log("SUBS " + (subs.map((x) => `${x.event_name} ${x.n}`).join(" | ") || "none"));
const [sw] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM page_views WHERE created_at > '2026-11-10' AND ${NOT_BOT} AND path LIKE '/subs-wanted%'`) as { n: number }[];
const [sf] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM page_views WHERE created_at > '2026-11-10' AND ${NOT_BOT} AND path LIKE '/sub-finder%'`) as { n: number }[];
const [bj] = (await s`SELECT COUNT(*)::int AS n FROM trade_packages WHERE on_board`) as { n: number }[];
console.log(`SUBS visitors to /subs-wanted ${sw.n} | to /sub-finder ${sf.n} | jobs on the board ${bj.n}`);
// Accounts and paid access.
const [u] = (await s`
  SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new7,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS new24,
         COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL AND (subscription_status = 'active' OR access_expires_at > NOW()))::int AS paid_now
  FROM users WHERE NOT COALESCE(is_admin, false) AND email NOT ILIKE '%@test.contrax'`) as Record<string, number>[];
console.log(`ACCT new accounts 7d ${u.new7} | 24h ${u.new24} | accounts with paid access now ${u.paid_now}`);
const fails = (await s`SELECT event_name, COALESCE(label, '') AS label, COUNT(*)::int AS n FROM funnel_events WHERE created_at > NOW() - INTERVAL '7 days' AND ${NOT_BOT} AND event_name IN ('plan_checkout_failed','signup_error','radar_scan_error','radar_scan_timeout') GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`) as { event_name: string; label: string; n: number }[];
console.log("FAIL7 " + (fails.map((f) => `${f.event_name}[${f.label.slice(0, 60)}] ${f.n}`).join(" | ") || "none"));
// Top events since the no-account checkout went live (names and counts only).
const top = (await s`SELECT event_name, ${who} AS n FROM funnel_events WHERE created_at > ${GUEST_LIVE} AND ${NOT_BOT} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`) as { event_name: string; n: number }[];
console.log("TOP since-guest " + top.map((x) => `${x.event_name} ${x.n}`).join(" | "));
process.exit(0);
