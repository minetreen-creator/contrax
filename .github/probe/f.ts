// Read-only probe: Connecticut open bids, and cleaning-type ones, by source. Public bid fields only.
import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
const s = sql();
const ct = s`(source LIKE 'ct\\_%' OR LOWER(COALESCE(location,'')) LIKE '%connecticut%' OR COALESCE(location,'') ~ ',\\s*CT\\b')`;
const [t] = (await s`SELECT COUNT(*)::int AS n FROM bids WHERE due_date > NOW() AND ${s.unsafe(AWARD_EXCLUSION_SQL)} AND ${ct}`) as { n: number }[];
const bySrc = (await s`SELECT source, COUNT(*)::int AS n FROM bids WHERE due_date > NOW() AND ${s.unsafe(AWARD_EXCLUSION_SQL)} AND ${ct} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`) as { source: string; n: number }[];
console.log(`CT open ${t.n}; by source: ${bySrc.map((r) => `${r.source} ${r.n}`).join(", ")}`);
const clean = (await s`
  SELECT id, source, agency, title, due_date FROM bids
  WHERE due_date > NOW() AND ${s.unsafe(AWARD_EXCLUSION_SQL)} AND ${ct}
    AND (title ~* '(janitor|custodia|cleaning|clean-up|cleanup|floor (care|maint|refinish|strip|wax)|window wash|carpet|pressure wash|power wash|sanitiz|disinfect|porter|housekeep|trash|restroom|portable toilet|duct clean|mat service|uniform|linen)'
      OR description ~* '(janitorial|custodial services|cleaning services)')
  ORDER BY due_date LIMIT 60`) as { id: number; source: string; agency: string | null; title: string; due_date: Date }[];
console.log(`CT cleaning-type open: ${clean.length}`);
for (const r of clean) console.log(`  ${r.id} | ${r.source} | ${r.agency} | ${r.title.slice(0, 110)} | ${new Date(r.due_date).toISOString().slice(0, 10)}`);
const [last] = (await s`SELECT MAX(created_at) AS m FROM bids WHERE source = 'ct_bidnet'`) as { m: Date | null }[];
console.log("ct_bidnet last new row:", last?.m);
process.exit(0);
