// Read-only probe 3: the people who opened Stripe's $5 page (14 days). Counts only; no emails, IPs or ids printed.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const row = (label: string, o: unknown) => console.log(label + " " + JSON.stringify(o));
const co = s`funnel_events WHERE created_at > NOW() - INTERVAL '14 days' AND event_name = 'checkout_session_created' AND ${NOT_BOT}`;
const [tot] = await s`SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(DISTINCT ip)::int AS networks, COUNT(*) FILTER (WHERE visitor_id IS NULL)::int AS no_cookie, COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS signed_in FROM ${co}`;
row("CO14 totals", tot);
row("CO14 by day", await s`SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'Mon DD') AS d, COUNT(*)::int AS sessions, COUNT(DISTINCT ip)::int AS networks FROM ${co} GROUP BY 1 ORDER BY MIN(created_at)`);
row("CO14 by device", await s`SELECT CASE WHEN user_agent ~* 'iphone|android|mobile' THEN 'phone' ELSE 'computer' END AS device, CASE WHEN user_agent ~* 'FBAN|FBAV|Instagram' THEN 'inside Facebook app' WHEN user_agent ~* 'iphone' THEN 'iPhone browser' WHEN user_agent ~* 'android' THEN 'Android browser' ELSE 'desktop browser' END AS browser, COUNT(*)::int AS sessions FROM ${co} GROUP BY 1, 2 ORDER BY 3 DESC`);
// What those visitors did before and after.
const v = await s`
  WITH c AS (SELECT visitor_id, MIN(created_at) AS t FROM ${co} AND visitor_id IS NOT NULL GROUP BY 1),
  pv AS (SELECT c.visitor_id, COUNT(*) FILTER (WHERE p.created_at < c.t) AS before, COUNT(*) FILTER (WHERE p.created_at > c.t) AS after,
           EXTRACT(EPOCH FROM (c.t - MIN(p.created_at))) / 60 AS mins_on_site,
           BOOL_OR(p.created_at > c.t AND p.path LIKE '/upgrade%checkout=cancelled%') AS came_back_cancelled,
           BOOL_OR(p.created_at > c.t AND p.path LIKE '/post-checkout%') AS post_checkout,
           (ARRAY_AGG(COALESCE(NULLIF(p.source, ''), NULLIF(substring(p.referrer from '^https?://([^/]+)'), ''), '(direct)') ORDER BY p.created_at))[1] AS src
         FROM c LEFT JOIN page_views p ON p.visitor_id = c.visitor_id AND p.created_at > NOW() - INTERVAL '30 days' GROUP BY c.visitor_id, c.t)
  SELECT COUNT(*)::int AS visitors, COUNT(*) FILTER (WHERE before = 0)::int AS no_page_before, ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mins_on_site)::numeric, 1) AS median_minutes_before_checkout,
         COUNT(*) FILTER (WHERE mins_on_site < 1)::int AS under_1_min, COUNT(*) FILTER (WHERE came_back_cancelled)::int AS pressed_back_from_stripe, COUNT(*) FILTER (WHERE after > 0)::int AS seen_again_after,
         COUNT(*) FILTER (WHERE post_checkout)::int AS reached_thank_you_page
  FROM pv`;
row("CO14 behaviour", v[0]);
row("CO14 by source", await s`
  WITH c AS (SELECT DISTINCT visitor_id FROM ${co} AND visitor_id IS NOT NULL),
  f AS (SELECT DISTINCT ON (p.visitor_id) p.visitor_id, COALESCE(NULLIF(p.source, ''), NULLIF(substring(p.referrer from '^https?://([^/]+)'), ''), '(direct)') AS src,
          CASE WHEN p.path LIKE '/radar%' THEN '/radar' WHEN p.path LIKE '/bid/%' THEN '/bid/*' WHEN p.path LIKE '/upgrade%' THEN '/upgrade' WHEN p.path LIKE '/pricing%' THEN '/pricing' ELSE 'other' END AS land
        FROM page_views p JOIN c USING (visitor_id) WHERE p.created_at > NOW() - INTERVAL '30 days' ORDER BY p.visitor_id, p.created_at)
  SELECT src, land, COUNT(*)::int AS visitors FROM f GROUP BY 1, 2 ORDER BY 3 DESC`);
// Last button pressed before the Stripe page opened.
row("CO14 last click before", await s`
  WITH c AS (SELECT visitor_id, MIN(created_at) AS t FROM ${co} AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT COALESCE((SELECT e.event_name FROM funnel_events e WHERE e.visitor_id = c.visitor_id AND e.created_at < c.t AND e.created_at > c.t - INTERVAL '10 minutes'
            AND e.event_name ~ '(click|starter|checkout|continue|cta)' AND e.event_name <> 'checkout_session_created' ORDER BY e.created_at DESC LIMIT 1), '(none recorded)') AS last_click, COUNT(*)::int AS n
  FROM c GROUP BY 1 ORDER BY 2 DESC`);
// Sales recorded.
row("PASSES bought by day (30d)", await s`SELECT to_char(pass_bought_at AT TIME ZONE 'America/New_York', 'Mon DD') AS d, COUNT(*)::int AS n FROM users WHERE pass_bought_at > NOW() - INTERVAL '30 days' AND NOT COALESCE(is_admin, false) AND email NOT ILIKE '%@test.contrax' GROUP BY 1 ORDER BY MIN(pass_bought_at)`);
row("FOLLOWUPS", await s`SELECT COUNT(*)::int AS abandoned_checkout_emails_sent_14d FROM checkout_followups WHERE sent_at > NOW() - INTERVAL '14 days'`);
// Nov 9-10: what radar visitors did instead of searching.
row("RADAR by day", await s`
  WITH pv AS (SELECT (created_at AT TIME ZONE 'America/New_York')::date AS d, visitor_id FROM page_views WHERE created_at > NOW() - INTERVAL '8 days' AND ${NOT_BOT} AND path LIKE '/radar%' AND visitor_id IS NOT NULL GROUP BY 1, 2),
  ev AS (SELECT (created_at AT TIME ZONE 'America/New_York')::date AS d, visitor_id, BOOL_OR(event_name = 'radar_bids_first_shown') AS shown, BOOL_OR(event_name IN ('radar_bids_first_tab','radar_bids_first_state','radar_bids_first_click','radar_bids_first_see_all','radar_quick_trade')) AS used_panel,
           BOOL_OR(event_name = 'radar_scan_start') AS scan, BOOL_OR(event_name = 'radar_auto_scan') AS auto_scan, BOOL_OR(event_name = 'page_engaged') AS engaged
         FROM funnel_events WHERE created_at > NOW() - INTERVAL '8 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1, 2)
  SELECT to_char(pv.d, 'Mon DD') AS d, COUNT(*)::int AS radar_visitors, COUNT(*) FILTER (WHERE ev.engaged)::int AS engaged, COUNT(*) FILTER (WHERE ev.shown)::int AS saw_bid_list, COUNT(*) FILTER (WHERE ev.used_panel)::int AS tapped_in_list,
         COUNT(*) FILTER (WHERE ev.scan)::int AS searched, COUNT(*) FILTER (WHERE ev.auto_scan)::int AS auto_search_from_link
  FROM pv LEFT JOIN ev USING (d, visitor_id) GROUP BY pv.d ORDER BY pv.d`);
process.exit(0);
