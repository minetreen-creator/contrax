// Read-only: how many currently-open SAM.gov solicitations (public notice ids) we already store. Removed after.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
const s = neon(process.env.DATABASE_URL!);
const ids: string[] = JSON.parse(readFileSync(".github/probe/ids.json", "utf8"));
const ext = ids.map((i) => `sam-${i}`);
const r = await s.query(`SELECT COUNT(DISTINCT external_id)::int have, COUNT(DISTINCT external_id) FILTER (WHERE due_date > NOW())::int have_open FROM bids WHERE external_id = ANY($1)`, [ext]);
console.log("SAM open solicitations listed:", ids.length, "stored:", JSON.stringify(r));
const src = await s.query(`SELECT source, COUNT(*)::int n FROM bids WHERE external_id = ANY($1) GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [ext]);
console.log("by source:", JSON.stringify(src));
