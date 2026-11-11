// TEMP read-only probe: last 14 days by traffic source. Counts only; no IPs, visitor ids or emails.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const BUY = ["bid_top_starter_click", "radar_bids_first_starter", "pricing_starter_click", "home_starter_pass_click", "bid_lock_starter_click", "checklist_starter", "basic_upgrade_bar_click", "resume_checkout_click", "radar_anon_pass_offer_click"];
const STRIPE = ["checkout_session_created", "plan_checkout_redirected"];
const rows = (await s`
  WITH pv AS (
    SELECT visitor_id, created_at, path, lower(coalesce(source,'')) AS src, lower(coalesce(medium,'')) AS med, lower(coalesce(referrer,'')) AS ref
    FROM page_views WHERE created_at > NOW() - INTERVAL '14 days' AND visitor_id IS NOT NULL AND ${NOT_BOT}
  ), first AS (
    SELECT DISTINCT ON (visitor_id) visitor_id, src, med, ref, path FROM pv ORDER BY visitor_id, created_at
  ), b AS (
    SELECT visitor_id, path,
      CASE
        WHEN med IN ('cpc','ppc','paid') OR src LIKE '%ads%' THEN '1 Google Ads (paid)'
        WHEN src ~ '(chatgpt|openai|perplexity|claude|copilot|gemini)' OR ref ~ '(chatgpt|openai|perplexity|claude\\.ai|copilot|gemini)' THEN '2 AI assistants'
        WHEN src ~ '(facebook|fb|instagram|meta)' OR ref ~ '(facebook|fb\\.|instagram)' THEN '3 Facebook'
        WHEN src LIKE '%google%' OR ref LIKE '%google.%' THEN '4 Google search'
        WHEN src ~ '(bing|duckduckgo|yahoo|brave)' OR ref ~ '(bing\\.|duckduckgo|yahoo\\.|brave\\.)' THEN '5 Other search'
        WHEN med = 'email' OR src ~ '(email|newsletter|resend)' THEN '6 Email'
        WHEN src IN ('', 'direct') AND (ref = '' OR ref LIKE '%contrax.company%') THEN '7 Direct'
        ELSE '8 Other'
      END AS bucket
    FROM first
  ), per AS (
    SELECT visitor_id, COUNT(*) AS views, bool_or(path LIKE '/bid/%') AS saw_bid FROM pv GROUP BY 1
  ), ev AS (
    SELECT visitor_id,
      bool_or(event_name IN ('radar_scan_complete','radar_scan_start')) AS searched,
      bool_or(event_name = ANY(${BUY})) AS buy,
      bool_or(event_name = ANY(${STRIPE})) AS stripe,
      bool_or(event_name ~ '(lead_captured|alert_capture|email_unlock)') AS email,
      bool_or(event_name ~ '(signup_success|signup_completed)') AS signup,
      bool_or(event_name ~ '(purchase|checkout_complete|checkout_success|payment_succeeded|plan_activated)') AS paid
    FROM funnel_events WHERE created_at > NOW() - INTERVAL '14 days' AND visitor_id IS NOT NULL AND ${NOT_BOT} GROUP BY 1
  )
  SELECT b.bucket, COUNT(*)::int AS visitors,
    COUNT(*) FILTER (WHERE per.views > 1)::int AS more_than_one_page,
    COUNT(*) FILTER (WHERE per.saw_bid)::int AS saw_a_bid,
    COUNT(*) FILTER (WHERE ev.searched)::int AS searched,
    COUNT(*) FILTER (WHERE ev.email)::int AS gave_email,
    COUNT(*) FILTER (WHERE ev.signup)::int AS signed_up,
    COUNT(*) FILTER (WHERE ev.buy)::int AS tapped_buy,
    COUNT(*) FILTER (WHERE ev.stripe)::int AS reached_stripe,
    COUNT(*) FILTER (WHERE ev.paid)::int AS paid_event
  FROM b JOIN per USING (visitor_id) LEFT JOIN ev USING (visitor_id) GROUP BY 1 ORDER BY 1`) as Record<string, unknown>[];
for (const r of rows) console.log("SRC14", JSON.stringify(r));
const land = (await s`
  WITH pv AS (SELECT visitor_id, created_at, path FROM page_views WHERE created_at > NOW() - INTERVAL '14 days' AND visitor_id IS NOT NULL AND ${NOT_BOT}),
  first AS (SELECT DISTINCT ON (visitor_id) visitor_id, path FROM pv ORDER BY visitor_id, created_at),
  per AS (SELECT visitor_id, COUNT(*) AS views FROM pv GROUP BY 1)
  SELECT CASE WHEN path LIKE '/bid/%' THEN '/bid/*' WHEN path = '/' THEN '/' ELSE '/' || split_part(split_part(path, '?', 1), '/', 2) END AS landing,
    COUNT(*)::int AS visitors, COUNT(*) FILTER (WHERE per.views = 1)::int AS left_after_one
  FROM first JOIN per USING (visitor_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 14`) as Record<string, unknown>[];
for (const r of land) console.log("LAND14", JSON.stringify(r));
const other = (await s`
  WITH first AS (SELECT DISTINCT ON (visitor_id) visitor_id, lower(coalesce(source,'')) AS src, lower(coalesce(medium,'')) AS med,
      regexp_replace(lower(coalesce(referrer,'')), '^https?://([^/]+).*$', '\\1') AS refhost
    FROM page_views WHERE created_at > NOW() - INTERVAL '14 days' AND visitor_id IS NOT NULL AND ${NOT_BOT} ORDER BY visitor_id, created_at)
  SELECT src, med, refhost, COUNT(*)::int AS n FROM first GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 25`) as Record<string, unknown>[];
for (const r of other) console.log("TAG14", JSON.stringify(r));
const evs = (await s`SELECT event_name, COUNT(*)::int AS n FROM funnel_events WHERE created_at > NOW() - INTERVAL '14 days' AND event_name ~ '(purchase|paid|checkout|payment|activated)' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`) as Record<string, unknown>[];
console.log("EV14", JSON.stringify(evs));
const [p] = (await s`SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '14 days')::int AS new_accounts_14d,
  COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL AND (subscription_status = 'active' OR access_expires_at > NOW()))::int AS paid_access_now
  FROM users WHERE NOT COALESCE(is_admin, false) AND email NOT ILIKE '%@test.contrax'`) as Record<string, number>[];
console.log("ACCT", JSON.stringify(p));
process.exit(0);
