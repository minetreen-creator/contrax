/**
 * One-time idempotent NAICS backfill for existing bids that arrived without a
 * NAICS code.
 *
 * `bids.naics_code` is authoritative only for SAM.gov-family sources. Every
 * other source (state keyword, cities, city open-data portals) stored NULL.
 * This script tags those existing rows with a conservative, high-precision
 * inferred NAICS from title + description — filling NULLs only, never
 * overwriting an authoritative code (WHERE naics_code IS NULL).
 *
 * Idempotent: re-running is a safe no-op because it only ever targets rows
 * whose naics_code is still NULL (populated rows are skipped) and it sets
 * naics_code_source = 'inferred' on the rows it fills. You can stop it
 * mid-run and restart — it simply continues over whatever is still NULL.
 *
 * Usage:
 *   bun run backfill-naics            (needs DATABASE_URL)
 *
 * The same inference already runs at INGEST time in src/jobs/runner.ts, so
 * this is only needed once for the pre-existing rows.
 */
import { neon } from "@neondatabase/serverless";
import { inferNaics } from "../lib/naics-infer";


/** Rows per multi-row UPDATE (2 cols + id × 250 = 750 params — well under limit). */
const BATCH_SIZE = 250;

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sql = neon(DATABASE_URL);

  // Column safety: the sync job creates these, but keep the backfill tolerant
  // of databases that predate them (same pattern as /awards and runner.ts).
  try { await sql`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`; } catch (e) { console.error("ensure naics_code:", (e as Error).message); }
  try { await sql`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code_source TEXT`; } catch (e) { console.error("ensure naics_code_source:", (e as Error).message); }

  const rows = (await sql`
    SELECT id, title, description FROM bids
    WHERE naics_code IS NULL
      AND (COALESCE(title,'') <> '' OR COALESCE(description,'') <> '')
  `) as { id: number; title: string | null; description: string | null }[];

  console.log(`📋 Scanning ${rows.length} rows with NULL naics_code...`);

  let filled = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const params: unknown[] = [];
    const updates: { code: string; id: number }[] = [];
    for (const r of chunk) {
      const code = inferNaics(r.title, r.description);
      if (code) {
        updates.push({ code, id: Number(r.id) });
      }
    }
    skipped += chunk.length - updates.length;
    for (const u of updates) params.push(u.code, u.id);
    if (updates.length === 0) continue;

    // Hand-built $N placeholders (the Neon driver rejects multi-row fragment
    // calls). Only ever fills NULL (the SELECT guard) — never overwrites.
    const valueRows = updates
      .map((_, j) => `($${j * 2 + 1}::text, $${j * 2 + 2}::int)`)
      .join(", ");
    const res = (await sql.query(
      `UPDATE bids b SET
         naics_code = v.code,
         naics_code_source = 'inferred'
       FROM (VALUES ${valueRows}) AS v(code, id)
       WHERE b.id = v.id AND b.naics_code IS NULL
       RETURNING b.id`,
      params,
    )) as unknown[];
    const n = Array.isArray(res) ? res.length : 0;
    filled += n;
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: ${n} filled`);
  }

  console.log(`\n✅ Backfill complete: ${filled} rows tagged, ${skipped} left NULL (unclassifiable).`);
  const totals = (await sql`
    SELECT COUNT(*) FILTER (WHERE naics_code IS NULL) null_naics,
           COUNT(*) FILTER (WHERE naics_code IS NOT NULL) has_naics,
           COUNT(*) FILTER (WHERE naics_code_source = 'inferred') inferred
    FROM bids
  `) as unknown[];
  console.log("Post-backfill:", JSON.stringify(totals));
  process.exit(0);
}

main().catch((e) => {
  console.error("💥 Backfill failed:", e);
  process.exit(1);
});
