/**
 * Migration 051 — GSA PRIME CONTRACTOR DIRECTORY, schema delta
 * (owner-approved expansion 2026-09-26; spike README §6.1). The reviewed record is
 * db/migrations/051_gsa_prime_directory.sql — this runner executes ITS statements, one by
 * one, through the shared splitter, so the file that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-051.ts        (DATABASE_URL must be set)
 *
 * ADDITIVE-ONLY, and the runner proves it: BEFORE and AFTER it counts every table in the
 * database plus the row counts of the touched surfaces (users / bids /
 * state_grant_opportunities / the four subcontract tables). Three NULLABLE columns are
 * added to subcontract_primes and NOTHING else may change — the AFTER block fails the run
 * if any table's row count moved, if the public table count moved, or if the four columns
 * are not present with the right shape.
 *
 * IDEMPOTENT BY CONSTRUCTION: every statement is `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
 * so a second invocation re-writes nothing. Running it twice on purpose is the proof.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it exists to
 * be run BY HAND, once, by the operator/lead. It prints the target host before its first
 * statement for exactly that reason: in this sandbox the DATABASE_URL in the environment
 * IS production. (The sync job's source row is created idempotently by the job itself via
 * ensureSubcontractSource — this migration writes no data rows at all.)
 *
 * ROLLBACK: ALTER TABLE subcontract_primes DROP COLUMN vendor_address, DROP COLUMN
 * products_services, DROP COLUMN source_file_date; — no SBA row depends on them.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-051] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-051] target database host: ${new URL(url).hostname} — 4 nullable columns on subcontract_primes, no data rows written`,
  );
} catch {
  console.warn("[run-051] target database host: (unparseable DATABASE_URL)");
}

/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = [
  "users",
  "bids",
  "state_grant_opportunities",
  "state_grant_sources",
  "subcontract_opportunities",
  "subcontract_sources",
  "subcontract_primes",
  "subcontract_sync_runs",
] as const;

/**
 * The four columns this migration adds, with the type each must have.
 *
 * `naics_raw` is the owner's 2026-09-26 refinement: the NAICS cell VERBATIM for the rows whose
 * code failed /^\d{6}$/ (NULL for a valid code), so the invalid values stay identifiable in
 * the data — SELECT count(*) … WHERE naics_raw IS NOT NULL — while only validated six-digit
 * codes are ever displayed.
 */
const NEW_COLUMNS: Record<string, string> = {
  vendor_address: "text",
  products_services: "text",
  source_file_date: "date",
  naics_raw: "text",
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
      const rows = (await sql.query(`SELECT count(*)::int AS n FROM ${table}`)) as { n: number }[];
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
    WHERE table_schema = 'public' AND table_name = 'subcontract_primes'
  `) as { column_name: string; data_type: string; is_nullable: string }[];
  return new Map(rows.map((r) => [r.column_name, `${r.data_type}:${r.is_nullable}`]));
}

const before = await snapshot();
console.log(`[run-051] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-051]   ${table}: ${value === null ? "(absent)" : value}`);
}

const beforeColumns = await columnTypes();
const file = new URL("./051_gsa_prime_directory.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter(
  (s) => s.trim().length > 0,
);
console.log(`[run-051] ${statements.length} statement(s) from 051_gsa_prime_directory.sql`);

// Pre-flight: the target table must exist (051's parent is 050). A fresh database that
// never ran 050 must fail LOUDLY here rather than silently creating nothing.
if (!beforeColumns.has("uei")) {
  console.error(
    "[run-051] FAIL: subcontract_primes does not exist (or has no uei column) — migration 050 must be applied first",
  );
  process.exit(1);
}

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
console.log(`[run-051] AFTER: ${after.tables} public table(s)`);

const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-051]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
}

const shapeProblems: string[] = [];
for (const [column, expectedType] of Object.entries(NEW_COLUMNS)) {
  const type = afterColumns.get(column);
  if (!type) shapeProblems.push(`${column} MISSING`);
  else if (!type.startsWith(`${expectedType}:`)) {
    shapeProblems.push(`${column} is ${type}, expected ${expectedType}`);
  } else if (!type.endsWith(":YES")) {
    // The four columns are additive and NULLABLE: an existing SBA row keeps NULL.
    shapeProblems.push(`${column} is NOT nullable (${type})`);
  }
}
console.log(
  `[run-051] verify ${JSON.stringify({
    publicTables: after.tables,
    addedColumns: Object.keys(NEW_COLUMNS),
    shapeProblems,
    rowCountsMoved: moved,
  })}`,
);

if (failed > 0) {
  console.error(`[run-051] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-051] FAIL: the database shape does not match migration 051");
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-051] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables) {
  console.error(
    `[run-051] FAIL: public table count went ${before.tables} -> ${after.tables} (expected no change)`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `[run-051] OK — 4/4 nullable columns present on subcontract_primes, additive (no row count moved, no new table)`,
  );
}
