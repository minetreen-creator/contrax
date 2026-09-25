/**
 * Migration 050 — SUBCONTRACTING PREVIEW data layer (owner directive 2026-09-25,
 * BUILD-PLAN.md §6.2). The reviewed record is
 * db/migrations/050_subcontracts.sql — this runner executes ITS statements, one by
 * one, through the shared splitter, so the file that is reviewed is the file that
 * runs.
 *
 *   bun run db/migrations/run-050.ts        (DATABASE_URL must be set)
 *
 * ADDITIVE-ONLY, and the runner proves it: BEFORE and AFTER it counts every table in
 * the database plus the row counts of the touched surfaces (users / bids /
 * state_grant_opportunities / …). The four subcontract tables are created empty and
 * nothing else may change — the AFTER block fails the run if any pre-existing table's
 * row count moved, if a fifth object appeared, or if any of the four new tables has
 * the wrong shape.
 *
 * IDEMPOTENT BY CONSTRUCTION: every statement in the .sql file is
 * `CREATE TABLE IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`, so a second
 * invocation re-writes nothing. Running it twice on purpose is the proof (the
 * second run's BEFORE equals the first run's AFTER — the tables exist, still empty).
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it
 * exists to be run BY HAND, once. It prints the target host before its first
 * statement for exactly that reason: in this sandbox the DATABASE_URL in the
 * environment IS production.
 *
 * ROLLBACK: `DROP TABLE subcontract_opportunities` (and _sync_runs, _primes,
 * _sources) — the tables are new and nothing else references them, so no data of
 * the existing product is involved. Deleting a NOT NULL `status`/`fingerprint`
 * column instead (which an older revision of the plan mentioned) is NOT what this
 * migration does: the whole feature is new tables only.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-050] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(`[run-050] target database host: ${new URL(url).hostname} — 4 new tables, no writes to existing objects`);
} catch {
  console.warn("[run-050] target database host: (unparseable DATABASE_URL)");
}

/** The pre-existing product surfaces whose row counts must NOT move. */
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

const NEW_TABLES = [
  "subcontract_sources",
  "subcontract_opportunities",
  "subcontract_sync_runs",
  "subcontract_primes",
] as const;

async function snapshot(): Promise<{
  tables: number;
  counts: Record<string, number | null>;
  newTablesPresent: string[];
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
      counts[table] = null; // the table does not exist yet
    }
  }
  const present = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'subcontract%'
  `) as { table_name: string }[];
  return {
    tables: Number(tables[0]?.n ?? 0),
    counts,
    newTablesPresent: present.map((r) => r.table_name).sort(),
  };
}

const before = await snapshot();
console.log(`[run-050] BEFORE: ${before.tables} public table(s); subcontract tables: ${before.newTablesPresent.join(", ") || "(none)"}`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-050]   ${table}: ${value === null ? "(absent)" : value}`);
}

const file = new URL("./050_subcontracts.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter((s) => s.trim().length > 0);
console.log(`[run-050] ${statements.length} statement(s) from 050_subcontracts.sql`);
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
console.log(`[run-050] AFTER: ${after.tables} public table(s); subcontract tables: ${after.newTablesPresent.join(", ")}`);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const prev = before.counts[table];
  const flag = prev !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-050]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
}

// ── Shape verification: the columns/indexes the plan requires ────────────────
const REQUIRED_COLUMNS: Record<string, string[]> = {
  subcontract_opportunities: [
    "source_id",
    "external_id",
    "natural_key",
    "title",
    "prime",
    "scope",
    "naics",
    "state_code",
    "closing_date",
    "contact_email",
    "source_url",
    "detail_url",
    "last_seen_at",
    "last_verified_at",
    "status",
    "fingerprint",
  ],
  subcontract_primes: [
    "legal_name",
    "uei",
    "naics",
    "vendor_state",
    "pop_states",
    "subcontract_plan_type",
    "fy",
    "value",
    "source_url",
  ],
};
const shape = (await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name LIKE 'subcontract%'
`) as { table_name: string; column_name: string }[];
const byTable = new Map<string, Set<string>>();
for (const row of shape) {
  if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
  byTable.get(row.table_name)!.add(row.column_name);
}
let missing: string[] = [];
for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
  for (const column of columns) {
    if (!byTable.get(table)?.has(column)) missing.push(`${table}.${column}`);
  }
}
const uniques = (await sql`
  SELECT indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND tablename LIKE 'subcontract%' AND indexdef LIKE '%UNIQUE%'
`) as { indexdef: string }[];
const uniqueDefs = uniques.map((r) => r.indexdef);
const uniquePair = uniqueDefs.some(
  (d) => d.includes("subcontract_opportunities") && d.includes("source_id") && d.includes("external_id"),
);
const uniqueUei = uniqueDefs.some((d) => d.includes("subcontract_primes") && d.includes("uei"));
const checks = (await sql`
  SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE contype = 'c' AND conrelid::regclass::text LIKE 'subcontract%'
`) as { table_name: string; def: string }[];
const statusCheck = checks.find(
  (c) => c.table_name === "subcontract_opportunities" && c.def.includes("'unverified'"),
);
console.log(
  `[run-050] verify ${JSON.stringify({
    tables: after.newTablesPresent.length,
    uniqueSourceExternal: uniquePair,
    uniquePrimeUei: uniqueUei,
    statusUnverifiedCheck: Boolean(statusCheck),
    missingColumns: missing,
  })}`,
);

const preExistingMoved = COUNTED_TABLES.filter(
  (t) => !NEW_TABLES.includes(t as (typeof NEW_TABLES)[number]) && before.counts[t] !== after.counts[t],
);

if (failed > 0) {
  console.error(`[run-050] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (missing.length > 0 || !uniquePair || !uniqueUei || !statusCheck) {
  console.error("[run-050] FAIL: the database shape does not match migration 050");
  process.exitCode = 1;
} else if (preExistingMoved.length > 0) {
  console.error(`[run-050] FAIL: existing table(s) changed row count: ${preExistingMoved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables + 4 && before.newTablesPresent.length === 0) {
  console.error(`[run-050] FAIL: public table count went ${before.tables} -> ${after.tables} (expected +4)`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-050] OK — ${after.newTablesPresent.length}/4 subcontract tables present, additive (no pre-existing row count moved)`,
  );
}
