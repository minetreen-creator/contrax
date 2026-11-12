// TEMP read-only, counts only: open feed-eligible bids by source platform.
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
const s = sql();
const r = await s`
  SELECT CASE
    WHEN source LIKE '%bidnet%' THEN 'bidnet'
    WHEN source LIKE '%bonfire%' THEN 'bonfire'
    WHEN source LIKE '%periscope%' OR source LIKE '%bidsync%' THEN 'periscope'
    WHEN source LIKE '%ionwave%' OR source = 'fl_lee_county' THEN 'ionwave'
    WHEN source LIKE '%planetbids%' THEN 'planetbids'
    WHEN source LIKE '%beacon%' OR source LIKE '%jaggaer%' OR source LIKE '%questcdn%' OR source LIKE '%demandstar%' OR source LIKE '%opengov%' THEN 'other platforms'
    WHEN source LIKE 'sam%' THEN 'sam.gov'
    ELSE 'agency sites' END AS grp,
    COUNT(*)::int AS open
  FROM bids WHERE due_date > NOW() AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
  GROUP BY 1 ORDER BY 2 DESC`;
console.log("PLAT " + JSON.stringify(r));
process.exit(0);
