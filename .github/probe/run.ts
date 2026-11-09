// Read-only, aggregate-only: buy clicks since the Nov 7 one-tap checkout, by page and outcome. No emails, IPs, visitor ids or names.
import { sql } from "~/db";
const q = async (label: string, p: Promise<unknown>) => {
  try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 200)); }
};
const SINCE = "2026-11-07T17:00:00Z";
const BOT = sql().unsafe(`(user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|headless|preview|facebookexternalhit|slurp|python|curl|wget)')`);
const NAMES = [
  "plan_checkout_started", "plan_checkout_redirected", "plan_checkout_signin_required", "plan_checkout_failed",
  "checkout_session_created", "unlock_sheet_shown", "unlock_sheet_confirm", "unlock_sheet_close", "bid_top_starter_click",
  "bid_lock_starter_click", "radar_anon_pass_offer_click", "home_starter_pass_click", "pricing_starter_click", "upgrade_page_viewed",
];
await q("checkout events since Nov 7 by name", sql()`
  SELECT event_name, COUNT(*)::int AS n, COUNT(DISTINCT visitor_id)::int AS visitors
  FROM funnel_events WHERE created_at > ${SINCE} AND ${BOT} AND (event_name = ANY(${NAMES}) OR event_name LIKE '%checkout%' OR event_name LIKE '%unlock_sheet%' OR event_name LIKE '%starter%')
  GROUP BY 1 ORDER BY 3 DESC`);
await q("plan_checkout_* since Nov 7 by page and label", sql()`
  SELECT event_name, split_part(COALESCE(path,''), '?', 1) AS page, COALESCE(label,'') AS label, COUNT(DISTINCT visitor_id)::int AS visitors
  FROM funnel_events WHERE created_at > ${SINCE} AND ${BOT} AND event_name LIKE 'plan_checkout_%'
  GROUP BY 1, 2, 3 ORDER BY 2, 1`);
await q("started visitors who were never redirected, by page and device", sql()`
  WITH s AS (SELECT DISTINCT visitor_id, split_part(COALESCE(path,''), '?', 1) AS page, COALESCE(device_type,'?') AS device, COALESCE(browser_label,'?') AS browser
             FROM funnel_events WHERE created_at > ${SINCE} AND ${BOT} AND event_name = 'plan_checkout_started'),
       r AS (SELECT DISTINCT visitor_id FROM funnel_events WHERE created_at > ${SINCE} AND event_name IN ('plan_checkout_redirected', 'checkout_session_created')),
       o AS (SELECT visitor_id, array_agg(DISTINCT event_name) AS after FROM funnel_events
             WHERE created_at > ${SINCE} AND event_name IN ('plan_checkout_signin_required','plan_checkout_failed') GROUP BY 1)
  SELECT s.page, s.device, s.browser, COALESCE(array_to_string(o.after, ','), 'no follow-up event') AS outcome, COUNT(*)::int AS visitors
  FROM s LEFT JOIN r USING (visitor_id) LEFT JOIN o USING (visitor_id)
  WHERE r.visitor_id IS NULL GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC`);
await q("failed labels since Nov 7", sql()`
  SELECT COALESCE(label,'') AS label, COUNT(*)::int AS n FROM funnel_events
  WHERE created_at > ${SINCE} AND event_name = 'plan_checkout_failed' GROUP BY 1 ORDER BY 2 DESC`);
await q("pass buys since Nov 7", sql()`SELECT COUNT(*)::int AS n FROM users WHERE starter_pass_bought_at > ${SINCE}`);
process.exit(0);
