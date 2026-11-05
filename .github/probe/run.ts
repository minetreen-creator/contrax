// Read-only, aggregates only (owner 2026-11-05: "Big boy influx / Bot"). No IPs, emails or visitor ids printed.
import { sql } from "~/db";
const s = sql();
const p = (t: string, rows: any[]) => { console.log(`\n== ${t}`); for (const r of rows) console.log(Object.values(r).join(" | ")); };
p("views per hour, last 8h (views | visitors | distinct IPs)", await s`
  SELECT to_char(date_trunc('hour', created_at), 'MM-DD HH24') AS h, COUNT(*)::int, COUNT(DISTINCT visitor_id)::int, COUNT(DISTINCT ip)::int
  FROM page_views WHERE created_at > NOW() - INTERVAL '8 hours' GROUP BY 1 ORDER BY 1`);
p("same hours yesterday", await s`
  SELECT to_char(date_trunc('hour', created_at), 'MM-DD HH24') AS h, COUNT(*)::int, COUNT(DISTINCT visitor_id)::int
  FROM page_views WHERE created_at BETWEEN NOW() - INTERVAL '32 hours' AND NOW() - INTERVAL '24 hours' GROUP BY 1 ORDER BY 1`);
const W = s`created_at > NOW() - INTERVAL '2 hours'`;
p("last 2h by region / city (top 15)", await s`SELECT coalesce(region,'?'), coalesce(city,'?'), COUNT(*)::int, COUNT(DISTINCT visitor_id)::int FROM page_views WHERE ${W} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15`);
p("last 2h by browser / device", await s`SELECT coalesce(browser_label,'?'), coalesce(device_type,'?'), COUNT(*)::int, COUNT(DISTINCT visitor_id)::int FROM page_views WHERE ${W} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 12`);
p("last 2h user-agent shape (top 12)", await s`SELECT left(regexp_replace(coalesce(user_agent,''), '[0-9]+(\\.[0-9]+)*', 'N', 'g'), 110), COUNT(*)::int, COUNT(DISTINCT visitor_id)::int FROM page_views WHERE ${W} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
p("last 2h top paths", await s`SELECT left(path, 80), COUNT(*)::int, COUNT(DISTINCT visitor_id)::int FROM page_views WHERE ${W} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
p("last 2h referrer host / source / medium", await s`SELECT coalesce(substring(referrer from '^https?://([^/]+)'),'(none)'), coalesce(source,''), coalesce(medium,''), COUNT(*)::int, COUNT(DISTINCT visitor_id)::int FROM page_views WHERE ${W} GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 12`);
p("last 2h views per visitor distribution", await s`SELECT CASE WHEN n=1 THEN '1' WHEN n<=3 THEN '2-3' WHEN n<=10 THEN '4-10' WHEN n<=50 THEN '11-50' ELSE '50+' END AS b, COUNT(*)::int FROM (SELECT visitor_id, COUNT(*) n FROM page_views WHERE ${W} GROUP BY 1) x GROUP BY 1 ORDER BY 1`);
p("last 2h signups / searches", await s`SELECT (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '2 hours') AS signups, (SELECT COUNT(*)::int FROM radar_search_log WHERE created_at > NOW() - INTERVAL '2 hours') AS searches`);
process.exit(0);
