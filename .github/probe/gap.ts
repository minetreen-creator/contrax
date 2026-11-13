// Read-only aggregate: open bids by state prefix of the source name. Removed after.
import { neon } from "@neondatabase/serverless";
const s = neon(process.env.DATABASE_URL!);
const rows = await s.query(`SELECT UPPER(substring(source from '^([a-z]{2})_')) st, COUNT(*)::int n FROM bids WHERE due_date > NOW() GROUP BY 1 ORDER BY 2 DESC`);
console.log("OPEN_BY_STATE", rows.map((r: any) => `${r.st ?? "other"}=${r.n}`).join(" "));
const fam = await s.query(`SELECT CASE WHEN source LIKE 'sam%' THEN 'sam' WHEN source LIKE '%bidnet%' THEN 'bidnet' WHEN source LIKE '%bonfire%' THEN 'bonfire' WHEN source LIKE '%planetbids%' THEN 'planetbids' ELSE 'other' END f, COUNT(*)::int n FROM bids WHERE due_date > NOW() GROUP BY 1 ORDER BY 2 DESC`);
console.log("OPEN_BY_FAMILY", JSON.stringify(fam));
