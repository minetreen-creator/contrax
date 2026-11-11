// TEMP read-only probe: (1) visitors since today's Facebook post, (2) how long Radar searches take. Counts only.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
// 1. Since 14:30 UTC today (the new result buttons went live about 14:37).
const since = "2026-11-11T14:30:00Z";
const src = (await s`
  WITH pv AS (SELECT visitor_id, created_at, path, lower(coalesce(source,'')) AS src, lower(coalesce(medium,'')) AS med FROM page_views
    WHERE created_at > ${since} AND visitor_id IS NOT NULL AND ${NOT_BOT}),
  first AS (SELECT DISTINCT ON (visitor_id) visitor_id, src, med, path FROM pv ORDER BY visitor_id, created_at),
  per AS (SELECT visitor_id, COUNT(*) AS views, bool_or(path LIKE '/bid/%') AS bid FROM pv GROUP BY 1)
  SELECT CASE WHEN first.src ~ '(facebook|fb|instagram)' THEN 'facebook' WHEN first.src ~ '(chatgpt|openai|perplexity)' THEN 'ai' WHEN first.med IN ('cpc','ppc') THEN 'ads' WHEN first.src IN ('','direct') THEN 'direct' ELSE first.src END AS source,
    COUNT(*)::int AS visitors, COUNT(*) FILTER (WHERE per.views > 1)::int AS more_than_one_page, COUNT(*) FILTER (WHERE per.bid)::int AS opened_a_bid
  FROM first JOIN per USING (visitor_id) GROUP BY 1 ORDER BY 2 DESC`) as any[];
console.log("SINCE_POST by source", JSON.stringify(src));
const ev = (await s`SELECT event_name, COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(*)::int AS times FROM funnel_events
  WHERE created_at > ${since} AND ${NOT_BOT} AND event_name IN ('radar_scan_start','radar_scan_complete','radar_scan_failed','radar_results_viewed','radar_match_title_click','radar_brief_cta','radar_bids_first_click','region_recent_bid_click','bid_typical_size_click','bid_similar_click','bid_top_starter_click','bid_lock_starter_click','radar_anon_pass_offer_click','checkout_session_created','purchase_completed','radar_lead_captured')
  GROUP BY 1 ORDER BY 2 DESC`) as any[];
console.log("SINCE_POST events", JSON.stringify(ev));
// 2. Search timing, last 14 days: seconds from a visitor's search start to its next complete.
const t = (await s`
  WITH st AS (SELECT visitor_id, created_at AS at, coalesce(device_type,'?') AS device FROM funnel_events
      WHERE created_at > NOW() - INTERVAL '14 days' AND event_name = 'radar_scan_start' AND visitor_id IS NOT NULL AND ${NOT_BOT}),
  d AS (SELECT st.device, st.at, (SELECT MIN(c.created_at) FROM funnel_events c WHERE c.visitor_id = st.visitor_id AND c.event_name = 'radar_scan_complete'
        AND c.created_at >= st.at AND c.created_at < st.at + INTERVAL '3 minutes') AS done,
      (SELECT MIN(c.created_at) FROM funnel_events c WHERE c.visitor_id = st.visitor_id AND c.event_name = 'radar_scan_failed'
        AND c.created_at >= st.at AND c.created_at < st.at + INTERVAL '3 minutes') AS failed FROM st)
  SELECT device, COUNT(*)::int AS searches, COUNT(done)::int AS finished, COUNT(failed)::int AS failed,
    COUNT(*) FILTER (WHERE done IS NULL AND failed IS NULL)::int AS never_finished,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (done - at))))::numeric, 1) AS median_seconds,
    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (done - at))))::numeric, 1) AS p90_seconds,
    COUNT(*) FILTER (WHERE done - at > INTERVAL '8 seconds')::int AS over_8s
  FROM d GROUP BY 1 ORDER BY 2 DESC`) as any[];
console.log("SCAN_TIME by device", JSON.stringify(t));
const byday = (await s`
  WITH st AS (SELECT visitor_id, created_at AS at FROM funnel_events WHERE created_at > NOW() - INTERVAL '8 days' AND event_name = 'radar_scan_start' AND visitor_id IS NOT NULL AND ${NOT_BOT}),
  d AS (SELECT st.at, (SELECT MIN(c.created_at) FROM funnel_events c WHERE c.visitor_id = st.visitor_id AND c.event_name = 'radar_scan_complete' AND c.created_at >= st.at AND c.created_at < st.at + INTERVAL '3 minutes') AS done FROM st)
  SELECT at::date AS day, COUNT(*)::int AS searches, COUNT(done)::int AS finished, round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (done - at))))::numeric, 1) AS median_seconds FROM d GROUP BY 1 ORDER BY 1`) as any[];
console.log("SCAN_TIME by day", JSON.stringify(byday));
const fails = (await s`SELECT left(coalesce(label,''), 70) AS label, COUNT(*)::int AS n FROM funnel_events WHERE created_at > NOW() - INTERVAL '14 days' AND event_name = 'radar_scan_failed' AND ${NOT_BOT} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`) as any[];
console.log("SCAN_FAIL labels", JSON.stringify(fails));
process.exit(0);
