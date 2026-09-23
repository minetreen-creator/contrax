/**
 * Migration 046 — Nonprofit Free phase 2 (append-only reviews, EIN release, digest
 * columns).
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-046.ts
 *
 * IDEMPOTENT BY CONSTRUCTION: the DDL is not duplicated here — this runner reads
 * db/migrations/046_nonprofit_reviews.sql (the record) and executes its statements one
 * by one via the shared splitter, so the file that is reviewed is the file that runs.
 * Every statement in it is `IF NOT EXISTS` / additive (plus the documented, index-only
 * DROP + CREATE of the EIN unique index), which is what makes a second invocation a
 * no-op.
 *
 * WHAT IT CREATES:
 *   1. nonprofit_application_reviews — the append-only admin audit trail (owner
 *      appendix decision 3), shaped for
 *      approve|deny|request_info|suspend|release|transfer (`request_info` was added in
 *      place by unit B — lead ruling (i); `transfer` stays schema-ready, lead ruling (ii)).
 *   2. nonprofit_applications.released_at — the owner's EIN-release column; the EIN
 *      unique index becomes PARTIAL (WHERE released_at IS NULL) so a released EIN is
 *      claimable by a different applicant while an attached EIN still allows exactly
 *      one free org account. Same index name as 045 (see the .sql header).
 *   3. digest_opt_out_at / digest_unsubscribe_token_hash / digest_last_sent_at — the
 *      weekly digest columns (build plan §5), declared with the rest of phase 2's DDL.
 *
 * SAFE ORDERING NOTE (sandbox DATABASE_URL IS production): no statement alters or drops
 * a row, and the one destructive-looking pair (DROP INDEX / CREATE INDEX) only touches
 * an index on the nonprofit_applications table, which is empty in production. It is
 * still a deliberate act — do not run it as part of this delegation; it ships at the
 * phase merge.
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
  console.error("[run-046] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);

// Loud target banner. The host alone — never the credentials — so the operator can see
// WHICH database is about to receive the review table, the release column and the index
// swap before it happens.
try {
  console.warn(`[run-046] target database host: ${new URL(url).hostname} — additive DDL + one index swap`);
} catch {
  console.warn("[run-046] target database host: (unparseable DATABASE_URL)");
}

const file = new URL("./046_nonprofit_reviews.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8"));
console.log(`[run-046] ${statements.length} statements from 046_nonprofit_reviews.sql`);

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
       WHERE table_schema = 'public' AND table_name = 'nonprofit_application_reviews') AS reviews_table,
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'nonprofit_application_reviews'
         AND column_name IN ('id', 'application_id', 'action', 'actor_user_id', 'actor_email',
             'reason_code', 'internal_note', 'prior_status', 'new_status', 'created_at')) AS reviews_columns,
    (SELECT count(*)::int FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'nonprofit_applications'
         AND column_name IN ('released_at', 'digest_opt_out_at',
             'digest_unsubscribe_token_hash', 'digest_last_sent_at')) AS new_columns,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'idx_nonprofit_application_reviews_application') AS reviews_index,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'nonprofit_applications_user_id_key') AS user_key,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'nonprofit_applications_ein_key'
         AND indexdef ILIKE '%WHERE%released_at IS NULL%') AS ein_key_partial,
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'nonprofit_applications_ein_key'
         AND indexdef NOT ILIKE '%WHERE%') AS ein_key_unconditional
`) as {
  reviews_table: number;
  reviews_columns: number;
  new_columns: number;
  reviews_index: number;
  user_key: number;
  ein_key_partial: number;
  ein_key_unconditional: number;
}[];
console.log("[run-046] verify", JSON.stringify(shape[0] ?? {}));
const expected = {
  reviews_table: 1,
  reviews_columns: 10,
  new_columns: 4,
  reviews_index: 1,
  user_key: 1,
  ein_key_partial: 1,
  ein_key_unconditional: 0,
};
const mismatched = (Object.keys(expected) as (keyof typeof expected)[]).filter(
  (key) => Number(shape[0]?.[key] ?? -1) !== expected[key],
);
if (failed > 0) {
  console.error(`[run-046] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (mismatched.length > 0) {
  console.error(`[run-046] FAIL: the database shape does not match migration 046 (${mismatched.join(", ")})`);
  process.exitCode = 1;
} else {
  console.log("[run-046] complete");
}
