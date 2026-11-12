// TEMP read-only, counts only, no PII: has anyone found or bought the data feed?
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const bot = s.unsafe(BOT_EXCLUSION_SQL);
const out = async (label: string, p: Promise<unknown>) => { try { console.log("FEED", label, JSON.stringify(await p)); } catch (e) { console.log("FEED", label, "ERR", (e as Error).message.slice(0, 160)); } };
await out("page visitors since Oct 1 by path", s`SELECT split_part(path,'?',1) AS p, COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE created_at > '2026-10-01' AND NOT ${bot} AND split_part(path,'?',1) IN ('/data','/leads','/suppliers','/workspace','/openapi.json') GROUP BY 1 ORDER BY 2 DESC`);
await out("data page visitors by source since Oct 1", s`SELECT COALESCE(NULLIF(source,''),'direct') AS source, COUNT(DISTINCT visitor_id)::int AS v FROM page_views WHERE created_at > '2026-10-01' AND NOT ${bot} AND split_part(path,'?',1) = '/data' GROUP BY 1 ORDER BY 2 DESC`);
await out("requests by status and month", s`SELECT to_char(created_at,'YYYY-MM') AS m, status, COUNT(*)::int AS n FROM data_feed_requests GROUP BY 1, 2 ORDER BY 1, 2`);
await out("access rows", s`SELECT COALESCE(tier,'granted') AS tier, COALESCE(status,'') AS status, active, COUNT(*)::int AS n FROM data_feed_access GROUP BY 1, 2, 3`);
await out("api usage by month", s`SELECT to_char(day,'YYYY-MM') AS m, COUNT(DISTINCT key_id)::int AS keys, SUM(requests)::int AS requests, SUM(rows_served)::int AS rows FROM api_usage GROUP BY 1 ORDER BY 1`);
await out("checkout events for feed plans", s`SELECT event_name, COALESCE(label,'') AS label, COUNT(*)::int AS n FROM funnel_events WHERE created_at > '2026-10-01' AND NOT ${bot} AND (event_name LIKE 'data_feed%' OR label IN ('starter_feed','pro','leads','primes')) GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`);
process.exit(0);
