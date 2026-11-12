// TEMP read-only, counts only: how many people ever saw and tried Bid Scout (Sep 10 - Nov 7)?
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const bot = s.unsafe(BOT_EXCLUSION_SQL);
const out = async (label: string, p: Promise<unknown>) => { try { console.log("SCOUT", label, JSON.stringify(await p)); } catch (e) { console.log("SCOUT", label, "ERR", (e as Error).message.slice(0, 160)); } };
await out("page visitors by month", s`SELECT to_char(created_at,'YYYY-MM') AS m, COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE split_part(path,'?',1) = '/bid-scout' AND created_at >= '2026-09-01' AND NOT ${bot} GROUP BY 1 ORDER BY 1`);
await out("events", s`SELECT event_name, COUNT(DISTINCT visitor_id)::int AS v FROM funnel_events WHERE event_name LIKE 'bid_scout%' AND created_at >= '2026-09-01' AND NOT ${bot} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
await out("subscriptions", s`SELECT status, COUNT(*)::int AS n FROM bid_scout_subscriptions GROUP BY 1`);
await out("all site visitors same period", s`SELECT COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE created_at >= '2026-09-10' AND created_at < '2026-11-08' AND NOT ${bot}`);
process.exit(0);
