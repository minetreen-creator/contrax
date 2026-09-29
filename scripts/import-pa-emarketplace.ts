/** bun run scripts/import-pa-emarketplace.ts <official-export.csv> [--apply]
 * Defaults to a dry run. Fresh exports are supplied manually until a supported feed is verified.
 */
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { reviewExport } from "../src/jobs/sources/pa-emarketplace-csv";
import { mapCategory } from "../src/lib/trade-classification";
import { syncSource } from "../src/jobs/runner";
import type { RawBid } from "../src/jobs/sources/sam-gov";

const file = process.argv[2];
if (!file || file.startsWith("--")) throw new Error("Provide an official eMarketplace CSV export path");
const report = reviewExport(await readFile(file, "utf8"));
console.log(JSON.stringify({ fetched: report.fetched, eligible: report.accepted.length, skipped: report.skipped }, null, 2));
const rows: RawBid[] = report.accepted.map(r => ({
  external_id: `pa-emarketplace:${encodeURIComponent(r.Agency.trim().toLowerCase())}:${encodeURIComponent(r["Bid No"].trim().toLowerCase())}`,
  title: r.Title.trim(), agency: r.Agency.trim(),
  // Treat source HTML as text. Never render imported HTML from an export.
  description: r.Description.replace(/<[^>]*>/g, " ").trim(),
  location: "Pennsylvania", category: mapCategory("", r.Title, r.Description),
  due_date: r.due_iso, estimated_value: "",
  // CSV does not contain the portal's internal SID. Do not invent a detail link.
  source_url: "https://www.emarketplace.state.pa.us/Search.aspx",
  solicitation_number: r["Bid No"].trim(), notice_type: r["Bid Type"].trim(),
  source_label: "pa_emarketplace",
}));
if (!process.argv.includes("--apply")) {
  console.log("Dry run only. No database writes. Eligible solicitation numbers:");
  console.log(rows.map(r => r.solicitation_number).join("\n"));
} else {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for --apply");
  const sql = neon(process.env.DATABASE_URL);
  // Report exact same-agency/solicitation matches before attempting an insert.
  const existing = await sql`SELECT solicitation_number, agency FROM bids WHERE normalized_state = 'PA' AND solicitation_number IS NOT NULL`;
  const keys = new Set(existing.map(r => `${String(r.agency).trim().toLowerCase()}|${String(r.solicitation_number).trim().toLowerCase()}`));
  const newRows = rows.filter(r => !keys.has(`${r.agency.toLowerCase()}|${r.solicitation_number!.toLowerCase()}`));
  console.log(`Existing identity matches: ${rows.length - newRows.length}; import candidates: ${newRows.length}`);
  const result = await syncSource(sql, { name: "pa_emarketplace", fetchFn: async () => newRows });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed || result.errors.length) process.exitCode = 1;
}
