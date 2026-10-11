/**
 * Migration 060 — CRM Professional follow-up reminders (owner handoff 2026-10-10,
 * item 4). The reviewed record is db/migrations/060_crm_reminders.sql — this runner
 * executes ITS statements, one by one, through the shared splitter, so the file
 * that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-060.ts        (DATABASE_URL must be set)
 *
 * NUMBERING: 059 was the last applied/committed migration on main (CRM phase 1),
 * so the next FREE number is 060. Nothing was overwritten.
 *
 * SPLITTER: this file contains a `DO $$ … $$` idempotency guard around the
 * composite FK, so the runner uses `schemaStatements()` (the dollar-quote-aware
 * splitter in ./sql-statements) rather than `migrationStatements()`, which splits
 * on `;` alone and would cut the guard's body in half — the migration-059 rule.
 *
 * ADDITIVE-ONLY, and the runner proves it. BEFORE and AFTER it counts every table
 * in the database plus the row counts of the touched surfaces (users / bids /
 * saved_matches / nonprofit_applications). Exactly TWO tables are added
 * (user_crm_prefs, crm_reminder_deliveries) — the public table count must go up by
 * exactly 2, every counted surface must be unmoved, both new tables must be EMPTY,
 * both new tables must carry the expected column shapes, the three new unique
 * indexes must exist, the composite ownership FK
 * crm_reminder_deliveries_saved_match_owner_fk must be present with the right
 * definition, and NO column may be added to or removed from any EXISTING table
 * (060 adds indexes and a constraint, never a column). Any deviation fails.
 *
 * IDEMPOTENT BY CONSTRUCTION: both tables are `CREATE TABLE IF NOT EXISTS`, every
 * index is `CREATE … INDEX IF NOT EXISTS`, and the FK — the ONE statement Postgres
 * has no `IF NOT EXISTS` form for — is wrapped in a pg_constraint name guard.
 * Running it twice on purpose is the proof: the second run's BEFORE already shows
 * both tables, all three indexes and the FK, and nothing moves.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it
 * exists to be run BY HAND, once, by the operator/lead, PROD-FIRST and BEFORE the
 * reminder code deploys (migrations 047/051/052/053/058/059 protocol). It prints
 * the target host before its first statement for exactly that reason: in this
 * sandbox the DATABASE_URL in the environment IS production.
 *
 * ROLLBACK: see the header of 060_crm_reminders.sql (drop the FK, then the two new
 * tables, then the saved_matches index).
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { schemaStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-060] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-060] target database host: ${new URL(url).hostname} — 2 new tables (user_crm_prefs, crm_reminder_deliveries) + 3 new unique indexes + 1 composite FK, no data rows written, no column added to an existing table`,
  );
} catch {
  console.warn("[run-060] target database host: (unparseable DATABASE_URL)");
}
/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = ["users", "bids", "saved_matches", "nonprofit_applications"] as const;
/** Exactly how many tables this migration adds to the public schema. */
const EXPECTED_NEW_TABLES = 2;
/**
 * The two tables this migration CREATES, with the exact column shape each must
 * have. `text` is the driver-facing type for TEXT, `integer` for SERIAL / INTEGER,
 * `boolean` for BOOLEAN, `date` for DATE, `timestamp with time zone` for
 * TIMESTAMPTZ — the same vocabulary information_schema.columns reports, so shape
 * drift is a failure rather than a runtime surprise.
 *
 * NOT NULL columns are the owner's spec verbatim: the opt-in is a real boolean that
 * defaults to false (never NULL — an unknown consent is not a consent), the
 * timezone is never NULL (a per-user clock is always resolvable, defaulting to
 * UTC), and a ledger row always knows its key, its window and its attempt count.
 * delivered_at and last_error are the ONLY nullable columns on the ledger: NULL
 * delivered_at means "not confirmed", NULL last_error means "last outcome unknown".
 */
