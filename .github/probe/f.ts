// TEMP read-only, counts only, no PII: what today's visitors did.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const bot = s.unsafe(BOT_EXCLUSION_SQL);
const out = async (label: string, p: Promise<unknown>) => { try { console.log("TODAY", label, JSON.stringify(await p)); } catch (e) { console.log("TODAY", label, "ERR", (e as Error).message.slice(0, 160)); } };
await out("events today and yesterday (ET)", s`SELECT (created_at AT TIME ZONE 'America/New_York')::date AS day, event_name, COUNT(DISTINCT visitor_id)::int AS v FROM funnel_events WHERE created_at > now() - interval '2 days' AND NOT ${bot} GROUP BY 1, 2 HAVING COUNT(DISTINCT visitor_id) >= 1 ORDER BY 1 DESC, 3 DESC LIMIT 70`);
await out("google visitors by medium, 3 days", s`SELECT (created_at AT TIME ZONE 'America/New_York')::date AS day, COALESCE(NULLIF(medium,''),'none') AS medium, device_type, COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE created_at > now() - interval '3 days' AND source = 'google' AND NOT ${bot} GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC`);
await out("bid page visitors by day", s`SELECT (created_at AT TIME ZONE 'America/New_York')::date AS day, COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE created_at > now() - interval '4 days' AND path LIKE '/bid/%' AND NOT ${bot} GROUP BY 1 ORDER BY 1`);
process.exit(0);
