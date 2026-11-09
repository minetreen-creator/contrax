// Read-only: open HVAC bids by state (public bid data only; no user data).
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
const q = async (label: string, p: Promise<unknown>) => {
  try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 200)); }
};
const HVAC = sql().unsafe(`(category = 'HVAC' OR title ~* '(\\mhvac\\M|heating|air condition|chiller|boiler|cooling tower|rooftop unit|\\mrtu\\M|ventilation)')`);
const OPEN = sql().unsafe(`due_date > NOW() AND ${LOW_CONTENT_SQL} AND ${AWARD_EXCLUSION_SQL} AND normalized_state IS NOT NULL`);
await q("open HVAC bids by state (count, with value, total listed value)", sql()`
  SELECT normalized_state AS state, COUNT(*)::int AS open_bids,
         COUNT(*) FILTER (WHERE estimated_value_num > 0)::int AS with_value,
         ROUND(COALESCE(SUM(estimated_value_num) FILTER (WHERE estimated_value_num > 0), 0))::bigint AS listed_value,
         ROUND(COALESCE(MAX(estimated_value_num), 0))::bigint AS biggest
  FROM bids WHERE ${OPEN} AND ${HVAC} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
await q("biggest single open HVAC bids (listed value)", sql()`
  SELECT normalized_state AS state, title, agency, ROUND(estimated_value_num)::bigint AS value, to_char(due_date, 'Mon DD') AS due
  FROM bids WHERE ${OPEN} AND ${HVAC} AND estimated_value_num > 0 ORDER BY estimated_value_num DESC LIMIT 8`);
await q("share of open HVAC bids that list a value", sql()`
  SELECT COUNT(*)::int AS open_bids, COUNT(*) FILTER (WHERE estimated_value_num > 0)::int AS with_value FROM bids WHERE ${OPEN} AND ${HVAC}`);
process.exit(0);
