// Read-only probe: who the email and ChatGPT visitors are and what they open (30 days). Counts only;
// robots and admins excluded; no emails, IPs or visitor ids printed. Bid titles are public listings.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const row = (label: string, o: unknown) => console.log(label + " " + JSON.stringify(o));
const SRC = s.unsafe(`COALESCE(NULLIF(source, ''), NULLIF(substring(referrer from '^https?://([^/]+)'), ''), '(direct)')`);
const PAT = s.unsafe(`regexp_replace(regexp_replace(split_part(path, '?', 1), '^/(bid|bids|trade-package|megaprojects|share|sub-list|markets|contracts-in|bids-in|subcontracts-in|town|awards|learn)/.+$', '/\\1/*'), '^/[A-Za-z0-9+_=-]{10,}$', '/(scrambled)')`);

// A. Email visitors by medium and campaign.
row("EMAIL by campaign", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, COALESCE(NULLIF(medium, ''), '(none)') AS medium, COALESCE(NULLIF(campaign, ''), '(none)') AS campaign, ${PAT} AS land, COALESCE(device_type, '?') AS device
             FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL AND source = 'email' ORDER BY visitor_id, created_at),
  pv AS (SELECT visitor_id, COUNT(*) AS views, BOOL_OR(path LIKE '/pricing%' OR path LIKE '/upgrade%') AS price, BOOL_OR(path LIKE '/bid/%') AS bid, BOOL_OR(path LIKE '/radar%') AS radar,
           BOOL_OR(path LIKE '/sub-finder%' OR path LIKE '/sub-list%' OR path LIKE '/subs-wanted%') AS subs
         FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL GROUP BY 1),
  ev AS (SELECT visitor_id, BOOL_OR(event_name = 'page_engaged') AS engaged, BOOL_OR(event_name ~ '(starter_click|pass_offer_click|checkout_started|lock_sheet_continue)') AS buy,
           BOOL_OR(event_name = 'checkout_session_created') AS stripe, BOOL_OR(event_name = 'radar_lead_captured') AS gave_email, BOOL_OR(event_name LIKE 'signup_success%') AS signed_up
         FROM funnel_events WHERE created_at > NOW() - INTERVAL '30 days' AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT f.medium, f.campaign, COUNT(*)::int AS visitors, COUNT(*) FILTER (WHERE f.device = 'Mobile')::int AS mobile, COUNT(*) FILTER (WHERE pv.views = 1)::int AS one_page,
         COUNT(*) FILTER (WHERE ev.engaged)::int AS engaged, COUNT(*) FILTER (WHERE pv.bid)::int AS opened_bid, COUNT(*) FILTER (WHERE pv.radar)::int AS radar,
         COUNT(*) FILTER (WHERE pv.price)::int AS price_page, COUNT(*) FILTER (WHERE pv.subs)::int AS sub_pages, COUNT(*) FILTER (WHERE ev.buy)::int AS buy_click,
         COUNT(*) FILTER (WHERE ev.stripe)::int AS stripe, COUNT(*) FILTER (WHERE ev.gave_email)::int AS gave_email, COUNT(*) FILTER (WHERE ev.signed_up)::int AS signed_up
  FROM f JOIN pv USING (visitor_id) LEFT JOIN ev USING (visitor_id) GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 14`);
row("EMAIL landing", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, COALESCE(NULLIF(medium, ''), '(none)') AS medium, ${PAT} AS land
             FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL AND source = 'email' ORDER BY visitor_id, created_at)
  SELECT medium, land, COUNT(*)::int AS n FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 14`);
// Outreach emails sent (counts only).
try {
  row("OUTREACH sent 30d", await s`SELECT kind, status, COUNT(*)::int AS n FROM outreach_emails WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`);
} catch (e) { console.log("OUTREACH table:", (e as Error).message.slice(0, 120)); }

