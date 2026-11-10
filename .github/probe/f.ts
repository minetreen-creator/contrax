// Read-only probe: Contrax's own weekly bid volume, to compare with a competitor's claim. Counts only.
import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
const s = sql();
const [w] = (await s`
  SELECT COUNT(*)::int AS new_week,
         COUNT(DISTINCT LOWER(agency))::int AS agencies_week,
         COUNT(*) FILTER (WHERE source = 'sam_gov' OR source LIKE 'sam_%')::int AS federal_week
  FROM bids WHERE created_at > NOW() - INTERVAL '7 days' AND ${s.unsafe(AWARD_EXCLUSION_SQL)}`) as Record<string, number>[];
const [o] = (await s`
  SELECT COUNT(*)::int AS open_now, COUNT(DISTINCT LOWER(agency))::int AS agencies_open,
         COUNT(*) FILTER (WHERE due_date < NOW() + INTERVAL '7 days')::int AS closing_week
  FROM bids WHERE due_date > NOW() AND ${s.unsafe(AWARD_EXCLUSION_SQL)}`) as Record<string, number>[];
const days = (await s`
  SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, COUNT(*)::int AS n FROM bids
  WHERE created_at > NOW() - INTERVAL '7 days' AND ${s.unsafe(AWARD_EXCLUSION_SQL)} GROUP BY 1 ORDER BY 1`) as { d: string; n: number }[];
const [src] = (await s`SELECT COUNT(DISTINCT source)::int AS sources_week FROM bids WHERE created_at > NOW() - INTERVAL '7 days'`) as Record<string, number>[];
console.log("WEEK", JSON.stringify(w), "OPEN", JSON.stringify(o), "SOURCES", JSON.stringify(src));
console.log("DAYS", days.map((x) => `${x.d} ${x.n}`).join(", "));
process.exit(0);
