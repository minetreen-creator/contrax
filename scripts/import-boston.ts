import { neon } from "@neondatabase/serverless";
import { syncSource } from "../src/jobs/runner";
import { fetchBostonBids } from "../src/jobs/sources/ma-boston";

const fetched = await fetchBostonBids();
console.log(JSON.stringify({ publicBoardOpen: fetched.rows.length, skipped: fetched.skipped }));
if (process.argv.includes("--apply")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = neon(process.env.DATABASE_URL);
  // Use the regular runner's cross-source natural-key guard and source upsert.
  // A COMMBUYS row with the same title and buyer is retained rather than copied.
  const result = await syncSource(sql, { name: "ma_boston", fetchFn: async () => fetched });
  if (result.failed || result.errors.length || result.qualityGate === "fail") throw new Error("Boston import failed");
  const stored = await sql`SELECT title, agency, source_url, source, normalized_state FROM bids WHERE source = 'ma_boston' OR normalized_state = 'MA'`;
  const key = (r: {title: string; agency: string}) => r.title.trim().toLowerCase() + "|" + r.agency.trim().toLowerCase();
  const urls = new Set(stored.map(r => r.source_url));
  const keys = new Set(stored.map(r => key(r as {title: string; agency: string})));
  if (fetched.rows.some(r => !urls.has(r.source_url) && !keys.has(key(r)))) throw new Error("Boston stored-row verification failed");
  const own = stored.filter(r => r.source === "ma_boston");
  if (own.some(r => r.normalized_state !== "MA")) throw new Error("Boston state normalization failed");
  const ownKeys = new Set(own.map(r => key(r as {title: string; agency: string})));
  if (stored.some(r => r.source !== "ma_boston" && ownKeys.has(key(r as {title: string; agency: string})))) throw new Error("Cross-source natural-key duplicate found");
  console.log(JSON.stringify({ verifiedPublicNotices: fetched.rows.length, bostonSourceRows: own.length, newlyInserted: result.new, result }));
}
