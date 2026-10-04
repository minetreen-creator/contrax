import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { mapCategory } from "../src/lib/trade-classification";
import { syncSource, dedupeBatchByNaturalKey } from "../src/jobs/runner";
import type { RawBid } from "../src/jobs/sources/sam-gov";

interface Listing {
  id: string; title: string; commodity: string; agency: string;
  status: string; due: string; due_iso: string; url: string; awarded: boolean;
}
const records: Listing[] = JSON.parse(await readFile(new URL("../data/az-open-solicitations-2026-10-04.json", import.meta.url), "utf8"));
if (records.length !== 39 || new Set(records.map(r => r.url)).size !== 39 || new Set(records.map(r => r.id)).size !== 39) throw new Error("Snapshot identity validation failed");
for (const r of records) {
  const url = new URL(r.url);
  if (!/^BPM\d+$/.test(r.id) || !r.title || !r.agency || !r.commodity || r.status !== "Open for Bidding" || typeof r.awarded !== "boolean") throw new Error("Invalid listing");
  if (url.origin !== "https://app.az.gov" || !/^\/page.aspx\/en\/bpm\/process_manage_extranet\/\d+$/.test(url.pathname)) throw new Error("Invalid source link");
  // The portal explicitly labels dates UTC-7; Arizona does not change to DST.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(r.due);
  if (!m) throw new Error("Invalid deadline format");
  const expected = Date.UTC(+m[3], +m[1] - 1, +m[2], (+m[4] % 12) + (m[7] === "PM" ? 12 : 0) + 7, +m[5], +m[6]);
  if (!r.due_iso.endsWith("-07:00") || Date.parse(r.due_iso) !== expected) throw new Error("Deadline timezone validation failed");
}
const eligible = records.filter(r => !r.awarded && Date.parse(r.due_iso) > Date.now());
const rows: RawBid[] = eligible.map(r => ({
  external_id: "az-app:" + r.id,
  title: r.title, agency: r.agency, description: "Commodity: " + r.commodity,
  location: "Arizona", category: mapCategory("", r.title, r.commodity),
  due_date: r.due_iso, estimated_value: "", source_url: r.url,
  solicitation_number: r.id, source_label: "az_app",
}));
console.log(JSON.stringify({validated: records.length, eligible: rows.length, excluded: records.length - rows.length}));
if (process.argv.includes("--apply")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = neon(process.env.DATABASE_URL);
  const existing = await sql`SELECT id, solicitation_number, agency, source_url, title FROM bids WHERE normalized_state = 'AZ'`;
  const norm = (s: string) => String(s ?? "").trim().toLowerCase();
  const match = (r: RawBid) => existing.find(e => e.source_url === r.source_url || (norm(e.agency) === norm(r.agency) && (norm(e.solicitation_number) === norm(r.solicitation_number!) || norm(e.title) === norm(r.title))));
  const canonical = dedupeBatchByNaturalKey(rows);
  const candidates = canonical.filter(r => !match(r));
  const result = await syncSource(sql, {name: "az_app", fetchFn: async () => candidates});
  if (result.failed || result.errors.length) throw new Error("Arizona import failed");
  const stored = await sql`SELECT id, solicitation_number, agency, source_url, title, source, normalized_state, source_jurisdiction, due_date FROM bids WHERE normalized_state = 'AZ'`;
  const verified = canonical.filter(r => stored.some(e => (e.source_url === r.source_url || e.id === match(r)?.id) && e.normalized_state === "AZ"));
  if (verified.length !== canonical.length) throw new Error("Stored identity verification failed");
  for (const r of canonical) {
    const e = stored.find(e => e.source_url === r.source_url || e.id === match(r)?.id);
    if (!e || (e.source === "az_app" && e.source_jurisdiction !== "AZ") || Date.parse(e.due_date) !== Date.parse(r.due_date!)) throw new Error("Stored provenance/deadline verification failed");
  }
  console.log(JSON.stringify({newlyInserted: result.new, existingIdentityMatches: rows.length - candidates.length, verified: verified.length, result}));
}
