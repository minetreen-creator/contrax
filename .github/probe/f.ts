// Read-only probe 2: where visitors drop (7 days). Counts only; robots and admins excluded; no emails, IPs or ids printed.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const wk = s`created_at > NOW() - INTERVAL '7 days'`;
const row = (label: string, o: unknown) => console.log(label + " " + JSON.stringify(o));

// 1. By traffic source: visitors, one-page visits, searchers, bid-page openers, $5 clickers, Stripe.
const bySrc = await s`
  WITH pv AS (
    SELECT visitor_id, MIN(created_at) AS t0, COUNT(*) AS views,
           (ARRAY_AGG(COALESCE(NULLIF(source, ''), NULLIF(substring(referrer from '^https?://([^/]+)'), ''), '(direct)') ORDER BY created_at))[1] AS src,
           BOOL_OR(path LIKE '/bid/%') AS bid, BOOL_OR(path LIKE '/upgrade%' OR path LIKE '/pricing%') AS price
    FROM page_views WHERE ${wk} AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1),
  ev AS (
    SELECT visitor_id, BOOL_OR(event_name = 'radar_scan_start') AS scan, BOOL_OR(event_name = 'radar_scan_complete') AS done,
           BOOL_OR(event_name = 'radar_bids_first_click') AS bf_click, BOOL_OR(event_name = 'page_engaged') AS engaged,
           BOOL_OR(event_name IN ('bid_top_starter_click','radar_bids_first_starter','pricing_starter_click','home_starter_pass_click','bid_lock_starter_click','checklist_starter','basic_upgrade_bar_click','resume_checkout_click','radar_pass_offer_click','bid_lock_sheet_continue')) AS buy,
           BOOL_OR(event_name IN ('checkout_session_created','plan_checkout_redirected')) AS stripe
    FROM funnel_events WHERE ${wk} AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT pv.src, COUNT(*)::int AS visitors, COUNT(*) FILTER (WHERE pv.views = 1)::int AS one_page,
         COUNT(*) FILTER (WHERE ev.engaged)::int AS engaged, COUNT(*) FILTER (WHERE ev.scan)::int AS searched,
         COUNT(*) FILTER (WHERE ev.bf_click)::int AS tapped_listed_bid, COUNT(*) FILTER (WHERE pv.bid)::int AS opened_bid,
         COUNT(*) FILTER (WHERE pv.price)::int AS saw_price_page, COUNT(*) FILTER (WHERE ev.buy)::int AS clicked_buy, COUNT(*) FILTER (WHERE ev.stripe)::int AS stripe
  FROM pv LEFT JOIN ev USING (visitor_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;
for (const r of bySrc) row("SRC", r);

// 2. By landing page type.
const byLand = await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id,
               CASE WHEN path LIKE '/radar%' THEN '/radar' WHEN path LIKE '/bid/%' THEN '/bid/*' WHEN split_part(path,'?',1) = '/' THEN '/' WHEN path LIKE '/contracts-in/%' THEN '/contracts-in/*' ELSE 'other' END AS land
             FROM page_views WHERE ${wk} AND ${NOT_BOT} AND visitor_id IS NOT NULL ORDER BY visitor_id, created_at),
  c AS (SELECT visitor_id, COUNT(*) AS views FROM page_views WHERE ${wk} AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1),
  ev AS (SELECT visitor_id, BOOL_OR(event_name = 'radar_scan_start') AS scan, BOOL_OR(event_name = 'page_engaged') AS engaged,
           BOOL_OR(event_name IN ('bid_top_starter_click','radar_bids_first_starter','pricing_starter_click','home_starter_pass_click','bid_lock_starter_click','basic_upgrade_bar_click','radar_pass_offer_click','bid_lock_sheet_continue')) AS buy
         FROM funnel_events WHERE ${wk} AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT f.land, COUNT(*)::int AS visitors, COUNT(*) FILTER (WHERE c.views = 1)::int AS one_page, COUNT(*) FILTER (WHERE ev.engaged)::int AS engaged,
         COUNT(*) FILTER (WHERE ev.scan)::int AS searched, COUNT(*) FILTER (WHERE ev.buy)::int AS clicked_buy
  FROM f JOIN c USING (visitor_id) LEFT JOIN ev USING (visitor_id) GROUP BY 1 ORDER BY 2 DESC`;
for (const r of byLand) row("LAND", r);

