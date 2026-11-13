// Read-only daily counts (last 24h), aggregates only, no PII printed. Removed after.
import { neon } from "@neondatabase/serverless";
const s = neon(process.env.DATABASE_URL!);
const BOT = `(user_agent IS NULL OR user_agent !~* '(bot|crawl|spider|slurp|preview|headless|lighthouse|python|curl|wget|httpclient|monitor)')`;
const q = async (label: string, sql: string) => { try { console.log(label, JSON.stringify(await s.query(sql))); } catch (e) { console.log(label, "ERR", (e as Error).message); } };
await q("visitors_by_source", `SELECT COALESCE(NULLIF(source,''),'direct') src, COUNT(DISTINCT visitor_id)::int v FROM page_views WHERE created_at > NOW()-INTERVAL '24 hours' AND ${BOT} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
await q("visitors_total_24h_vs_prev", `SELECT COUNT(DISTINCT visitor_id) FILTER (WHERE created_at > NOW()-INTERVAL '24 hours')::int now, COUNT(DISTINCT visitor_id) FILTER (WHERE created_at <= NOW()-INTERVAL '24 hours')::int prev FROM page_views WHERE created_at > NOW()-INTERVAL '48 hours' AND ${BOT}`);
await q("events", `SELECT event_name, COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int v FROM funnel_events WHERE created_at > NOW()-INTERVAL '24 hours' AND ${BOT} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`);
await q("company_page_views", `SELECT COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int v FROM page_views WHERE path LIKE '/company/%' AND created_at > NOW()-INTERVAL '24 hours' AND ${BOT}`);
await q("coop_alerts", `SELECT COUNT(*)::int n FROM coop_alerts WHERE created_at > NOW()-INTERVAL '24 hours'`);
await q("new_users_24h", `SELECT COUNT(*)::int n FROM users WHERE created_at > NOW()-INTERVAL '24 hours'`);
await q("collector_failures_24h", `SELECT source, status, COUNT(*)::int n FROM collector_run_log WHERE started_at > NOW()-INTERVAL '24 hours' AND status NOT IN ('ok','success','ran_zero') GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25`);
