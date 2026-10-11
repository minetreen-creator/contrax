/**
 * Migration 059 — CRM schema (contacts + activities + the per-account contact cap),
 * owner handoff 2026-10-10 (CRM phase 1 of 3). The reviewed record is
 * db/migrations/059_crm.sql — this runner executes ITS statements, one by one,
 * through the shared splitter, so the file that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-059.ts        (DATABASE_URL must be set)
 *
 * NUMBERING NOTE: the delegation brief called this "<next>_crm.sql". 054–058 were
 * already taken on main (054 = DOT directory, 055 = contract payments, 056 =
 * contractor operations, 057 = visitors country, 058 = tracked-bid source), so the
 * next FREE number is 059. Nothing was overwritten.
 *
 * SPLITTER NOTE (new for this repo): unlike every earlier runner, this one splits
 * the file with `schemaStatements()` — the dollar-quote-aware splitter in
 * ./sql-statements — instead of `migrationStatements()`. Two statements in the
 * owner's spec cannot be split on `;` alone: the `DO $$ … $$` idempotency guard
 * around the FK, and the PL/pgSQL body of `crm_create_contact`. Both splitters are
 * the shared, reviewed ones; `migrationStatements()` splits on `;` by design and
 * would cut those bodies in half.
 *
 * ADDITIVE-ONLY, and the runner proves it. BEFORE and AFTER it counts every table
 * in the database plus the row counts of the touched surfaces (users / bids /
 * saved_matches / nonprofit_applications). Exactly TWO tables are added
 * (crm_contacts, crm_activities) — so the public table count must go up by exactly
 * 2, every counted surface must be unmoved, both new tables must be EMPTY, the two
 * new tables must carry the expected column shapes, saved_matches must show the new
 * NULLABLE integer column `crm_contact_id`, the composite FK
 * `saved_matches_crm_contact_owner_fk` must be present with the right definition,
 * and the function `crm_create_contact` must exist. Any deviation fails the run.
 *
 * IDEMPOTENT BY CONSTRUCTION: both tables are `CREATE … IF NOT EXISTS`, both
 * indexes are `CREATE INDEX IF NOT EXISTS`, the column is
 * `ADD COLUMN IF NOT EXISTS`, the function is `CREATE OR REPLACE`, and the FK —
 * the ONE statement Postgres has no `IF NOT EXISTS` form for — is wrapped in a
 * pg_constraint name guard. Running it twice on purpose is the proof (the second
 * run's BEFORE already shows both tables, the column, the FK and the function, and
 * nothing moves).
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it
 * exists to be run BY HAND, once, by the operator/lead, PROD-FIRST and BEFORE the
 * /api/crm code deploys (migrations 047/051/052/053/058 protocol). It prints the
 * target host before its first statement for exactly that reason: in this sandbox
 * the DATABASE_URL in the environment IS production.
 *
 * ROLLBACK: see the header of 059_crm.sql — DROP the FK, then the column, then the
 * function, then crm_activities, then crm_contacts. All five objects are new; the
 * pre-existing saved_matches columns are untouched.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { schemaStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-059] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-059] target database host: ${new URL(url).hostname} — 2 new tables (crm_contacts, crm_activities) + 1 column on saved_matches + 1 function, no data rows written`,
  );
} catch {
  console.warn("[run-059] target database host: (unparseable DATABASE_URL)");
}
/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = ["users", "bids", "saved_matches", "nonprofit_applications"] as const;
/** Exactly how many tables this migration adds to the public schema. */
const EXPECTED_NEW_TABLES = 2;
/**
 * The two tables this migration CREATES, with the exact column shape each must
 * have. `text` is the driver-facing type for TEXT, `integer` for SERIAL / INTEGER,
 * `timestamp with time zone` for TIMESTAMPTZ — the same vocabulary
 * information_schema.columns reports, so a shape drift is a failure and not a
 * surprise at runtime.
 *
 * NOT NULL columns are the owner's spec verbatim: a contact's name is required
 * (CHECK 1..200), and organization/role/email/phone/notes default to '' rather
 * than NULL so a read path never has to distinguish "absent" from "blank".
 * archived_at is the ONLY nullable column on crm_contacts: NULL means live.
 */
const NEW_TABLES: Record<string, Record<string, { type: string; nullable: boolean }>> = {
  crm_contacts: {
    id: { type: "integer", nullable: false },
    user_id: { type: "integer", nullable: false },
    name: { type: "text", nullable: false },
    organization: { type: "text", nullable: false },
    role: { type: "text", nullable: false },
    email: { type: "text", nullable: false },
    phone: { type: "text", nullable: false },
    notes: { type: "text", nullable: false },
    archived_at: { type: "timestamp with time zone", nullable: true },
    created_at: { type: "timestamp with time zone", nullable: false },
    updated_at: { type: "timestamp with time zone", nullable: false },
  },
  crm_activities: {
    id: { type: "integer", nullable: false },
    user_id: { type: "integer", nullable: false },
    contact_id: { type: "integer", nullable: false },
    kind: { type: "text", nullable: false },
    body: { type: "text", nullable: false },
    created_at: { type: "timestamp with time zone", nullable: false },
  },
};
/**
 * The ONE column this migration adds to an existing table. NULLABLE with no default
 * and no back-fill: a saved bid that predates the CRM genuinely has no linked
 * contact, and the value is never inferred from the pre-existing contact_name /
 * contact_email columns.
 */