const NEW_TABLES: Record<string, Record<string, { type: string; nullable: boolean }>> = {
  user_crm_prefs: {
    user_id: { type: "integer", nullable: false },
    reminders_opt_in: { type: "boolean", nullable: false },
    timezone: { type: "text", nullable: false },
    created_at: { type: "timestamp with time zone", nullable: false },
    updated_at: { type: "timestamp with time zone", nullable: false },
  },
  crm_reminder_deliveries: {
    id: { type: "integer", nullable: false },
    user_id: { type: "integer", nullable: false },
    saved_match_id: { type: "integer", nullable: false },
    bid_id: { type: "integer", nullable: false },
    due_on: { type: "date", nullable: false },
    scheduled_for: { type: "timestamp with time zone", nullable: false },
    delivered_at: { type: "timestamp with time zone", nullable: true },
    attempt_count: { type: "integer", nullable: false },
    idempotency_key: { type: "text", nullable: false },
    last_error: { type: "text", nullable: true },
    created_at: { type: "timestamp with time zone", nullable: false },
  },
};
/** The unique indexes this migration creates, with their table and column list. */
const NEW_INDEXES: Record<string, { table: string; columns: string[]; unique: boolean }> = {
  crm_reminder_deliveries_idempotency_key_uniq: {
    table: "crm_reminder_deliveries",
    columns: ["idempotency_key"],
    unique: true,
  },
  crm_reminder_deliveries_user_match_due_uniq: {
    table: "crm_reminder_deliveries",
    columns: ["user_id", "saved_match_id", "due_on"],
    unique: true,
  },
  crm_reminder_deliveries_user_due_idx: {
    table: "crm_reminder_deliveries",
    columns: ["user_id", "due_on"],
    unique: false,
  },
  saved_matches_user_id_id_uniq: {
    table: "saved_matches",
    columns: ["user_id", "id"],
    unique: true,
  },
};
/** The composite FK whose creation is guarded by the `DO $$ … $$` block. */
const FK_NAME = "crm_reminder_deliveries_saved_match_owner_fk";
/** The composite FK's required definition (checked as a regex over pg_get_constraintdef). */
const FK_DEF =
  /FOREIGN KEY \(user_id, saved_match_id\) REFERENCES saved_matches\(user_id, id\)/;

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
  // `pg_get_indexdef(indexrelid, column_no, pretty)` is the supported way to read one
  // index column in order (no `int2vector`/`unnest` casting games), and `indnatts` is
  // the index's column count. Our indexes carry no INCLUDE columns, so the two agree.
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
async function fkDefinition(): Promise<string | null> {
  const rows = (await sql`
    SELECT contype, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conname = ${FK_NAME}
    LIMIT 1
  `) as { contype: string; def: string }[];
  const row = rows[0];
  return row ? `${row.contype}:${row.def}` : null;
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
console.log(`[run-060] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-060]   ${table}: ${value === null ? "(absent)" : value}`);
}
// Pre-flight: the surfaces this delta hangs off must exist. A database that never
// built them must fail LOUDLY here rather than half-run the migration.
const beforeSavedMatchColumns = await columnTypes("saved_matches");
if (
  !beforeSavedMatchColumns.has("user_id") ||
  !beforeSavedMatchColumns.has("follow_up_date") ||
  !beforeSavedMatchColumns.has("id")
) {
  console.error(
    "[run-060] FAIL: saved_matches does not exist (or lacks id/user_id/follow_up_date) — the pipeline + migration-052 schema must be applied first",
  );
  process.exit(1);
}
if (before.counts.users === null) {
  console.error("[run-060] FAIL: users does not exist — the base schema must be applied first");
  process.exit(1);
}
const beforeCrm = new Map<string, boolean>();
for (const table of Object.keys(NEW_TABLES)) {
  beforeCrm.set(table, (await columnTypes(table)).size > 0);
}
const beforeIndexes = new Map<string, boolean>();
for (const name of Object.keys(NEW_INDEXES)) {
  beforeIndexes.set(name, (await indexShape(name)) !== null);
}
console.log(
  `[run-060] BEFORE reminder tables present: ${
    [...beforeCrm.entries()].map(([t, present]) => `${t}=${present ? "yes" : "no"}`).join(", ") ||
    "(none — first run)"
  }`,
);
console.log(
  `[run-060] BEFORE indexes present: ${
    [...beforeIndexes.entries()].map(([n, present]) => `${n}=${present ? "yes" : "no"}`).join(", ")
  }; FK ${FK_NAME} present: ${(await fkDefinition()) ? "yes" : "no"}`,
);
const file = new URL("./060_crm_reminders.sql", import.meta.url);
const statements = schemaStatements(readFileSync(file, "utf8")).filter((s) => s.trim().length > 0);
console.log(`[run-060] ${statements.length} statement(s) from 060_crm_reminders.sql`);
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
const afterSavedMatchColumns = await columnTypes("saved_matches");
console.log(`[run-060] AFTER: ${after.tables} public table(s)`);
const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-060]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
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
  console.log(`[run-060]   ${table}: ${actual.size} column(s), ${newTableRows[table]} row(s)`);
}
// 060 adds NO column to any existing table: saved_matches' column set must be
// byte-identical before and after (only an index is added).
const beforeNames = [...beforeSavedMatchColumns.keys()].sort().join(",");
const afterNames = [...afterSavedMatchColumns.keys()].sort().join(",");
if (beforeNames !== afterNames) {
  shapeProblems.push(
    `saved_matches columns changed (${beforeNames} -> ${afterNames}); 060 adds no column`,
  );
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
  console.log(
    `[run-060]   index ${name} on ${want.table}(${shape.columns.join(", ")}) unique=${shape.unique}`,
  );
}
const fk = await fkDefinition();
const fkProblems: string[] = [];
if (!fk) {
  fkProblems.push(`${FK_NAME} MISSING`);
} else if (!fk.startsWith("f:")) {
  fkProblems.push(`${FK_NAME} is not a foreign key (${fk})`);
} else if (!FK_DEF.test(fk)) {
  fkProblems.push(`${FK_NAME} has an unexpected definition: ${fk}`);
}
const dataProblems = Object.entries(newTableRows)
  .filter(([, n]) => n !== 0)
  .map(([table, n]) => `${table} has ${n} row(s) (expected 0)`);
