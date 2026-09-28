/**
 * Migration 053 — NONPROFIT SIGNUP-SOURCE MARKER schema delta (owner-directed 2026-09-28).
 * The reviewed record is db/migrations/053_signup_source.sql — this runner executes ITS
 * statements, one by one, through the shared splitter, so the file that is reviewed is the
 * file that runs.
 *
 *   bun run db/migrations/run-053.ts        (DATABASE_URL must be set)
 *
 * ADDITIVE-ONLY, and the runner proves it: BEFORE and AFTER it counts every table in the
 * database plus the row counts of the touched surfaces (users / bids / saved_matches /
 * nonprofit_applications / state_grant_* / the four subcontract tables). ONE column is
 * added to users (`signup_source`) and NOTHING else may change — the AFTER block fails the
 * run if any table's row count moved, if the public table count moved, or if the column is
 * not present with the right shape.
 *
 * IDEMPOTENT BY CONSTRUCTION: every statement is `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
 * so a second invocation re-writes nothing. Running it twice on purpose is the proof (the
 * second run's BEFORE already shows the column, and nothing moves).
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it exists to
 * be run BY HAND, once, by the operator/lead. It prints the target host before its first
 * statement for exactly that reason: in this sandbox the DATABASE_URL in the environment
 * IS production.
 *
 * ROLLBACK: ALTER TABLE users DROP COLUMN signup_source; — the column is new, no row
 * depends on it, and every pre-existing account legitimately keeps NULL.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-053] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-053] target database host: ${new URL(url).hostname} — 1 column added to users, no data rows written`,
  );
} catch {
  console.warn("[run-053] target database host: (unparseable DATABASE_URL)");
}
/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = [
  "users",
  "bids",
  "saved_matches",
  "nonprofit_applications",
  "state_grant_opportunities",
  "state_grant_sources",
  "subcontract_opportunities",
  "subcontract_sources",
  "subcontract_primes",
  "subcontract_sync_runs",
] as const;
/**
 * The column this migration adds to users, with the shape it must have.
 *
 * `signup_source` is NULLABLE with NO default: a pre-existing account genuinely has no
 * recorded source (the param did not exist), so NULL is the truthful value and there is no
 * backfill. That is also why the run must NOT move a single row.
 */
const NEW_COLUMNS: Record<string, { type: string; nullable: boolean }> = {
  signup_source: { type: "text", nullable: true },
};
async function snapshot(): Promise<{
  tables: number;
  counts: Record<string, number | null>;
}> {
  const tables = (await sql`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
  `) as { n: number }[];
  const counts: Record<string, number | null> = {};
  for (const table of COUNTED_TABLES) {
    try {
      const rows = (await sql.query(`SELECT count(*)::int AS n FROM ${table}`)) as {
        n: number;
      }[];
      counts[table] = Number(rows[0]?.n ?? 0);
    } catch {
      counts[table] = null; // the table does not exist
    }
  }
  return { tables: Number(tables[0]?.n ?? 0), counts };
}
async function columnTypes(): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
  `) as { column_name: string; data_type: string; is_nullable: string }[];
  return new Map(rows.map((r) => [r.column_name, `${r.data_type}:${r.is_nullable}`]));
}
const before = await snapshot();
console.log(`[run-053] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-053]   ${table}: ${value === null ? "(absent)" : value}`);
}
const beforeColumns = await columnTypes();
const file = new URL("./053_signup_source.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter(
  (s) => s.trim().length > 0,
);
// Pre-flight: the target table must exist (053 is a delta on the users table the bootstrap
// creates). A database that never built users must fail LOUDLY here rather than silently
// writing nothing.
if (!beforeColumns.has("id") || !beforeColumns.has("email") || !beforeColumns.has("plan_tier")) {
  console.error(
    "[run-053] FAIL: the users table does not exist (or lacks id/email/plan_tier) — the base schema must be applied first",
  );
  process.exit(1);
}
console.log(
  `[run-053] BEFORE users columns already carrying this migration: ${
    Object.keys(NEW_COLUMNS).filter((c) => beforeColumns.has(c)).join(", ") || "(none — first run)"
  }`,
);
console.log(`[run-053] ${statements.length} statement(s) from 053_signup_source.sql`);
let failed = 0;
for (const statement of statements) {
  const label = statement.split("\n")[0]!.slice(0, 100).replace(/\s+/g, " ");
  try {
    await sql`${sql.unsafe(statement)}`;
    console.log(`ok   ${label}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
  }
}
const after = await snapshot();
const afterColumns = await columnTypes();
console.log(`[run-053] AFTER: ${after.tables} public table(s)`);
const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-053]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
}
const shapeProblems: string[] = [];
for (const [column, expected] of Object.entries(NEW_COLUMNS)) {
  const type = afterColumns.get(column);
  if (!type) {
    shapeProblems.push(`${column} MISSING`);
    continue;
  }
  if (!type.startsWith(`${expected.type}:`)) {
    shapeProblems.push(`${column} is ${type}, expected ${expected.type}`);
    continue;
  }
  const nullable = type.endsWith(":YES");
  if (nullable !== expected.nullable) {
    shapeProblems.push(
      `${column} is ${nullable ? "nullable" : "NOT NULL"} (${type}), expected ${expected.nullable ? "nullable" : "NOT NULL"}`,
    );
  }
}
console.log(
  `[run-053] verify ${JSON.stringify({
    publicTables: after.tables,
    addedColumns: Object.keys(NEW_COLUMNS),
    shapeProblems,
    rowCountsMoved: moved,
  })}`,
);
if (failed > 0) {
  console.error(`[run-053] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-053] FAIL: the database shape does not match migration 053");
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-053] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables) {
  console.error(
    `[run-053] FAIL: public table count went ${before.tables} -> ${after.tables} (expected no change)`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "[run-053] OK — 1/1 column present on users (signup_source TEXT NULLABLE), additive (no row count moved, no new table)",
  );
}
