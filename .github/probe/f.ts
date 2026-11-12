// Temp probe: supplier-type open jobs (read-only, aggregate counts of public bids, no PII). Removed after.
import { sql } from "../../src/db";
import { LOW_CONTENT_SQL } from "../../src/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "../../src/lib/source-class";
const s = sql();
const JOB = String.raw`(title ~* '\m(concrete|paving|asphalt|sidewalk|curb|bridge|culvert|road|street|site ?work|excavat\w*|grading|storm ?water|drainage|water ?line|sewer|utility|demolition|renovation|construction|building|roof\w*|hvac|plumbing|electrical)\M')`;
const PAVE = String.raw`(title ~* '\m(concrete|paving|asphalt|sidewalk|curb|bridge|culvert|road|street|site ?work|excavat\w*|grading|storm ?water|drainage)\M')`;
const base = `due_date > NOW() AND ${LOW_CONTENT_SQL} AND ${AWARD_EXCLUSION_SQL}`;
const out = (k: string, v: unknown) => console.log("SUP", k, JSON.stringify(v));
out("national", await s.unsafe(`SELECT COUNT(*)::int open, COUNT(DISTINCT normalized_state)::int states FROM bids WHERE ${base} AND ${JOB}`));
out("by_state_top", await s.unsafe(`SELECT normalized_state st, COUNT(*)::int n, COUNT(*) FILTER (WHERE ${PAVE})::int pave FROM bids WHERE ${base} AND ${JOB} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`));
out("va_agencies", await s.unsafe(`SELECT agency, COUNT(*)::int n, COUNT(*) FILTER (WHERE ${PAVE})::int pave FROM bids WHERE ${base} AND ${JOB} AND normalized_state='VA' GROUP BY 1 ORDER BY 2 DESC LIMIT 60`));
out("va_due_30d", await s.unsafe(`SELECT COUNT(*)::int n FROM bids WHERE ${base} AND ${JOB} AND normalized_state='VA' AND due_date < NOW() + interval '30 days'`));
process.exit(0);