console.log(`[run-060] ${FK_NAME}: ${fk ?? "(absent)"}`);
console.log(
  `[run-060] verify ${JSON.stringify({
    publicTables: `${before.tables} -> ${after.tables}`,
    newTables: Object.keys(NEW_TABLES),
    newIndexes: Object.keys(NEW_INDEXES),
    fk: fk ?? null,
    shapeProblems,
    indexProblems,
    fkProblems,
    dataProblems,
    rowCountsMoved: moved,
  })}`,
);
if (failed > 0) {
  console.error(`[run-060] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-060] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables + EXPECTED_NEW_TABLES) {
  console.error(
    `[run-060] FAIL: public table count went ${before.tables} -> ${after.tables} (expected +${EXPECTED_NEW_TABLES})`,
  );
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-060] FAIL: the database shape does not match migration 060");
  for (const problem of shapeProblems) console.error(`[run-060]   ${problem}`);
  process.exitCode = 1;
} else if (indexProblems.length > 0) {
  console.error("[run-060] FAIL: the reminder indexes are not as specified");
  for (const problem of indexProblems) console.error(`[run-060]   ${problem}`);
  process.exitCode = 1;
} else if (fkProblems.length > 0) {
  console.error("[run-060] FAIL: the composite ownership FK is not as specified");
  for (const problem of fkProblems) console.error(`[run-060]   ${problem}`);
  process.exitCode = 1;
} else if (dataProblems.length > 0) {
  console.error("[run-060] FAIL: this migration writes no data rows");
  for (const problem of dataProblems) console.error(`[run-060]   ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-060] OK — user_crm_prefs + crm_reminder_deliveries created (+${EXPECTED_NEW_TABLES} tables), 4 indexes present, ${FK_NAME} present; additive (no row count moved, no column added to an existing table, both new tables empty)`,
  );
}
