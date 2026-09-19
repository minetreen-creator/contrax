/**
 * Migration 044 — State Grants R1 corrections (owner review 2026-09-19): the
 * source registry + (source_id, external_id) identity, the corrected status
 * taxonomy, `last_seen_at`, and the normalized opportunity columns.
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-044.ts
 *
 * IDEMPOTENT BY CONSTRUCTION: the DDL is not duplicated here — this runner reads
 * db/migrations/044_state_grants_sources.sql (the record) and executes its
 * statements one by one via the shared splitter, so the file that is reviewed is
 * the file that runs. Every statement in it is safe to re-run, which is what
 * makes a second invocation a no-op (proven in the R1 report: run twice against
 * the real database, identical schema, zero write churn).
 *
 * WHAT IT CHANGES (all additive; 043's tables are 0-row in production):
 *   1. state_grant_sources — new table, one row per official source, seeded with
 *      Virginia's source; opportunities gain source_id NOT NULL.
 *   2. UNIQUE (state_code, external_id) → UNIQUE (source_id, external_id):
 *      two agencies issuing the same external id are two rows, never an overwrite.
 *   3. status CHECK: open|forecast|closed → open|upcoming|rolling|closed|unverified
 *      (a pre-existing `forecast` row becomes `unverified`).
 *   4. last_seen_at + eligible_applicants / eligible_geography / categories /
 *      award_range / award_min_amount / award_max_amount / total_funding /
 *      matching_requirement.
 *   5. state_grant_registry: the ladder gains limited|curated|connected.
 *
 * Mirrored in src/db/schema.sql. Federal /grants is untouched.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-044] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);

const file = new URL("./044_state_grants_sources.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8"));
console.log(`[run-044] ${statements.length} statements from 044_state_grants_sources.sql`);

let failed = 0;
for (const statement of statements) {
  const label = statement.split("\n")[0].slice(0, 90);
  try {
    await sql`${sql.unsafe(statement)}`;
    console.log(`ok   ${label}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
  }
}

// Verify the shape we just asked for, rather than trusting the log above.
const shape = (await sql`
  SELECT
    (SELECT count(*)::int FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'state_grant_sources') AS sources_table,
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'state_grant_opportunities'
         AND column_name IN ('source_id', 'last_seen_at', 'eligible_applicants',
             'eligible_geography', 'categories', 'award_range', 'award_min_amount',
             'award_max_amount', 'total_funding', 'matching_requirement')) AS new_columns,
    (SELECT count(*)::int FROM state_grant_sources WHERE source_key = 'va-vtc-grants') AS va_source
`) as { sources_table: number; new_columns: number; va_source: number }[];
console.log("[run-044] verify", JSON.stringify(shape[0] ?? {}));
if (failed > 0) {
  console.error(`[run-044] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (
  Number(shape[0]?.sources_table ?? 0) !== 1 ||
  Number(shape[0]?.new_columns ?? 0) !== 10 ||
  Number(shape[0]?.va_source ?? 0) !== 1
) {
  console.error("[run-044] FAIL: the database shape does not match migration 044");
  process.exitCode = 1;
} else {
  console.log("[run-044] complete");
}
