// Read-only, aggregate-only: app installs and the $5 pass funnel. No emails, IPs, visitor ids or names printed.
import { sql } from "~/db";
const q = async (label: string, p: Promise<unknown>) => {
  try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 200)); }
};
const BOT = sql().unsafe(`(user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|headless|preview|facebookexternalhit|slurp|python|curl|wget)')`);

await q("daily visitors / signups / pass buys (14d)", sql()`
  WITH d AS (SELECT generate_series((NOW() AT TIME ZONE 'America/New_York')::date - 13, (NOW() AT TIME ZONE 'America/New_York')::date, '1 day')::date AS day)
  SELECT d.day,
    (SELECT COUNT(DISTINCT visitor_id) FROM page_views p WHERE (p.created_at AT TIME ZONE 'America/New_York')::date = d.day AND ${BOT})::int AS visitors,
    (SELECT COUNT(DISTINCT visitor_id) FROM page_views p WHERE (p.created_at AT TIME ZONE 'America/New_York')::date = d.day AND ${BOT} AND device_type = 'mobile')::int AS mobile_visitors,
    (SELECT COUNT(*) FROM users u WHERE (u.created_at AT TIME ZONE 'America/New_York')::date = d.day)::int AS signups,
    (SELECT COUNT(*) FROM users u WHERE (u.starter_pass_bought_at AT TIME ZONE 'America/New_York')::date = d.day)::int AS pass_buys
  FROM d ORDER BY d.day`);
await q("pass buys all time / last 30d", sql()`SELECT COUNT(*) FILTER (WHERE starter_pass_bought_at IS NOT NULL)::int AS all_time, COUNT(*) FILTER (WHERE starter_pass_bought_at > NOW() - INTERVAL '30 days')::int AS last30 FROM users`);
await q("top events 14d (distinct visitors)", sql()`
  SELECT event_name, COUNT(*)::int AS n, COUNT(DISTINCT visitor_id)::int AS visitors
  FROM funnel_events WHERE created_at > NOW() - INTERVAL '14 days' AND ${BOT}
  GROUP BY 1 ORDER BY 3 DESC LIMIT 70`);
await q("app events 30d by name and label", sql()`
  SELECT event_name, COALESCE(label,'') AS label, COUNT(DISTINCT visitor_id)::int AS visitors
  FROM funnel_events WHERE created_at > NOW() - INTERVAL '30 days' AND event_name = ANY(${["app_installed", "app_open", "home_app_click", "bid_app_click", "app_banner_tap", "app_alerts_upgrade_click", "app_banner_shown", "app_banner_dismiss"]}) AND ${BOT}
  GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
await q("/app page views 30d", sql()`SELECT COUNT(*)::int AS views, COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(DISTINCT visitor_id) FILTER (WHERE device_type='mobile')::int AS mobile FROM page_views WHERE path LIKE '/app%' AND created_at > NOW() - INTERVAL '30 days' AND ${BOT}`);
await q("pages before checkout 14d (paths of pricing/upgrade/checkout)", sql()`
  SELECT split_part(path, '?', 1) AS path, COUNT(DISTINCT visitor_id)::int AS visitors
  FROM page_views WHERE created_at > NOW() - INTERVAL '14 days' AND ${BOT}
    AND (path LIKE '/pricing%' OR path LIKE '/upgrade%' OR path LIKE '/signup%' OR path LIKE '/post-checkout%' OR path LIKE '/radar%' OR path LIKE '/bid/%' OR path = '/')
  GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
await q("traffic sources 14d (visitors)", sql()`
  SELECT COALESCE(NULLIF(source,''), CASE WHEN referrer IS NULL OR referrer = '' THEN '(direct)' ELSE regexp_replace(referrer, '^https?://([^/]+).*$', '\\1') END) AS src,
         COUNT(DISTINCT visitor_id)::int AS visitors
  FROM page_views WHERE created_at > NOW() - INTERVAL '14 days' AND ${BOT}
  GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
process.exit(0);