// B. Pricing page: who sees it and what they press.
row("PRICE page by source", await s`
  WITH v AS (SELECT DISTINCT visitor_id FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL AND (path LIKE '/pricing%' OR path LIKE '/upgrade%')),
  f AS (SELECT DISTINCT ON (p.visitor_id) p.visitor_id, ${SRC} AS src FROM page_views p JOIN v USING (visitor_id) WHERE p.created_at > NOW() - INTERVAL '45 days' ORDER BY p.visitor_id, p.created_at),
  ev AS (SELECT visitor_id, BOOL_OR(event_name ~ '(starter_click|pass_offer_click|checkout_started)') AS buy, BOOL_OR(event_name = 'checkout_session_created') AS stripe FROM funnel_events WHERE created_at > NOW() - INTERVAL '30 days' AND visitor_id IS NOT NULL GROUP BY 1)
  SELECT f.src, COUNT(*)::int AS saw_price, COUNT(*) FILTER (WHERE ev.buy)::int AS buy_click, COUNT(*) FILTER (WHERE ev.stripe)::int AS stripe FROM f LEFT JOIN ev USING (visitor_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
row("PRICE page events", await s`SELECT event_name, COUNT(DISTINCT COALESCE(visitor_id, ip))::int AS n FROM funnel_events WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND (path LIKE '/pricing%' OR path LIKE '/upgrade%') GROUP BY 1 ORDER BY 2 DESC LIMIT 25`);

// C. Prime-side pages and sales.
row("PRIME pages 30d", await s`
  SELECT CASE WHEN path LIKE '/sub-finder/join%' THEN '/sub-finder/join' WHEN path LIKE '/sub-finder%' THEN '/sub-finder' WHEN path LIKE '/sub-list%' THEN '/sub-list' WHEN path LIKE '/subs-wanted%' THEN '/subs-wanted'
              WHEN path LIKE '/trade-package%' THEN '/trade-package/*' WHEN path LIKE '/markets%' THEN '/markets*' WHEN path LIKE '/tampa%' THEN '/tampa-contractors' WHEN path LIKE '/partners%' THEN '/partners' END AS page,
         ${SRC} AS src, COUNT(DISTINCT visitor_id)::int AS visitors
  FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT}
    AND (path LIKE '/sub-finder%' OR path LIKE '/sub-list%' OR path LIKE '/subs-wanted%' OR path LIKE '/trade-package%' OR path LIKE '/markets%' OR path LIKE '/tampa%' OR path LIKE '/partners%')
  GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 24`);
try { row("SUB LIST orders", await s`SELECT status, COUNT(*)::int AS n FROM sub_list_orders GROUP BY 1`); } catch (e) { console.log("sub_list_orders:", (e as Error).message.slice(0, 100)); }
try { row("TRADE PACKAGES", await s`SELECT COUNT(*)::int AS packages, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS last30 FROM trade_packages`); } catch (e) { console.log("trade_packages:", (e as Error).message.slice(0, 100)); }
row("PRIME events 30d", await s`SELECT event_name, COUNT(DISTINCT COALESCE(visitor_id, ip))::int AS n FROM funnel_events WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT}
  AND (event_name LIKE 'sub_finder%' OR event_name LIKE 'sub_list%' OR event_name LIKE 'tampa%' OR event_name LIKE 'market%' OR event_name LIKE 'partner%' OR event_name LIKE 'home_tampa%' OR event_name LIKE 'bid_sub_finder%') GROUP BY 1 ORDER BY 2 DESC LIMIT 30`);

// D. AI-assistant visitors.
row("AI by week", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, created_at, ${SRC} AS src FROM page_views WHERE created_at > NOW() - INTERVAL '56 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL ORDER BY visitor_id, created_at)
  SELECT to_char(date_trunc('week', created_at), 'Mon DD') AS week_of, src, COUNT(*)::int AS visitors FROM f
  WHERE src ~* '(chatgpt|openai|perplexity|copilot|gemini|claude|bing\\.com|duckduckgo|you\\.com|phind)' GROUP BY 1, 2, date_trunc('week', created_at) ORDER BY date_trunc('week', created_at), 3 DESC`);
