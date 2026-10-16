/**
 * Migration 063 — hauling_leads (trucking queue item #4). The reviewed record is
 * db/migrations/063_hauling_leads.sql; this runner executes ITS statements, one by
 * one, through the shared dollar-quote-aware splitter, so the file that is reviewed is
 * the file that runs.
 *
 *   bun run db/migrations/run-063.ts        (DATABASE_URL must be set)
 *
 * NUMBERING: 062 was the last committed/applied migration on main (trucking #2a's
 * category re-stamp, applied to prod 2026-10-16), so the next FREE number is 063.
 *
 * ADDITIVE-ONLY, and the runner proves it. BEFORE and AFTER it counts every table in
 * the database plus the row counts of the surfaces a wrong statement would disturb.
 * Exactly ONE table is added (hauling_leads) — the public table count must go up by
 * exactly 1, every counted surface must be unmoved, the new table must be EMPTY, it
 * must carry the expected column shapes, and both indexes must exist with the expected
 * ordered columns and uniqueness. Any deviation fails.
 *
 * IDEMPOTENT BY CONSTRUCTION: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
 * Running it twice on purpose is the proof: the second run's BEFORE already shows the
 * table and both indexes, nothing moves, and every assertion still holds.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it exists
 * to be run BY HAND, once, by the operator/lead, PROD-FIRST and BEFORE the read/write
 * code deploys (the 047/051/052/053/058/059/060/062 protocol). It prints the target
 * host before its first statement for exactly that reason: in this sandbox the
 * DATABASE_URL in the environment IS production.
 *
 * ROLLBACK: see the header of 063_hauling_leads.sql (drop the two indexes, then the
 * table). The read surface degrades to its honest empty state on its own.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { schemaStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-063] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-063] target database host: ${new URL(url).hostname} — 1 table + 2 indexes added, no data rows written`,
  );
} catch {
  console.warn("[run-063] target database host: (unparseable DATABASE_URL)");
}

/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = [
  "users",
  "bids",
  "saved_matches",
  "award_leads",
  "subcontract_opportunities",
  "subcontract_sources",
  "subcontract_primes",
  "subcontract_sync_runs",
] as const;

/** Exactly one table is added. */
const EXPECTED_NEW_TABLES = 1;

/**
 * hauling_leads' required column shapes. NOT NULL exactly where the write path always
 * supplies a value; nullable where the published record may genuinely state nothing
 * (place of performance is absent on overseas/unspecified DoD work — 18 of the 99
 * measured rows — and city/UEI are not always published).
 */
const NEW_TABLES: Record<string, Record<string, { type: string; nullable: boolean }>> = {
  hauling_leads: {
    id: { type: "integer", nullable: false },
    award_key: { type: "text", nullable: false },
    award_id: { type: "text", nullable: false },
    award_date: { type: "date", nullable: true },
    pop_state: { type: "text", nullable: true },
    pop_city: { type: "text", nullable: true },
    prime_name: { type: "text", nullable: false },
    prime_uei: { type: "text", nullable: true },
    amount: { type: "bigint", nullable: false },
    naics_code: { type: "text", nullable: true },
    naics_description: { type: "text", nullable: true },
    agency: { type: "text", nullable: true },
    usa_spending_url: { type: "text", nullable: false },
    description_snippet: { type: "text", nullable: false },
    hauling_scope: { type: "boolean", nullable: false },
    scope_kind: { type: "text", nullable: false },
    prime_kind: { type: "text", nullable: false },
    created_at: { type: "timestamp with time zone", nullable: false },
  },
};

/** The two indexes, with the ordered columns and uniqueness they must have. */
const NEW_INDEXES: Record<string, { table: string; columns: string[]; unique: boolean }> = {
  // NOTE: `pg_get_indexdef(indexrelid, k, TRUE)` yields the column NAME only — the
  // per-column DESC ordering lives in the index definition's ORDER BY, so the DESC
  // direction is asserted separately against the full `pg_get_indexdef(indexrelid)`
  // text below (INDEX_DEFS), not here.
  hauling_leads_award_date_idx: {
    table: "hauling_leads",
    columns: ["award_date", "id"],
    unique: false,
  },
  hauling_leads_pop_state_idx: { table: "hauling_leads", columns: ["pop_state"], unique: false },
};

