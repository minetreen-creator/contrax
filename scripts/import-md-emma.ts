import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { mapCategory } from "../src/lib/trade-classification";
import { syncSource, dedupeBatchByNaturalKey } from "../src/jobs/runner";
import type { RawBid } from "../src/jobs/sources/sam-gov";

const records = JSON.parse(await readFile(new URL("../data/md-open-solicitations-2026-09-30.json", import.meta.url), "utf8"));
if (records.length !== 468 || new Set(records.map((r: any) => r.url)).size !== 468) throw new Error("Snapshot identity validation failed");
for (const r of records) {
  if (r.cells.length !== 9 || !r.cells[1] || !r.cells[2] || !r.cells[8] || r.cells[3] !== "Open" || (r.due_iso !== null && !Number.isFinite(Date.parse(r.due_iso)))) throw new Error("Invalid listing");
  const url = new URL(r.url);
  if (url.origin !== "https://emma.maryland.gov" || !/^\/page.aspx\/en\/bpm\/process_manage_extranet\/\d+$/.test(url.pathname)) throw new Error("Invalid source link");
}
const eligible = records.filter((r: any) => Date.parse(r.due_iso) > Date.now());
const rows: RawBid[] = eligible.map((r: any) => ({
  external_id: "md-emma:" + r.cells[1],
  title: r.cells[2], agency: r.cells[8], description: "Main category: " + r.cells[6],
  location: "Maryland", category: mapCategory("", r.cells[2], r.cells[6]),
  due_date: r.due_iso, estimated_value: "", source_url: r.url,
  solicitation_number: r.cells[1], notice_type: r.cells[7], source_label: "md_emma",
}));
console.log(JSON.stringify({validated: records.length, eligible: rows.length, excluded: records.length - rows.length, missingDeadline: records.filter((r: any) => r.due_iso === null).length}));
if (process.argv.includes("--apply")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = neon(process.env.DATABASE_URL);
  const existing = await sql`SELECT solicitation_number, agency, source_url, title FROM bids WHERE normalized_state = 'MD'`;
  const keys = new Set(existing.map((r: any) => String(r.agency).trim().toLowerCase() + "|" + String(r.solicitation_number ?? "").trim().toLowerCase()));
  const urls = new Set(existing.map((r: any) => r.source_url));
  const titles = new Set(existing.map((r: any) => String(r.title).trim().toLowerCase() + '|' + String(r.agency).trim().toLowerCase()));
  const canonical = dedupeBatchByNaturalKey(rows);
  const candidates = canonical.filter(r => !titles.has(r.title.trim().toLowerCase() + '|' + r.agency.trim().toLowerCase()) && !urls.has(r.source_url) && !keys.has(r.agency.trim().toLowerCase() + "|" + r.solicitation_number!.trim().toLowerCase()));
  const result = await syncSource(sql, {name: "md_emma", fetchFn: async () => candidates});
  if (result.failed || result.errors.length) throw new Error("Maryland import failed");
  const stored = await sql`SELECT source_url FROM bids WHERE source_url LIKE 'https://emma.maryland.gov/page.aspx/en/bpm/process_manage_extranet/%'`;
  const saved = new Set(stored.map((r: any) => r.source_url));
  const snapshotVerifiedSourceLinks = rows.filter(r => saved.has(r.source_url)).length;
  if (candidates.some(r => !saved.has(r.source_url))) throw new Error("Saved link verification failed");
  console.log(JSON.stringify({snapshotVerifiedSourceLinks, newlyInserted: result.new, candidates: candidates.length, existingIdentityMatches: rows.length - candidates.length, verifiedSourceLinks: candidates.filter(r => saved.has(r.source_url)).length, result}));
}
