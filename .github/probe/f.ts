// Read-only aggregates: open bids and last run per source for weak states (FL, MI, NC, NJ, AZ). Removed after.
import { neon } from "@neondatabase/serverless";
const s = neon(process.env.DATABASE_URL!);
for (const st of ["fl", "mi", "nc", "nj", "az"]) {
  const rows = await s.query(`
    WITH o AS (SELECT source, COUNT(*) FILTER (WHERE due_date > NOW())::int open, COUNT(*)::int total, MAX(created_at) newest FROM bids WHERE source LIKE $1 GROUP BY 1),
    r AS (SELECT DISTINCT ON (source) source, ran_at, fetched_count, accepted_count, errors, ran_zero, quality_gate FROM collector_run_log WHERE source LIKE $1 ORDER BY source, ran_at DESC)
    SELECT COALESCE(o.source, r.source) src, o.open, o.total, to_char(o.newest,'MM-DD') newest, to_char(r.ran_at,'MM-DD HH24') ran, r.fetched_count f, r.accepted_count a, r.errors e, r.quality_gate g
    FROM o FULL JOIN r ON o.source = r.source ORDER BY o.open DESC NULLS LAST`, [st + "\\_%"]);
  console.log(`=== ${st.toUpperCase()} (${rows.length} sources)`);
  for (const x of rows as any[]) console.log(`  ${x.src} open=${x.open ?? 0} total=${x.total ?? 0} newest=${x.newest ?? "-"} ran=${x.ran ?? "-"} fetched=${x.f ?? "-"} accepted=${x.a ?? "-"} err=${x.e ?? "-"} gate=${x.g ?? "-"}`);
}
// Bids located in the state but stored under national/other sources (location text ends with ", FL" etc.).
const loc = await s.query(`SELECT substring(location from ',\\s*([A-Z]{2})\\s*$') st, COUNT(*)::int n FROM bids WHERE due_date > NOW() AND substring(location from ',\\s*([A-Z]{2})\\s*$') IN ('FL','MI','NC','NJ','AZ','MA','VA') GROUP BY 1 ORDER BY 2 DESC`);
console.log("OPEN_BY_LOCATION_STATE", JSON.stringify(loc));