/** The full definition each index must match (this is where DESC is proven). */
const INDEX_DEFS: Record<string, RegExp> = {
  hauling_leads_award_date_idx: /\(award_date DESC, id DESC\)/,
  hauling_leads_pop_state_idx: /\(pop_state\)/,
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

async function columnTypes(table: string): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `) as { column_name: string; data_type: string; is_nullable: string }[];
  return new Map(rows.map((r) => [r.column_name, `${r.data_type}:${r.is_nullable}`]));
}

async function rowCount(table: string): Promise<number | null> {
  try {
    const rows = (await sql.query(`SELECT count(*)::int AS n FROM ${table}`)) as { n: number }[];
    return rows[0]?.n ?? null;
  } catch {
    return null; // absent
  }
}

/** One index's live shape: its uniqueness and its ordered column list. */
async function indexShape(name: string): Promise<{ unique: boolean; columns: string[] } | null> {
  const rows = (await sql`
    SELECT i.indisunique AS unique,
           (SELECT array_to_string(
                     ARRAY(SELECT pg_get_indexdef(i.indexrelid, k, TRUE)
                             FROM generate_series(1, i.indnatts) AS k), ',')
           ) AS columns
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ${name}
    LIMIT 1
  `) as { unique: boolean; columns: string | null }[];
  const row = rows[0];
  if (!row) return null;
  const columns = String(row.columns ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
  return { unique: row.unique === true, columns };
}

/** Compares one table's live column map against an expected shape. */
function shapeDiff(
  expected: Record<string, { type: string; nullable: boolean }>,
  actual: Map<string, string>,
  label: string,
): string[] {
  const problems: string[] = [];
  for (const [column, want] of Object.entries(expected)) {
    const type = actual.get(column);
    if (!type) {
      problems.push(`${label}.${column} MISSING`);
      continue;
    }
    if (!type.startsWith(`${want.type}:`)) {
      problems.push(`${label}.${column} is ${type}, expected ${want.type}`);
      continue;
    }
    const nullable = type.endsWith(":YES");
    if (nullable !== want.nullable) {
      problems.push(
        `${label}.${column} is ${nullable ? "nullable" : "NOT NULL"} (${type}), expected ${want.nullable ? "nullable" : "NOT NULL"}`,
      );
    }
  }
  return problems;
}

const before = await snapshot();
console.log(`[run-063] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-063]   ${table}: ${value === null ? "(absent)" : value}`);
}
// Pre-flight: the database this delta hangs off must exist. A database that never
// built the base schema must fail LOUDLY here rather than half-run the migration.
if (before.counts.users === null) {
  console.error("[run-063] FAIL: users does not exist — the base schema must be applied first");
  process.exit(1);
}
const beforeAwardLeadColumns = await columnTypes("award_leads");
const beforeNew = new Map<string, boolean>();
for (const table of Object.keys(NEW_TABLES)) {
  beforeNew.set(table, (await columnTypes(table)).size > 0);
}
const beforeIndexes = new Map<string, boolean>();
for (const name of Object.keys(NEW_INDEXES)) {
  beforeIndexes.set(name, (await indexShape(name)) !== null);
}
console.log(
  `[run-063] BEFORE hauling_leads present: ${
    [...beforeNew.entries()].map(([t, present]) => `${t}=${present ? "yes" : "no"}`).join(", ") ||
    "(none — first run)"
  }`,
);
/** A run whose BEFORE already shows the table and both indexes is a deliberate re-run. */
const isRerun = [...beforeNew.values()].every(Boolean) && [...beforeIndexes.values()].every(Boolean);
console.log(
  `[run-063] BEFORE indexes present: ${[...beforeIndexes.entries()]
    .map(([n, present]) => `${n}=${present ? "yes" : "no"}`)
    .join(", ")}`,
);

const file = new URL("./063_hauling_leads.sql", import.meta.url);
const statements = schemaStatements(readFileSync(file, "utf8")).filter((s) => s.trim().length > 0);
console.log(`[run-063] ${statements.length} statement(s) from 063_hauling_leads.sql`);
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
console.log(`[run-063] AFTER: ${after.tables} public table(s)`);
const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-063]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
}

const shapeProblems: string[] = [];
const newTableRows: Record<string, number | null> = {};
for (const [table, expected] of Object.entries(NEW_TABLES)) {
  const actual = await columnTypes(table);
  if (actual.size === 0) {
    shapeProblems.push(`${table} MISSING`);
    newTableRows[table] = null;
    continue;
  }
  shapeProblems.push(...shapeDiff(expected, actual, table));
  newTableRows[table] = await rowCount(table);
  console.log(`[run-063]   ${table}: ${actual.size} column(s), ${newTableRows[table]} row(s)`);
}

// 063 adds NO column to any existing table: award_leads' column set must be
// byte-identical before and after.
const afterAwardLeadColumns = await columnTypes("award_leads");
if (beforeAwardLeadColumns.size > 0 || afterAwardLeadColumns.size > 0) {
  const beforeNames = [...beforeAwardLeadColumns.keys()].sort().join(",");
  const afterNames = [...afterAwardLeadColumns.keys()].sort().join(",");
  if (beforeNames !== afterNames) {
    shapeProblems.push(`award_leads columns changed (${beforeNames} -> ${afterNames}); 063 adds no column`);
  }
}

const indexProblems: string[] = [];
for (const [name, want] of Object.entries(NEW_INDEXES)) {
  const shape = await indexShape(name);
  if (!shape) {
    indexProblems.push(`${name} MISSING`);
    continue;
  }
  if (shape.unique !== want.unique) {
    indexProblems.push(`${name} unique=${shape.unique}, expected ${want.unique}`);
  }
  if (shape.columns.join(",") !== want.columns.join(",")) {
    indexProblems.push(`${name} columns=[${shape.columns.join(",")}], expected [${want.columns.join(",")}]`);
  }
  const definition = (await sql`
    SELECT pg_get_indexdef(c.oid) AS def FROM pg_class c WHERE c.relname = ${name} LIMIT 1
  `) as { def: string | null }[];
  const def = definition[0]?.def ?? null;
  if (!def) {
    indexProblems.push(`${name} has no readable definition`);
  } else if (!INDEX_DEFS[name]!.test(def)) {
    indexProblems.push(`${name} definition is not as specified: ${def}`);
  }
  console.log(
    `[run-063]   index ${name} on ${want.table}(${shape.columns.join(", ")}) unique=${shape.unique} :: ${def}`,
  );
}

const dataProblems = Object.entries(newTableRows)
  .filter(([, n]) => n !== 0)
  .map(([table, n]) => `${table} has ${n} row(s) — this migration writes no data rows`);

console.log(
  `[run-063] verify ${JSON.stringify({
    host: (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })(),
    publicTables: `${before.tables} -> ${after.tables}`,
    newTables: Object.keys(NEW_TABLES),
    newIndexes: Object.keys(NEW_INDEXES),
    shapeProblems,
    indexProblems,
    dataProblems,
    rowCountsMoved: moved,
  })}`,
);

if (failed > 0) {
  console.error(`[run-063] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-063] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables + (isRerun ? 0 : EXPECTED_NEW_TABLES)) {
  console.error(
    `[run-063] FAIL: public table count went ${before.tables} -> ${after.tables} (expected ${
      isRerun ? "no" : `+${EXPECTED_NEW_TABLES}`
    } table(s)${isRerun ? " — this is a re-run, the table already existed" : ""})`,
  );
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-063] FAIL: the database shape does not match migration 063");
  for (const problem of shapeProblems) console.error(`[run-063]   ${problem}`);
  process.exitCode = 1;
} else if (indexProblems.length > 0) {
  console.error("[run-063] FAIL: the hauling-leads indexes are not as specified");
  for (const problem of indexProblems) console.error(`[run-063]   ${problem}`);
  process.exitCode = 1;
} else if (dataProblems.length > 0) {
  console.error("[run-063] FAIL: this migration writes no data rows");
  for (const problem of dataProblems) console.error(`[run-063]   ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-063] OK — hauling_leads ready (${isRerun ? "re-run: the table and both indexes already existed, nothing moved — IDEMPOTENT" : "+1 table, 2 indexes"}); additive (no row count moved, no column added to an existing table, the new table is ${newTableRows.hauling_leads ?? 0} row(s))`,
  );
}
