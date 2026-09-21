/**
 * Migration 047 — bids: psc + notice_type + solicitation_number
 * (owner PRIORITY 09-21, R2).
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-047.ts
 *
 * IDEMPOTENT BY CONSTRUCTION: the DDL is not duplicated here — this runner reads
 * db/migrations/047_bids_psc_notice_type_solicitation.sql (the record) and
 * executes its statements one by one via the shared splitter, so the file that is
 * reviewed is the file that runs. Every statement is `ADD COLUMN IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS`, which is what makes a second invocation a no-op.
 *
 * ADDITIVE-ONLY: three nullable text columns + one partial index. No default, no
 * backfill, no rewrite of an existing column — nothing on the read path can
 * regress, and no row is touched.
 *
 * DELIBERATE-ONLY GUARD: this runner is never invoked by a test, CI job or
 * scheduled task — it exists to be run BY HAND, once, after the owner approves
 * the PR. It prints the target host before its first statement for exactly that
 * reason: in the sandbox the DATABASE_URL in the environment IS production.
 *
 * Mirrored in src/db/schema.sql (the canonical merged schema; the state-grants
 * bootstrap test builds a database from schema.sql ALONE, so the mirror must be
 * complete).
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-047] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(`[run-047] target database host: ${new URL(url).hostname} — additive DDL only`);
} catch {
  console.warn("[run-047] target database host: (unparseable DATABASE_URL)");
}
const file = new URL("./047_bids_psc_notice_type_solicitation.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8"));
console.log(`[run-047] ${statements.length} statements from 047_bids_psc_notice_type_solicitation.sql`);
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
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'bids'
         AND column_name IN ('psc', 'notice_type', 'solicitation_number')) AS new_columns,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'idx_bids_solicitation_number') AS new_index
`) as { new_columns: number; new_index: number }[];
console.log("[run-047] verify", JSON.stringify(shape[0] ?? {}));
if (failed > 0) {
  console.error(`[run-047] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (Number(shape[0]?.new_columns ?? 0) !== 3 || Number(shape[0]?.new_index ?? 0) !== 1) {
  console.error("[run-047] FAIL: the database shape does not match migration 047");
  process.exitCode = 1;
} else {
  console.log("[run-047] OK — bids now carries psc / notice_type / solicitation_number");
}
