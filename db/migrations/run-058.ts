/**
 * Migration 058 — TRACKED-BID SOURCE schema delta (owner-directed 2026-10-08, Virginia
 * drive dispatch C). The reviewed record is db/migrations/058_tracked_bids_source.sql —
 * this runner executes ITS statements, one by one, through the shared splitter, so the file
 * that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-058.ts        (DATABASE_URL must be set)
 *
 * NUMBERING NOTE: the delegation brief called this "run-054", written before #614/#615 and
 * against a map produced in a read-only era. 054–057 were already taken (054 = paid Contrax
 * Payments subscriptions, 055/056/057 later work), so the next FREE number is 058. Nothing
 * was overwritten.
 *
 * ADDITIVE-ONLY, and the runner proves it: BEFORE and AFTER it counts every table in the
 * database plus the row counts of the touched surfaces (users / bids / tracked_bids /
 * saved_matches / nonprofit_applications / state_grant_* / the four subcontract tables). ONE
 * column is added to tracked_bids (`source`) and NOTHING else may change — the AFTER block
 * fails the run if any table's row count moved, if the public table count moved, or if the
 * column is not present with the right shape.
 *
 * IDEMPOTENT BY CONSTRUCTION: the statement is `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so
 * a second invocation re-writes nothing. Running it twice on purpose is the proof (the second
 * run's BEFORE already shows the column, and nothing moves).
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it exists to be
 * run BY HAND, once, by the operator/lead. It prints the target host before its first
 * statement for exactly that reason: in this sandbox the DATABASE_URL in the environment IS
 * production.
 *
 * ROLLBACK: ALTER TABLE tracked_bids DROP COLUMN source; — the column is new, no row depends
 * on it, and every pre-existing tracked bid legitimately keeps NULL.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-058] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-058] target database host: ${new URL(url).hostname} — 1 column added to tracked_bids, no data rows written`,
  );
} catch {
  console.warn("[run-058] target database host: (unparseable DATABASE_URL)");
}
/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = [
  "users",
  "bids",
  "tracked_bids",
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
 * The column this migration adds to tracked_bids, with the shape it must have.
 *
 * `source` is NULLABLE with NO default and NO back-fill: a row tracked before this migration
 * genuinely has no recorded provenance, and every countdown surface treats a NULL source as
 * fail-open (unchanged behaviour). It is never inferred from the title/agency/date.
 */
const NEW_COLUMNS: Record<string, { type: string; nullable: boolean }> = {
  source: { type: "text", nullable: true },
};
async function snapshot(): Promise<{ tables: number; counts: Record<string, number | null> }> {
  const tableRows = (await sql`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
  `) as { n: number }[];
  const counts: Record<string, number | null> = {};
  for (const table of COUNTED_TABLES) {
    try {
      const rows = (await sql.query(`SELECT count(*)::int AS n FROM ${table}`)) as { n: number }[];
      counts[table] = rows[0]?.n ?? null;
    } catch {
      counts[table] = null; // absent table: reported, never created by this migration
    }
  }
  return { tables: tableRows[0]?.n ?? 0, counts };
}
async function columnTypes(): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tracked_bids'
  `) as { column_name: string; data_type: string; is_nullable: string }[];
  return new Map(rows.map((r) => [r.column_name, `${r.data_type}:${r.is_nullable}`]));
}
const before = await snapshot();
console.log(`[run-058] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-058]   ${table}: ${value === null ? "(absent)" : value}`);
}
const beforeColumns = await columnTypes();
const file = new URL("./058_tracked_bids_source.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter(
  (s) => s.trim().length > 0,
);
// Pre-flight: the target table must exist (058 is a delta on the tracked_bids table that the
// deadline tracker creates). A database that never built it must fail LOUDLY here rather
// than silently writing nothing.
if (!beforeColumns.has("bid_id") || !beforeColumns.has("due_date")) {
  console.error(
    "[run-058] FAIL: tracked_bids does not exist (or lacks bid_id/due_date) — the tracker schema must be applied first",
  );
  process.exit(1);
}
console.log(
  `[run-058] BEFORE tracked_bids columns already carrying this migration: ${
    Object.keys(NEW_COLUMNS).filter((c) => beforeColumns.has(c)).join(", ") || "(none — first run)"
  }`,
);
console.log(`[run-058] ${statements.length} statement(s) from 058_tracked_bids_source.sql`);
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
console.log(`[run-058] AFTER: ${after.tables} public table(s)`);
const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-058]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
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
  `[run-058] verify ${JSON.stringify({
    publicTables: after.tables,
    addedColumns: Object.keys(NEW_COLUMNS),
    shapeProblems,
    rowCountsMoved: moved,
  })}`,
);
if (failed > 0) {
  console.error(`[run-058] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-058] FAIL: the database shape does not match migration 058");
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-058] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables) {
  console.error(
    `[run-058] FAIL: public table count went ${before.tables} -> ${after.tables} (expected no change)`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "[run-058] OK — 1/1 column present on tracked_bids (source TEXT NULLABLE), additive (no row count moved, no new table)",
  );
}
