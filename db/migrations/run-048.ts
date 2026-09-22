/**
 * Migration 048 — bids: the natural key becomes a UNIQUE index (owner 2026-09-22,
 * run-level dedupe hardening for the concurrent Phase-2 sources).
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-048.ts
 *
 * IDEMPOTENT BY CONSTRUCTION: the DDL is not duplicated here — this runner reads
 * db/migrations/048_bids_natural_key_unique.sql (the record) and executes its
 * statements one by one via the shared splitter, so the file that is reviewed is
 * the file that runs. The single statement is `CREATE UNIQUE INDEX IF NOT EXISTS`,
 * which is what makes a second invocation a no-op.
 *
 * ADDITIVE-ONLY: one partial unique index. No column, no default, no backfill, no
 * row is touched, and the read path cannot regress. The index enforces the
 * natural key only for rows inserted from the frozen cutoff (2026-09-22) forward,
 * because 4,059 pre-existing duplicate groups / 14,690 rows under that key are
 * grandfathered on purpose (deleting them is a separate, owner-gated
 * reconciliation — NOT part of this migration).
 *
 * PRE-FLIGHT GATE (read-only, INSIDE this runner): duplicate groups among rows
 * created at/after the cutoff must be 0 before the index is attempted at all.
 * `CREATE UNIQUE INDEX` aborts and leaves nothing behind if they are not, but a
 * dirty window means the cutoff is stale, which is an owner decision (bump the
 * literal in a NEW migration) — so this runner aborts with exit 1 instead of
 * guessing.
 *
 * DELIBERATE-ONLY GUARD: this runner is never invoked by a test, CI job or
 * scheduled task — it exists to be run BY HAND, once, after the owner approves
 * the PR. It prints the target host before its first statement for exactly that
 * reason: in the sandbox the DATABASE_URL in the environment IS production.
 *
 * ORDER (design §5.1): apply this DDL BEFORE the runner code change ships. The
 * index is harmless to code that does not know about it; the code change
 * (classifying a 23505 on this index as *deduped*, not *failed*) is only complete
 * once the index exists, so index and code ship in that order.
 *
 * ROLLBACK (design §5.3): `DROP INDEX IF EXISTS idx_bids_natural_key_unique;` —
 * data-preserving, no writes; the guard and the in-memory dedupe keep working.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-048] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(`[run-048] target database host: ${new URL(url).hostname} — additive DDL only`);
} catch {
  console.warn("[run-048] target database host: (unparseable DATABASE_URL)");
}

// ---------------------------------------------------------------------------
// PRE-FLIGHT (read-only) — the same query as
// shared/dedupe-run-level-design-2026-09-22/preflight-query.sql.
// Never attempt the build on a dirty window.
// ---------------------------------------------------------------------------
const preflight = (await sql`
  WITH d AS (
    SELECT 1
    FROM bids
    WHERE created_at >= TIMESTAMPTZ '2026-09-22 00:00:00+00'
    GROUP BY lower(btrim(title)), lower(btrim(agency)), COALESCE(notice_type, ''),
             due_date, COALESCE(psc, '')
    HAVING count(*) > 1
  )
  SELECT (SELECT count(*)::int FROM d) AS zero_dup_groups,
         (SELECT count(*)::int FROM bids
            WHERE created_at >= TIMESTAMPTZ '2026-09-22 00:00:00+00') AS rows_after_cutoff,
         (SELECT max(id)::int FROM bids) AS max_id,
         (SELECT max(created_at) FROM bids) AS max_created_at
`) as {
  zero_dup_groups: number;
  rows_after_cutoff: number;
  max_id: number | null;
  max_created_at: string | null;
}[];
console.log("[run-048] pre-flight", JSON.stringify(preflight[0] ?? {}));
if (Number(preflight[0]?.zero_dup_groups ?? -1) !== 0) {
  console.error(
    "[run-048] FAIL: duplicate natural-key groups exist among rows created at/after the frozen cutoff" +
      " — the cutoff is stale. Do NOT build the index; this is an owner decision (new migration, new literal).",
  );
  process.exit(1);
}

const file = new URL("./048_bids_natural_key_unique.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8"));
console.log(`[run-048] ${statements.length} statements from 048_bids_natural_key_unique.sql`);
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

// Verify the shape we just asked for, rather than trusting the log above:
// the index must EXIST and be VALID (guards against a half-built/invalid index).
const shape = (await sql`
  SELECT
    (SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'idx_bids_natural_key_unique') AS new_index,
    (SELECT count(*)::int FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'idx_bids_natural_key_unique'
         AND i.indisvalid) AS valid_index,
    (SELECT count(*)::int FROM bids) AS bids_rows
`) as { new_index: number; valid_index: number; bids_rows: number }[];
console.log("[run-048] verify", JSON.stringify(shape[0] ?? {}));
if (failed > 0) {
  console.error(`[run-048] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (Number(shape[0]?.new_index ?? 0) !== 1 || Number(shape[0]?.valid_index ?? 0) !== 1) {
  console.error("[run-048] FAIL: the database shape does not match migration 048 (missing or invalid index)");
  process.exitCode = 1;
} else {
  console.log("[run-048] OK — bids now carries a valid, grandfathered UNIQUE natural-key index");
}