// 3. Every event name, 7 days, by distinct visitor (names and counts only).
const names = (await s`SELECT event_name, COUNT(DISTINCT COALESCE(visitor_id, user_id, ip))::int AS n FROM funnel_events WHERE ${wk} AND ${NOT_BOT} GROUP BY 1 ORDER BY 2 DESC LIMIT 90`) as { event_name: string; n: number }[];
console.log("EVENTS7 " + names.map((x) => `${x.event_name} ${x.n}`).join(" | "));

// 4. Stripe sessions: by day, plan label, and whether the visitor was signed in. Then paid passes by start day.
const st = await s`
  SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'Mon DD') AS d, event_name, COALESCE(label, '') AS label,
         COUNT(*)::int AS events, COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(DISTINCT user_id)::int AS accounts
  FROM funnel_events WHERE ${wk} AND ${NOT_BOT} AND event_name IN ('checkout_session_created','plan_checkout_redirected','plan_checkout_started')
  GROUP BY 1, 2, 3 ORDER BY MIN(created_at)`;
for (const r of st) row("STRIPE", r);
const paid = await s`
  SELECT to_char((access_expires_at - INTERVAL '30 days') AT TIME ZONE 'America/New_York', 'Mon DD') AS pass_started, COUNT(*)::int AS n
  FROM users WHERE NOT COALESCE(is_admin, false) AND email NOT ILIKE '%@test.contrax' AND stripe_customer_id IS NOT NULL AND access_expires_at > NOW()
  GROUP BY 1 ORDER BY MIN(access_expires_at)`;
row("PASSES active, by start day", paid);
const [subs] = (await s`SELECT COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS active_subs, COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL)::int AS ever_stripe FROM users WHERE NOT COALESCE(is_admin, false) AND email NOT ILIKE '%@test.contrax'`) as Record<string, number>[];
row("SUBS", subs);

// 5. The odd landing links that 404 (path looks like scrambled text): where they come from. No ids.
const odd = await s`
  SELECT split_part(path, '?', 1) AS p, length(path) AS len,
         COALESCE(NULLIF(source, ''), NULLIF(substring(referrer from '^https?://([^/]+)'), ''), '(direct)') AS src, COALESCE(device_type, '?') AS device,
         to_char(MIN(created_at) AT TIME ZONE 'America/New_York', 'Mon DD') AS first_day, to_char(MAX(created_at) AT TIME ZONE 'America/New_York', 'Mon DD') AS last_day,
         COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(*)::int AS views
  FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND path ~ '^/[A-Za-z0-9+_=-]{10,}$' AND path !~ '^/(megaprojects|co-op-contracts|subs-wanted|industry-days|contractors|sub-finder|association|certifications|bid-fit-review|forgot-password|reset-password|mission-control|trade-package)'
  GROUP BY 1, 2, 3, 4 ORDER BY 7 DESC LIMIT 12`;
for (const r of odd) row("ODD", r);

// 6. Depth: how many pages a visitor sees.
const depth = await s`
  WITH c AS (SELECT visitor_id, COUNT(*) AS n FROM page_views WHERE ${wk} AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT CASE WHEN n >= 5 THEN '5+' ELSE n::text END AS pages, COUNT(*)::int AS visitors FROM c GROUP BY 1 ORDER BY 1`;
row("DEPTH", depth);
// 7. Returning visitors: seen on 2+ different days in the last 14.
const [ret] = (await s`
  WITH d AS (SELECT visitor_id, COUNT(DISTINCT (created_at AT TIME ZONE 'America/New_York')::date) AS days FROM page_views WHERE created_at > NOW() - INTERVAL '14 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT COUNT(*)::int AS visitors_14d, COUNT(*) FILTER (WHERE days >= 2)::int AS came_back_another_day FROM d`) as Record<string, number>[];
row("RETURN", ret);
// 8. Email capture and alerts in 7 days.
const [lead] = (await s`SELECT COUNT(DISTINCT COALESCE(visitor_id, ip)) FILTER (WHERE event_name IN ('radar_lead_captured','radar_email_unlocked'))::int AS gave_email, COUNT(DISTINCT COALESCE(visitor_id, ip)) FILTER (WHERE event_name IN ('radar_email_unlock_shown','radar_alert_offer_shown','radar_results_unlock_shown'))::int AS saw_email_ask FROM funnel_events WHERE ${wk} AND ${NOT_BOT}`) as Record<string, number>[];
row("EMAIL", lead);
process.exit(0);
