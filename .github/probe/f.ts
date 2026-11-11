// Read-only probe 4: are the Stripe-page openers real people? Counts only; no emails, IPs or ids printed.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const BOT = s.unsafe(`(${BOT_EXCLUSION_SQL})`);
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const row = (label: string, o: unknown) => console.log(label + " " + JSON.stringify(o));
row("CO openers vs robot filter", await s`
  WITH c AS (SELECT visitor_id, MIN(created_at) AS t FROM funnel_events WHERE created_at > NOW() - INTERVAL '14 days' AND event_name = 'checkout_session_created' AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1),
  pv AS (SELECT c.visitor_id, COUNT(p.id) AS views, COUNT(p.id) FILTER (WHERE ${BOT}) AS robot_views,
           (ARRAY_AGG(COALESCE(NULLIF(p.medium, ''), '(none)') ORDER BY p.created_at))[1] AS medium,
           (ARRAY_AGG(COALESCE(NULLIF(p.source, ''), NULLIF(substring(p.referrer from '^https?://([^/]+)'), ''), '(direct)') ORDER BY p.created_at))[1] AS src,
           BOOL_OR(p.click_id IS NOT NULL AND p.click_id <> '') AS ad_click
         FROM c LEFT JOIN page_views p ON p.visitor_id = c.visitor_id AND p.created_at > NOW() - INTERVAL '30 days' GROUP BY 1),
  ev AS (SELECT c.visitor_id, COUNT(*) FILTER (WHERE e.event_name = 'page_engaged') AS engaged, COUNT(*) FILTER (WHERE e.event_name LIKE 'radar_scan%') AS scans, COUNT(DISTINCT e.event_name) AS kinds
         FROM c LEFT JOIN funnel_events e ON e.visitor_id = c.visitor_id AND e.created_at > NOW() - INTERVAL '30 days' GROUP BY 1)
  SELECT pv.src, pv.medium, pv.ad_click, (pv.robot_views > 0) AS page_views_flagged_robot, COUNT(*)::int AS visitors,
         ROUND(AVG(pv.views), 1) AS avg_pages, COUNT(*) FILTER (WHERE ev.engaged > 0)::int AS engaged, COUNT(*) FILTER (WHERE ev.scans > 0)::int AS searched, ROUND(AVG(ev.kinds), 1) AS avg_event_kinds
  FROM pv JOIN ev USING (visitor_id) GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC`);
row("ALL visitors 7d by medium", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, COALESCE(NULLIF(source, ''), NULLIF(substring(referrer from '^https?://([^/]+)'), ''), '(direct)') AS src, COALESCE(NULLIF(medium, ''), '(none)') AS medium, (${BOT}) AS robot
             FROM page_views WHERE created_at > NOW() - INTERVAL '7 days' AND visitor_id IS NOT NULL ORDER BY visitor_id, created_at)
  SELECT src, medium, robot, COUNT(*)::int AS visitors FROM f GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 14`);
row("PAID buyers path", await s`
  SELECT COUNT(*)::int AS buyers, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM page_views p WHERE p.user_id = u.id::text AND ${BOT}))::int AS with_robot_flagged_views
  FROM users u WHERE starter_pass_bought_at > NOW() - INTERVAL '30 days' AND NOT COALESCE(is_admin, false)`);
process.exit(0);
