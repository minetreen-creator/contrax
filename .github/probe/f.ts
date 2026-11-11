// TEMP read-only, counts only, no PII: today vs the last 3 days.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const bot = s.unsafe(BOT_EXCLUSION_SQL);
const out = async (label: string, p: Promise<unknown>) => { try { console.log("TODAY", label, JSON.stringify(await p)); } catch (e) { console.log("TODAY", label, "ERR", (e as Error).message.slice(0, 160)); } };
await out("visitors by ET day and source", s`SELECT (created_at AT TIME ZONE 'America/New_York')::date AS day, COALESCE(NULLIF(source,''),'direct') AS source, COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE created_at > now() - interval '4 days' AND NOT ${bot} GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
await out("key events by ET day", s`SELECT (created_at AT TIME ZONE 'America/New_York')::date AS day, event_name, COUNT(DISTINCT visitor_id)::int AS v FROM funnel_events WHERE created_at > now() - interval '4 days' AND NOT ${bot} AND event_name IN ('radar_bids_first_click','radar_match_title_click','radar_brief_cta','radar_scan_started','radar_scan_completed','bid_page_view','bid_lock_starter_click','unlock_sheet_open','plan_checkout_started','plan_checkout_redirected','checkout_session_created','purchase_completed','starter_pass_purchased','region_recent_bid_click','signup_completed') GROUP BY 1, 2 ORDER BY 1, 2`);
await out("today top landing paths", s`SELECT split_part(path,'?',1) AS p, COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE created_at > now() - interval '24 hours' AND NOT ${bot} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
await out("paid accounts", s`SELECT plan_tier, subscription_status, COUNT(*)::int FROM users WHERE plan_tier IS NOT NULL GROUP BY 1, 2`);
process.exit(0);
