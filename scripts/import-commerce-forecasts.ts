import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const data = JSON.parse(await readFile(new URL("../data/commerce-forecasts-2026-09-30.json", import.meta.url), "utf8"));
const records = data.records;
if (records.length !== 443 || new Set(records.map((r: any) => String(r["Forecast ID"]))).size !== 443) throw new Error("Forecast count or identity validation failed");
for (const r of records) {
  if (!r.Title || !r.Description || Number(r["Estimated Solicitation Fiscal Year"]) < 2027 || r.contrax_record_type !== "procurement_forecast") throw new Error("Invalid forecast");
}
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({validated: records.length, databaseWrites: 0}));
} else {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = neon(process.env.DATABASE_URL);
  await sql`CREATE TABLE IF NOT EXISTS procurement_forecasts (
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    fiscal_quarter TEXT,
    payload JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, external_id)
  )`;
  const before = await sql`SELECT external_id FROM procurement_forecasts WHERE source = 'commerce_faaps'`;
  const existing = new Set(before.map((r: any) => r.external_id));
  // Each statement is an idempotent upsert. No bid records or notifications are changed.
  for (const r of records) {
    await sql`INSERT INTO procurement_forecasts (source, external_id, title, description, fiscal_year, fiscal_quarter, payload)
      VALUES ('commerce_faaps', ${String(r["Forecast ID"])}, ${r.Title}, ${r.Description}, ${Number(r["Estimated Solicitation Fiscal Year"])}, ${r["Estimated Solicitation Fiscal Quarter"]}, ${JSON.stringify(r)}::jsonb)
      ON CONFLICT (source, external_id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
        fiscal_year=EXCLUDED.fiscal_year, fiscal_quarter=EXCLUDED.fiscal_quarter, payload=EXCLUDED.payload`;
  }
  const saved = await sql`SELECT external_id FROM procurement_forecasts WHERE source = 'commerce_faaps'`;
  const ids = new Set(saved.map((r: any) => r.external_id));
  const verified = records.filter((r: any) => ids.has(String(r["Forecast ID"]))).length;
  if (verified !== 443) throw new Error("Saved count verification failed");
  console.log(JSON.stringify({verified, newlyInserted: records.filter((r: any) => !existing.has(String(r["Forecast ID"]))).length, source: "commerce_faaps", recordType: "forecast", openBidsAdded: 0}));
}