row("CHATGPT landing 30d", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, ${PAT} AS land FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL AND ${SRC} ILIKE '%chatgpt%' ORDER BY visitor_id, created_at)
  SELECT land, COUNT(*)::int AS n FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
row("CHATGPT behaviour 30d", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL AND ${SRC} ILIKE '%chatgpt%' ORDER BY visitor_id, created_at),
  pv AS (SELECT p.visitor_id, COUNT(*) AS views, COUNT(DISTINCT p.path) FILTER (WHERE p.path LIKE '/bid/%') AS bids, BOOL_OR(p.path LIKE '/pricing%' OR p.path LIKE '/upgrade%') AS price, BOOL_OR(p.path LIKE '/radar%') AS radar,
           COUNT(DISTINCT (p.created_at AT TIME ZONE 'America/New_York')::date) AS days
         FROM page_views p JOIN f USING (visitor_id) WHERE p.created_at > NOW() - INTERVAL '30 days' GROUP BY 1),
  ev AS (SELECT e.visitor_id, BOOL_OR(e.event_name ~ '(starter_click|pass_offer_click|checkout_started|lock_sheet_continue)') AS buy, BOOL_OR(e.event_name = 'checkout_session_created') AS stripe,
           BOOL_OR(e.event_name = 'bid_lock_sheet_shown') AS lock_sheet, BOOL_OR(e.event_name = 'radar_lead_captured') AS gave_email, BOOL_OR(e.event_name LIKE 'signup_success%') AS signed_up, BOOL_OR(e.event_name = 'bid_similar_click') AS similar
         FROM funnel_events e JOIN f USING (visitor_id) WHERE e.created_at > NOW() - INTERVAL '30 days' GROUP BY 1)
  SELECT COUNT(*)::int AS visitors, COUNT(*) FILTER (WHERE pv.views = 1)::int AS one_page, COUNT(*) FILTER (WHERE pv.bids >= 2)::int AS opened_2plus_bids, COUNT(*) FILTER (WHERE pv.radar)::int AS radar, COUNT(*) FILTER (WHERE pv.price)::int AS price_page,
         COUNT(*) FILTER (WHERE pv.days >= 2)::int AS came_back_another_day, COUNT(*) FILTER (WHERE ev.buy)::int AS buy_click, COUNT(*) FILTER (WHERE ev.stripe)::int AS stripe, COUNT(*) FILTER (WHERE ev.gave_email)::int AS gave_email,
         COUNT(*) FILTER (WHERE ev.signed_up)::int AS signed_up, COUNT(*) FILTER (WHERE ev.similar)::int AS tapped_similar
  FROM pv LEFT JOIN ev USING (visitor_id)`);
row("CHATGPT bids landed 30d", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, substring(path from '^/bid/([0-9]+)') AS bid FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL AND ${SRC} ILIKE '%chatgpt%' ORDER BY visitor_id, created_at)
  SELECT COALESCE(b.normalized_state, '?') AS state, COALESCE(b.category, '?') AS category, COALESCE(b.source, '?') AS board, (b.due_date > NOW()) AS still_open, COUNT(*)::int AS visitors, COUNT(DISTINCT f.bid)::int AS bids
  FROM f LEFT JOIN bids b ON b.id = f.bid::int WHERE f.bid IS NOT NULL GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 25`);
row("CHATGPT top bids", await s`
  WITH f AS (SELECT DISTINCT ON (visitor_id) visitor_id, substring(path from '^/bid/([0-9]+)') AS bid FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' AND ${NOT_BOT} AND visitor_id IS NOT NULL AND ${SRC} ILIKE '%chatgpt%' ORDER BY visitor_id, created_at)
  SELECT LEFT(b.title, 70) AS title, b.normalized_state AS st, COUNT(*)::int AS visitors FROM f JOIN bids b ON b.id = f.bid::int GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`);
process.exit(0);
