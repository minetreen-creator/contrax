import { neon } from "@neondatabase/serverless";
const s = neon(process.env.DATABASE_URL!);
const two = await s`SELECT source, left(title,80) t, agency, location, normalized_state, source_url FROM bids
  WHERE due_date > NOW() AND (title ILIKE '%Pistol Creek%' OR title ILIKE '%Hope Street Culvert%')`;
for (const r of two) console.log(`${r.source} | ${r.t} | ${r.agency} | ${r.location} | ${r.normalized_state} | ${r.source_url}`);
const ag = await s`SELECT agency, COUNT(*)::int n FROM bids WHERE due_date > NOW() AND source = 'ct_webprocure' GROUP BY 1 ORDER BY 2 DESC`;
console.log("ct_webprocure open agencies:", ag.length); for (const r of ag) console.log(`${r.n} | ${r.agency}`);
