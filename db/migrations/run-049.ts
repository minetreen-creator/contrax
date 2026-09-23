/**
 * Migration 049 — collector_staleness must reflect REALITY (owner-locked
 * nationwide correctness FIX ②, 2026-09-23).
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-049.ts
 *
 * IDEMPOTENT BY CONSTRUCTION: the DDL is not duplicated here — this runner reads
 * db/migrations/049_collector_staleness_honest_tiers.sql (the reviewed record)
 * and executes its statements one by one through the shared splitter, so the file
 * that is reviewed is the file that runs. `CREATE OR REPLACE VIEW` makes a second
 * invocation a no-op.
 *
 * ADDITIVE-ONLY: one view definition. No table, no column and no row of `bids` is
 * touched, and this migration writes nothing. It replaces a *derived* view whose
 * tier ignored the run's outcome, so a DEAD source (`nys_socrata`: 43 consecutive
 * zero-fetch runs while both of its datasets answered HTTP 404) could be read as
 * FRESH.
 *
 * ORDER: unlike migrations 047/048 this has no code-order constraint — the new
 * definition only reads columns `collector_run_log` already has (run-039), so it
 * is safe to apply before or after the code that prints the same tiers.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it
 * exists to be run BY HAND, once, after the lead approves the PR. It prints the
 * target host before its first statement for exactly that reason: in the sandbox
 * the DATABASE_URL in the environment IS production.
 *
 * PRE-FLIGHT + POST-FLIGHT (read-only, inside this runner): the tier of every
 * source BEFORE and AFTER, with `nys_socrata` named — the same run that applies
 * the fix also records what it changed.
 *
 * ROLLBACK: re-run the view statement inside db/migrations/run-039.ts
 * (data-preserving; no writes).
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-049] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(`[run-049] target database host: ${new URL(url).hostname} — view DDL only, no writes`);
} catch {
  console.warn("[run-049] target database host: (unparseable DATABASE_URL)");
}

interface TierRow {
  source: string;
  tier: string;
  last_run_at: string | null;
  rows_fetched: string | null;
  ran_zero: boolean | null;
  errors?: string | null;
}

function show(rows: TierRow[], label: string): void {
  console.log(`[run-049] ${label} — ${rows.length} source(s) in collector_staleness:`);
  for (const row of rows) {
    const flag = row.source === "nys_socrata" ? "   <-- the dead source this fix is about" : "";
    const errors = row.errors === undefined ? "" : `, errors ${row.errors ?? "-"}`;
    console.log(
      `[run-049]   ${row.source}: ${row.tier} (last run ${row.last_run_at ?? "never"}, rows_fetched ${row.rows_fetched ?? "-"}, ran_zero ${row.ran_zero ?? "-"}${errors})${flag}`,
    );
  }
}

// ---------------------------------------------------------------------------
// BEFORE — the tier each source has TODAY (the pre-049 definition).
// ---------------------------------------------------------------------------
const before = (await sql`
  SELECT source, tier, last_run_at, rows_fetched, ran_zero
  FROM collector_staleness
  ORDER BY tier, source
`) as TierRow[];
show(before, "BEFORE");

// ---------------------------------------------------------------------------
// APPLY — the reviewed view definition, statement by statement.
// ---------------------------------------------------------------------------
const file = new URL("./049_collector_staleness_honest_tiers.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter((s) => s.trim().length > 0);
console.log(`[run-049] ${statements.length} statement(s) from 049_collector_staleness_honest_tiers.sql`);
let failed = 0;
for (const statement of statements) {
  const label = statement.split("\n")[0]!.slice(0, 90);
  try {
    await sql`${sql.unsafe(statement)}`;
    console.log(`ok   ${label}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// AFTER — the same table under the new definition + shape verification.
// ---------------------------------------------------------------------------
const after = (await sql`
  SELECT source, tier, last_run_at, rows_fetched, ran_zero, errors
  FROM collector_staleness
  ORDER BY tier, source
`) as TierRow[];
show(after, "AFTER");

const tierChanges = after.filter((a) => {
  const b = before.find((x) => x.source === a.source);
  return !b || b.tier !== a.tier;
});
console.log(
  `[run-049] tier changes: ${tierChanges.length} source(s)` +
    (tierChanges.length ? " — " + tierChanges.map((t) => `${t.source}->${t.tier}`).join(", ") : ""),
);
const nys = after.find((a) => a.source === "nys_socrata");
const shape = (await sql`
  SELECT (SELECT count(*)::int FROM information_schema.columns
            WHERE table_name = 'collector_staleness' AND column_name = 'errors') AS errors_column,
         (SELECT count(*)::int FROM collector_staleness) AS sources
`) as { errors_column: number; sources: number }[];
console.log("[run-049] verify", JSON.stringify(shape[0] ?? {}));

if (failed > 0) {
  console.error(`[run-049] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (Number(shape[0]?.errors_column ?? 0) !== 1) {
  console.error("[run-049] FAIL: the database shape does not match migration 049 (missing `errors` column)");
  process.exitCode = 1;
} else if (nys && nys.tier === "FRESH") {
  console.error("[run-049] FAIL: nys_socrata still reads FRESH after the fix — investigate before shipping.");
  process.exitCode = 1;
} else {
  console.log(
    `[run-049] OK — collector_staleness now derives its tier from the latest run's outcome (nys_socrata: ${nys?.tier ?? "absent"})`,
  );
}
