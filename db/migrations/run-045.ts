/**
 * Migration 045 — Nonprofit Free data foundation (owner green-lit 2026-09-21).
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-045.ts
 *
 * IDEMPOTENT BY CONSTRUCTION: the DDL is not duplicated here — this runner reads
 * db/migrations/045_nonprofit_free.sql (the record) and executes its statements one
 * by one via the shared splitter, so the file that is reviewed is the file that runs.
 * Every statement in it is `IF NOT EXISTS` / additive, which is what makes a second
 * invocation a no-op.
 *
 * WHAT IT CREATES (five tables, all additive — nothing existing is altered):
 *   1. nonprofit_applications — one application per user (UNIQUE) AND one per EIN
 *      (UNIQUE `ein`: "one free org account per EIN"), the owner's signup fields + the
 *      audit/evidence columns every verification decision must carry.
 *   2. irs_eo_bmf / irs_pub78 / irs_revocations — the LOCAL IRS mirror the verification
 *      decision reads (never a live irs.gov call per request).
 *   3. irs_mirror_runs — the mirror refresh log that supplies the "IRS records as of
 *      <posting date>" label.
 *   4. saved_grants — the free tier's "save up to 10 grants", UNIQUE (user_id, opportunity_id).
 *
 * SAFE ORDERING NOTE (sandbox DATABASE_URL IS production): every statement is additive,
 * so running this against production cannot drop or rewrite a row of any existing table.
 * It is still a deliberate act — see the phase-1 report for the run plan.
 *
 * DELIBERATE-ONLY GUARD: this runner is never invoked by any test, CI job or scheduled
 * task — it exists to be run BY HAND, once. It prints the host it is about to write to
 * before its first statement for exactly that reason: in the sandbox the DATABASE_URL in
 * the environment IS production. Do not wire this file into a test or a workflow.
 *
 * Mirrored in src/db/schema.sql (the canonical merged schema; the state-grants bootstrap
 * test builds a database from schema.sql ALONE, so the mirror must be complete).
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-045] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);

// Loud target banner. The host alone — never the credentials — so the operator can see
// WHICH database is about to receive 6 new tables before it happens.
try {
  console.warn(`[run-045] target database host: ${new URL(url).hostname} — additive DDL only`);
} catch {
  console.warn("[run-045] target database host: (unparseable DATABASE_URL)");
}

const file = new URL("./045_nonprofit_free.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8"));
console.log(`[run-045] ${statements.length} statements from 045_nonprofit_free.sql`);

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
       WHERE table_schema = 'public'
         AND table_name IN ('nonprofit_applications', 'irs_eo_bmf', 'irs_pub78',
                            'irs_revocations', 'irs_mirror_runs', 'saved_grants')) AS tables,
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'nonprofit_applications'
         AND column_name IN ('submitted_name_normalized', 'matched_bmf_name', 'bmf_status',
             'bmf_posting_date', 'pub78', 'on_revocation_list', 'revocation_posting_date',
             'evidence', 'reviewed_by', 'reviewed_at', 'review_notes', 'granted_at',
             'reverify_due_at', 'decision', 'decision_flags', 'reason_class',
             'supporting_docs_requested')) AS audit_columns,
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'nonprofit_applications'
         AND column_name = 'ein' AND data_type = 'character') AS ein_is_text,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'nonprofit_applications_user_id_key') AS user_key,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'nonprofit_applications_ein_key') AS ein_key,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'saved_grants_user_opportunity_key') AS save_key
`) as {
  tables: number;
  audit_columns: number;
  ein_is_text: number;
  user_key: number;
  ein_key: number;
  save_key: number;
}[];
console.log("[run-045] verify", JSON.stringify(shape[0] ?? {}));
if (failed > 0) {
  console.error(`[run-045] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (
  Number(shape[0]?.tables ?? 0) !== 6 ||
  Number(shape[0]?.audit_columns ?? 0) !== 17 ||
  Number(shape[0]?.ein_is_text ?? 0) !== 1 ||
  Number(shape[0]?.user_key ?? 0) !== 1 ||
  Number(shape[0]?.ein_key ?? 0) !== 1 ||
  Number(shape[0]?.save_key ?? 0) !== 1
) {
  console.error("[run-045] FAIL: the database shape does not match migration 045");
  process.exitCode = 1;
} else {
  console.log("[run-045] complete");
}
