import { neon } from "@neondatabase/serverless";
import { syncSource } from "../src/jobs/runner";
import { fetchMobileBids } from "../src/jobs/sources/al-mobile";

const fetched = await fetchMobileBids();
console.log(JSON.stringify({ publicBoardOpen: fetched.rows.length, skipped: fetched.skipped }));
if (process.argv.includes("--apply")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = neon(process.env.DATABASE_URL);
  // Use the regular runner's cross-source natural-key guard and source upsert.
  // An existing source row with the same title and buyer is retained rather than copied.
  const result = await syncSource(sql, { name: "al_mobile", fetchFn: async () => fetched });
  if (result.failed || result.errors.length || result.qualityGate === "fail") throw new Error("Mobile import failed");
  const stored = await sql`SELECT title, agency, source_url, source, normalized_state FROM bids WHERE source = 'al_mobile' OR normalized_state = 'AL'`;
  const key = (r: {title: string; agency: string}) => r.title.trim().toLowerCase() + "|" + r.agency.trim().toLowerCase();
  const urls = new Set(stored.map(r => r.source_url));
  const keys = new Set(stored.map(r => key(r as {title: string; agency: string})));
  if (fetched.rows.some(r => !urls.has(r.source_url) && !keys.has(key(r)))) throw new Error("Mobile stored-row verification failed");
  const own = stored.filter(r => r.source === "al_mobile");
  if (own.some(r => r.normalized_state !== "AL")) throw new Error("Mobile state normalization failed");
  const ownKeys = new Set(own.map(r => key(r as {title: string; agency: string})));
  if (stored.some(r => r.source !== "al_mobile" && ownKeys.has(key(r as {title: string; agency: string})))) throw new Error("Cross-source natural-key duplicate found");
  console.log(JSON.stringify({ verifiedPublicNotices: fetched.rows.length, mobileSourceRows: own.length, newlyInserted: result.new, result }));
}
