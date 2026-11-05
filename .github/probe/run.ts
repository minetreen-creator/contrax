// Read-only (owner 2026-11-05: "Track the source" / "Gotta be a way"). Counts only: no IP, email or
// visitor id is printed, and nothing is sent anywhere.
import { sql } from "~/db";
const s = sql();
const p = (t: string, rows: any[]) => { console.log(`\n== ${t}`); for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" | ")); };
const US = `('US','PR','GU','VI','AS','MP','UM')`;
const STALE = `(pv.user_agent ~ 'Chrome/1(1[89]|2[01])\\.0\\.0\\.0' OR pv.user_agent ~ 'Firefox/12[01]\\.0')`;
p("non-US views per minute since 17:30 UTC (block went live ~17:40)", await s`
  SELECT to_char(date_trunc('minute', pv.created_at), 'HH24:MI') AS t, COUNT(*)::int AS views
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id
  WHERE pv.created_at > '2026-11-05T17:30:00Z' AND v.country IS NOT NULL AND upper(v.country) NOT IN ${s.unsafe(US)} GROUP BY 1 ORDER BY 1`);
p("stale browser builds (Chrome 118-121 / Firefox 120-121), US vs non-US, last 12h", await s`
  SELECT CASE WHEN upper(coalesce(v.country,'')) IN ${s.unsafe(US)} THEN 'US' ELSE 'non-US' END AS where_, COUNT(*)::int AS views, COUNT(DISTINCT pv.ip)::int AS ips,
    COUNT(*) FILTER (WHERE pv.path LIKE '/bid/%')::int AS bid_views
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id
  WHERE pv.created_at > NOW() - INTERVAL '12 hours' AND ${s.unsafe(STALE)} GROUP BY 1`);
p("stale builds, US side, per 10 min, last 12h", await s`
  SELECT to_char(date_trunc('hour', pv.created_at) + floor(extract(minute from pv.created_at)/10)*INTERVAL '10 min', 'HH24:MI') AS t, COUNT(*)::int AS views
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id
  WHERE pv.created_at > NOW() - INTERVAL '12 hours' AND ${s.unsafe(STALE)} AND upper(coalesce(v.country,'')) IN ${s.unsafe(US)} GROUP BY 1 ORDER BY 1`);
p("stale builds per day, last 30 days", await s`
  SELECT to_char(date_trunc('day', pv.created_at), 'MM-DD') AS day, COUNT(*)::int AS views FROM page_views pv
  WHERE pv.created_at > NOW() - INTERVAL '30 days' AND ${s.unsafe(STALE)} GROUP BY 1 ORDER BY 1`);
p("signed-in users ever seen on a stale build", await s`SELECT COUNT(DISTINCT pv.user_id)::int AS users FROM page_views pv WHERE pv.user_id IS NOT NULL AND ${s.unsafe(STALE)}`);
process.exit(0);
