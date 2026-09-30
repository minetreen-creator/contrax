import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { mapCategory } from "../src/lib/trade-classification";
import { syncSource } from "../src/jobs/runner";
import type { RawBid } from "../src/jobs/sources/sam-gov";

const records = JSON.parse(await readFile(new URL("../data/nc-open-solicitations-2026-09-30.json", import.meta.url), "utf8"));
if (records.length !== 247 || new Set(records.map((r: any) => r.url)).size !== 247) throw new Error("Snapshot identity validation failed");
for (const r of records) {
  if (r.cells.length !== 7 || !r.cells[0] || !r.cells[1] || !r.cells[6] || r.cells[5] !== "Open" || !Number.isFinite(Date.parse(r.due_iso))) throw new Error("Invalid listing");
  const url = new URL(r.url);
  if (url.origin !== "https://evp.nc.gov" || url.pathname !== "/solicitations/details/" || !url.searchParams.get("id")) throw new Error("Invalid source link");
}
const eligible = records.filter((r: any) => Date.parse(r.due_iso) > Date.now());
const rows: RawBid[] = eligible.map((r: any) => ({
  external_id: "nc-evp:" + new URL(r.url).searchParams.get("id"),
  title: r.cells[1], agency: r.cells[6], description: r.cells[2],
  location: "North Carolina", category: mapCategory("", r.cells[1], r.cells[2]),
  due_date: r.due_iso, estimated_value: "", source_url: r.url,
  solicitation_number: r.cells[0], source_label: "nc_evp",
}));
console.log(JSON.stringify({validated: records.length, eligible: rows.length, expired: records.length - rows.length}));
if (process.argv.includes("--apply")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = neon(process.env.DATABASE_URL);
  const existing = await sql`SELECT solicitation_number, agency, source_url FROM bids WHERE normalized_state = 'NC'`;
  const keys = new Set(existing.map((r: any) => String(r.agency).trim().toLowerCase() + "|" + String(r.solicitation_number ?? "").trim().toLowerCase()));
  const urls = new Set(existing.map((r: any) => r.source_url));
  const candidates = rows.filter(r => !urls.has(r.source_url) && !keys.has(r.agency.trim().toLowerCase() + "|" + r.solicitation_number!.trim().toLowerCase()));
  const result = await syncSource(sql, {name: "nc_evp", fetchFn: async () => candidates});
  if (result.failed || result.errors.length) throw new Error("NC import failed");
  const stored = await sql`SELECT source_url FROM bids WHERE source_url LIKE 'https://evp.nc.gov/solicitations/details/%'`;
  const saved = new Set(stored.map((r: any) => r.source_url));
  if (candidates.some(r => !saved.has(r.source_url))) throw new Error("Saved link verification failed");
  console.log(JSON.stringify({newlyInserted: result.new, candidates: candidates.length, existingIdentityMatches: rows.length - candidates.length, verifiedSourceLinks: candidates.filter(r => saved.has(r.source_url)).length, result}));
}
