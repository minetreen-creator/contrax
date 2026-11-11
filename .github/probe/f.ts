// TEMP read-only probe: what Facebook and AI visitors do, last 14 days. Counts only; no IPs, ids or emails.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
for (const [name, cond] of [
  ["FB", `(src ~ '(facebook|fb|instagram|meta)' OR ref ~ '(facebook|fb\\.|instagram)')`],
  ["AI", `(src ~ '(chatgpt|openai|perplexity|claude|copilot|gemini)' OR ref ~ '(chatgpt|openai|perplexity|claude\\.ai|copilot|gemini)')`],
  ["DIRECT", `(src IN ('', 'direct') AND med NOT IN ('cpc','ppc','paid'))`],
] as const) {
  const C = s.unsafe(cond);
  const base = s`
    WITH pv AS (
      SELECT visitor_id, created_at, path, lower(coalesce(source,'')) AS src, lower(coalesce(medium,'')) AS med, lower(coalesce(referrer,'')) AS ref,
             coalesce(device_type,'?') AS device
      FROM page_views WHERE created_at > NOW() - INTERVAL '14 days' AND visitor_id IS NOT NULL AND ${NOT_BOT}
    ), first AS (SELECT DISTINCT ON (visitor_id) visitor_id, src, med, ref, path, device FROM pv ORDER BY visitor_id, created_at),
    grp AS (SELECT visitor_id, path, device FROM first WHERE ${C})`;
  const [n] = (await s`${base} SELECT COUNT(*)::int AS n FROM grp`) as { n: number }[];
  console.log(`${name} visitors ${n.n}`);
  const land = (await s`${base} SELECT CASE WHEN path LIKE '/bid/%' THEN '/bid/*' ELSE left(split_part(path,'?',1), 40) END AS landing,
    CASE WHEN path LIKE '%trade=%' THEN 'with trade' WHEN path LIKE '%state=%' THEN 'state only' ELSE 'plain' END AS kind, COUNT(*)::int AS n FROM grp GROUP BY 1,2 ORDER BY 3 DESC LIMIT 8`) as any[];
  console.log(`${name} landing`, JSON.stringify(land));
  const dev = (await s`${base} SELECT device, COUNT(*)::int AS n FROM grp GROUP BY 1 ORDER BY 2 DESC LIMIT 4`) as any[];
  console.log(`${name} device`, JSON.stringify(dev));
  const ev = (await s`${base} SELECT e.event_name, COUNT(DISTINCT e.visitor_id)::int AS visitors, COUNT(*)::int AS times
    FROM funnel_events e JOIN grp USING (visitor_id) WHERE e.created_at > NOW() - INTERVAL '14 days' GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 45`) as any[];
  for (const r of ev) console.log(`${name} event ${r.event_name} visitors=${r.visitors} times=${r.times}`);
  const depth = (await s`${base}, per AS (SELECT pv.visitor_id, COUNT(*) AS views, bool_or(pv.path LIKE '/bid/%') AS bid, bool_or(pv.path LIKE '/signup%') AS signup, bool_or(pv.path LIKE '/pricing%' OR pv.path LIKE '/upgrade%') AS pricing
      FROM pv JOIN grp USING (visitor_id) GROUP BY 1)
    SELECT COUNT(*) FILTER (WHERE views = 1)::int AS one_page, COUNT(*) FILTER (WHERE views BETWEEN 2 AND 3)::int AS two_three, COUNT(*) FILTER (WHERE views > 3)::int AS four_plus,
      COUNT(*) FILTER (WHERE bid)::int AS saw_bid, COUNT(*) FILTER (WHERE signup)::int AS saw_signup, COUNT(*) FILTER (WHERE pricing)::int AS saw_pricing FROM per`) as any[];
  console.log(`${name} depth`, JSON.stringify(depth[0]));
  const results = (await s`${base} SELECT CASE WHEN e.label ~ '\\|0$' OR e.label ~ '(^|[^0-9])0 match' THEN 'zero' ELSE 'some' END AS k, COUNT(*)::int AS n
    FROM funnel_events e JOIN grp USING (visitor_id) WHERE e.created_at > NOW() - INTERVAL '14 days' AND e.event_name = 'radar_scan_complete' GROUP BY 1`) as any[];
  console.log(`${name} scan results`, JSON.stringify(results));
  const labels = (await s`${base} SELECT left(e.label, 60) AS label, COUNT(*)::int AS n FROM funnel_events e JOIN grp USING (visitor_id)
    WHERE e.created_at > NOW() - INTERVAL '14 days' AND e.event_name = 'radar_scan_complete' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`) as any[];
  console.log(`${name} scan labels`, JSON.stringify(labels));
}
process.exit(0);