const NEW_COLUMNS: Record<string, { table: string; type: string; nullable: boolean }> = {
  crm_contact_id: { table: "saved_matches", type: "integer", nullable: true },
};
/** The composite FK whose creation is guarded by the `DO $$ … $$` block. */
const FK_NAME = "saved_matches_crm_contact_owner_fk";
/** The PL/pgSQL function the atomic per-account cap lives in. */
const FUNCTION_NAME = "crm_create_contact";

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
async function fkDefinition(): Promise<string | null> {
  const rows = (await sql`
    SELECT contype, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conname = ${FK_NAME}
    LIMIT 1
  `) as { contype: string; def: string }[];
  const row = rows[0];
  return row ? `${row.contype}:${row.def}` : null;
}
async function functionPresent(): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 FROM pg_proc WHERE proname = ${FUNCTION_NAME} LIMIT 1
  `) as { "?column?": number }[];
  return rows.length > 0;
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
console.log(`[run-059] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-059]   ${table}: ${value === null ? "(absent)" : value}`);
}
const beforeSavedMatchColumns = await columnTypes("saved_matches");
// Pre-flight: the surfaces this delta hangs off must exist. A database that never
// built them must fail LOUDLY here rather than half-run the migration.
if (!beforeSavedMatchColumns.has("bid_id") || !beforeSavedMatchColumns.has("notes")) {
  console.error(
    "[run-059] FAIL: saved_matches does not exist (or lacks bid_id/notes) — the pipeline schema must be applied first",
  );
  process.exit(1);
}
if (before.counts.users === null) {
  console.error("[run-059] FAIL: users does not exist — the base schema must be applied first");
  process.exit(1);
}
const beforeCrm = new Map<string, boolean>();
for (const table of Object.keys(NEW_TABLES)) {
  beforeCrm.set(table, (await columnTypes(table)).size > 0);
}
console.log(
  `[run-059] BEFORE crm tables present: ${
    [...beforeCrm.entries()]
      .map(([t, present]) => `${t}=${present ? "yes" : "no"}`)
      .join(", ") || "(none — first run)"
  }`,
);
console.log(
  `[run-059] BEFORE saved_matches.crm_contact_id present: ${
    beforeSavedMatchColumns.has("crm_contact_id") ? "yes" : "no (first run)"
  }; FK ${FK_NAME} present: ${(await fkDefinition()) ? "yes" : "no"}; ${FUNCTION_NAME} present: ${
    (await functionPresent()) ? "yes" : "no"
  }`,
);
const file = new URL("./059_crm.sql", import.meta.url);
const statements = schemaStatements(readFileSync(file, "utf8")).filter((s) => s.trim().length > 0);
console.log(`[run-059] ${statements.length} statement(s) from 059_crm.sql`);
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
console.log(`[run-059] AFTER: ${after.tables} public table(s)`);
const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-059]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
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
  console.log(
    `[run-059]   ${table}: ${actual.size} column(s), ${newTableRows[table]} row(s)`,
  );
}
shapeProblems.push(
  ...shapeDiff(
    { crm_contact_id: NEW_COLUMNS.crm_contact_id },
    afterSavedMatchColumns,
    NEW_COLUMNS.crm_contact_id.table,
  ),
);
const fk = await fkDefinition();
const fkProblems: string[] = [];
if (!fk) {
  fkProblems.push(`${FK_NAME} MISSING`);
} else if (!fk.startsWith("f:")) {
  fkProblems.push(`${FK_NAME} is not a foreign key (${fk})`);
} else if (
  !/FOREIGN KEY \(user_id, crm_contact_id\) REFERENCES crm_contacts\(user_id, id\)/.test(fk)
) {
  fkProblems.push(`${FK_NAME} has an unexpected definition: ${fk}`);
}
const hasFunction = await functionPresent();
const dataProblems = Object.entries(newTableRows)
  .filter(([, n]) => n !== 0)
  .map(([table, n]) => `${table} has ${n} row(s) (expected 0)`);
console.log(
  `[run-059] ${FK_NAME}: ${fk ?? "(absent)"}`,
);
console.log(
  `[run-059] verify ${JSON.stringify({
    publicTables: `${before.tables} -> ${after.tables}`,
    newTables: Object.keys(NEW_TABLES),
    addedColumns: Object.keys(NEW_COLUMNS),
    fk: fk ?? null,
    functionPresent: hasFunction,
    shapeProblems,
    fkProblems,
    dataProblems,
    rowCountsMoved: moved,
  })}`,
);
if (failed > 0) {
  console.error(`[run-059] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-059] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables + EXPECTED_NEW_TABLES) {
  console.error(
    `[run-059] FAIL: public table count went ${before.tables} -> ${after.tables} (expected +${EXPECTED_NEW_TABLES})`,
  );
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-059] FAIL: the database shape does not match migration 059");
  for (const problem of shapeProblems) console.error(`[run-059]   ${problem}`);
  process.exitCode = 1;
} else if (fkProblems.length > 0) {
  console.error("[run-059] FAIL: the composite FK is not as specified");
  for (const problem of fkProblems) console.error(`[run-059]   ${problem}`);
  process.exitCode = 1;
} else if (dataProblems.length > 0) {
  console.error("[run-059] FAIL: this migration writes no data rows");
  for (const problem of dataProblems) console.error(`[run-059]   ${problem}`);
  process.exitCode = 1;
} else if (!hasFunction) {
  console.error(`[run-059] FAIL: function ${FUNCTION_NAME} is missing`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-059] OK — crm_contacts + crm_activities created (+${EXPECTED_NEW_TABLES} tables), saved_matches.crm_contact_id INTEGER NULLABLE added, ${FK_NAME} present, ${FUNCTION_NAME}() present; additive (no row count moved, both new tables empty)`,
  );
}
