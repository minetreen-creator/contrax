/**
 * Georgia DOT planned lettings → the Upcoming forecasts page (owner 2026-11-08: "Add as 'Upcoming'").
 *
 * Runs the headless collector (.github/scripts/gdot-letting-fetch.mjs, path in
 * GDOT_LETTING_FETCH_SCRIPT), parses GDOT's "Project Letting by Month" forecast
 * (sources/gdot-letting.ts), and replaces the `ga_gdot_lettings` rows in procurement_forecasts with
 * what GDOT shows today: new and changed projects are upserted, projects GDOT no longer lists are
 * removed. Nothing touches the bids table: these are forecasts, not open bids.
 *
 * A read that fails any of the parser's checks writes nothing and exits non-zero (the workflow step
 * is continue-on-error, so the bid sync is never held up by it).
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sql } from "~/db";
import { GDOT_LETTING_SOURCE, gdotForecastRecord, parseGdotLetting } from "./sources/gdot-letting";

/** Fewer than this many projects across six months means the read is wrong, not that GDOT stopped building. */
const MIN_PROJECTS = 40;

async function main() {
  const script = process.env.GDOT_LETTING_FETCH_SCRIPT || join(process.cwd(), ".github/scripts/gdot-letting-fetch.mjs");
  const dir = mkdtempSync(join(tmpdir(), "gdot-"));
  const out = join(dir, "letting.json");
  try {
    await promisify(execFile)("node", [script], { timeout: 200_000, maxBuffer: 1_000_000, env: { ...process.env, GDOT_OUT: out } });
    const { capturedAt, html } = JSON.parse(readFileSync(out, "utf8")) as { capturedAt: string; html: string };
    const parsed = parseGdotLetting(html, capturedAt);
    if (parsed.projects.length < MIN_PROJECTS) throw new Error(`Only ${parsed.projects.length} projects read; refusing to replace the forecast`);
    const records = parsed.projects.map((p) => gdotForecastRecord(p, parsed.processedOn));
    const s = sql();
    await s`CREATE TABLE IF NOT EXISTS procurement_forecasts (
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
    for (const r of records) {
      await s`INSERT INTO procurement_forecasts (source, external_id, title, description, fiscal_year, fiscal_quarter, payload)
        VALUES (${r.source}, ${r.external_id}, ${r.title}, ${r.description}, ${r.fiscal_year}, ${r.fiscal_quarter}, ${JSON.stringify(r.payload)}::jsonb)
        ON CONFLICT (source, external_id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
          fiscal_year = EXCLUDED.fiscal_year, fiscal_quarter = EXCLUDED.fiscal_quarter, payload = EXCLUDED.payload, imported_at = NOW()`;
    }
    const ids = records.map((r) => r.external_id);
    const removed = (await s`DELETE FROM procurement_forecasts WHERE source = ${GDOT_LETTING_SOURCE} AND NOT (external_id = ANY(${ids})) RETURNING external_id`) as unknown[];
    console.log(
      `GDOT planned lettings: ${records.length} projects stored, ${removed.length} no longer listed removed (processed ${parsed.processedOn}; ` +
        parsed.months.map((m) => `${m.letLabel} ${m.projects} / $${m.total.toLocaleString("en-US")}`).join(", ") + ")",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`GDOT planned lettings: ${(error as Error).message}`);
  process.exit(1);
});
