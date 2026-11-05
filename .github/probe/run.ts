// Read-only, aggregates only (owner 2026-11-05: "Track the source"). No IPs, emails or visitor ids printed.
import { sql } from "~/db";
const s = sql();
const p = (t: string, rows: any[]) => { console.log(`\n== ${t}`); for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" | ")); };
const US = `('US','PR','GU','VI','AS','MP','UM')`;
const NONUS = s.unsafe(`v.country IS NOT NULL AND upper(v.country) NOT IN ${US}`);
p("non-US page views per day, last 14 days", await s`
  SELECT to_char(date_trunc('day', pv.created_at), 'MM-DD') AS day, COUNT(*)::int AS views, COUNT(DISTINCT pv.visitor_id)::int AS visitors,
    COUNT(*) FILTER (WHERE pv.path LIKE '/bid/%')::int AS bid_views,
    COUNT(*) FILTER (WHERE coalesce(pv.referrer,'') = '')::int AS no_referrer
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id
  WHERE pv.created_at > NOW() - INTERVAL '14 days' AND ${NONUS} GROUP BY 1 ORDER BY 1`);
p("non-US page views per 10 min, last 4h", await s`
  SELECT to_char(date_trunc('hour', pv.created_at) + floor(extract(minute from pv.created_at)/10)*INTERVAL '10 min', 'HH24:MI') AS t, COUNT(*)::int AS views
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id
  WHERE pv.created_at > NOW() - INTERVAL '4 hours' AND ${NONUS} GROUP BY 1 ORDER BY 1`);
const W = s`pv.created_at > NOW() - INTERVAL '6 hours'`;
p("last 6h non-US by country", await s`SELECT upper(v.country) AS country, COUNT(*)::int AS views, COUNT(DISTINCT pv.visitor_id)::int AS visitors FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id WHERE ${W} AND ${NONUS} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`);
p("last 6h non-US: what they read (bid source / state / category)", await s`
  SELECT b.source, coalesce(b.normalized_state,'?') AS st, coalesce(b.category,'?') AS cat, COUNT(*)::int AS views
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id
  JOIN bids b ON b.id = NULLIF(substring(pv.path from '^/bid/([0-9]+)'), '')::int
  WHERE ${W} AND ${NONUS} GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 20`);
p("last 6h non-US: bid ids read (spread, open vs closed)", await s`
  SELECT COUNT(*)::int AS bid_views, COUNT(DISTINCT b.id)::int AS distinct_bids, MIN(b.id) AS min_id, MAX(b.id) AS max_id,
    COUNT(*) FILTER (WHERE b.due_date > NOW())::int AS open_bids, COUNT(*) FILTER (WHERE b.due_date <= NOW())::int AS closed_bids,
    COUNT(*) FILTER (WHERE b.id IS NULL)::int AS missing
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id
  LEFT JOIN bids b ON b.id = NULLIF(substring(pv.path from '^/bid/([0-9]+)'), '')::int
  WHERE ${W} AND ${NONUS} AND pv.path LIKE '/bid/%'`);
p("last 6h non-US: exact browser builds", await s`SELECT left(coalesce(pv.user_agent,''), 150) AS ua, COUNT(*)::int AS views FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id WHERE ${W} AND ${NONUS} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
p("last 6h non-US: network shape (no addresses)", await s`
  SELECT COUNT(DISTINCT pv.ip)::int AS distinct_ips,
    COUNT(DISTINCT pv.ip) FILTER (WHERE pv.ip LIKE '%:%')::int AS ipv6,
    COUNT(DISTINCT split_part(pv.ip, '.', 1) || '.' || split_part(pv.ip, '.', 2)) FILTER (WHERE pv.ip NOT LIKE '%:%')::int AS distinct_ipv4_slash16,
    COUNT(*)::int AS views
  FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id WHERE ${W} AND ${NONUS}`);
p("last 6h non-US: source / medium / campaign / referrer host", await s`SELECT coalesce(pv.source,'') AS src, coalesce(pv.medium,'') AS med, coalesce(pv.campaign,'') AS camp, coalesce(substring(pv.referrer from '^https?://([^/]+)'),'') AS ref, COUNT(*)::int AS views FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id WHERE ${W} AND ${NONUS} GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 10`);
p("first time this pattern was seen (non-US, /bid/, no referrer, 1 view/visitor), weekly", await s`
  SELECT to_char(date_trunc('week', first_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS visitors FROM (
    SELECT pv.visitor_id, MIN(pv.created_at) AS first_at, COUNT(*) AS n, bool_and(pv.path LIKE '/bid/%') AS allbid, bool_and(coalesce(pv.referrer,'')='') AS noref
    FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id WHERE pv.created_at > NOW() - INTERVAL '60 days' AND ${NONUS} GROUP BY 1) x
  WHERE n = 1 AND allbid AND noref GROUP BY 1 ORDER BY 1`);
p("blocked since the US-only deploy? (any non-US views in the last 10 min)", await s`SELECT COUNT(*)::int AS views FROM page_views pv JOIN visitors v ON v.visitor_id = pv.visitor_id WHERE pv.created_at > NOW() - INTERVAL '10 minutes' AND ${NONUS}`);
process.exit(0);
