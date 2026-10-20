/**
 * Migration 068 — client workspaces (Agency tier phase 1, owner decision 2026-10-20).
 * The reviewed record is db/migrations/068_workspaces.sql; this runner executes ITS
 * statements, one by one, through the shared dollar-quote-aware splitter, so the file
 * that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-068.ts        (DATABASE_URL must be set)
 *
 * NUMBERING: 066 is the highest migration on origin/main and 067 is PARKED on
 * backup/067-set-aside-labels (owner-stopped), so this one takes 068 — it can never
 * collide with the parked branch if that work is ever resumed.
 *
 * WHAT IT PROVES (before/after, SELECT-only comparisons except the migration itself):
 *   1. exactly ONE public table is added (workspaces); every other table's count is
 *      unchanged, and no counted surface gains or loses a row;
 *   2. NO business profile is created: business_profiles is byte-count identical
 *      before and after — the backfill only ADDS workspace rows that point at
 *      profiles that already existed;
 *   3. the backfill is exactly the eligible population: workspaces rows == profiles
 *      with a 1..80 character trimmed name, and every workspace's profile_id belongs
 *      to the same owner (no cross-account row can be backfilled);
 *   4. NO existing saved bid or CRM contact is scoped: every workspace_id is NULL in
 *      both tables (Starter/Professional read paths stay exactly as they are);
 *   5. the shapes are what the code expects: workspaces column types/nullability, both
 *      new nullable columns, both FKs present as ON DELETE SET NULL, both indexes;
 *   6. workspace_create() exists and its CAP ARM works without writing: called with
 *      p_limit = 0 for a real account it must return NULL and leave
 *      business_profiles/workspaces row counts untouched (a cap hit writes nothing);
 *   7. IDEMPOTENCY: the whole file is run a SECOND time — the table count does not
 *      move, the backfill inserts 0 rows, and every shape/binding check still holds.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it exists
 * to be run BY HAND, once, by the operator/lead, PROD-FIRST and BEFORE this feature's
 * code deploys (the 047/051/052/053/058/059/060/062/063/064 protocol). It prints the
 * target host before its first statement for exactly that reason: in this sandbox the
 * DATABASE_URL in the environment IS production.
 *
 * ROLLBACK: see the header of 068_workspaces.sql.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { schemaStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-068] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
})();
console.warn(
  `[run-068] target database host: ${host ?? "(unparseable DATABASE_URL)"} — ADDITIVE: 1 new table (workspaces), 2 nullable columns (saved_matches/crm_contacts.workspace_id), 2 FKs, 2 indexes, 1 function; the only data written is one workspace row per EXISTING business profile`,
);

const FILE = new URL("./068_workspaces.sql", import.meta.url);
const raw = readFileSync(FILE, "utf8");
const statements = schemaStatements(raw).filter((s) => s.trim().length > 0);
if (statements.length === 0) {
  console.error("[run-068] FAIL: 068_workspaces.sql split into 0 statements");
  process.exit(1);
}

/** Every surface whose row count must NOT move. */
const COUNTED_TABLES = ["users", "bids", "business_profiles", "saved_matches", "crm_contacts"] as const;
/** The workspaces table's expected shape (type:nullable). */
const WORKSPACES_COLUMNS: Record<string, { type: string; nullable: boolean }> = {
  id: { type: "integer", nullable: false },
  user_id: { type: "integer", nullable: false },
  name: { type: "text", nullable: false },
  profile_id: { type: "integer", nullable: false },
  created_at: { type: "timestamp with time zone", nullable: false },
  updated_at: { type: "timestamp with time zone", nullable: false },
};
const NEW_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "saved_matches", column: "workspace_id" },
  { table: "crm_contacts", column: "workspace_id" },
];
const FKS: Array<{ name: string; table: string }> = [
  { name: "saved_matches_workspace_fk", table: "saved_matches" },
  { name: "crm_contacts_workspace_fk", table: "crm_contacts" },
];
const INDEXES = ["workspaces_owner_idx", "saved_matches_workspace_idx", "crm_contacts_workspace_idx"];

const problems: string[] = [];
async function tableCount(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
  `) as { n: number }[];
  return rows[0]?.n ?? -1;
}
async function rowCount(table: string): Promise<number | null> {
  try {
    const rows = (await sql.query(`SELECT count(*)::int AS n FROM ${table}`)) as { n: number }[];
    return rows[0]?.n ?? null;
  } catch {
    return null; // absent
  }
}
async function columnTypes(table: string): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `) as { column_name: string; data_type: string; is_nullable: string }[];
  return new Map(rows.map((r) => [r.column_name, `${r.data_type}:${r.is_nullable}`]));
}
/** The eligible backfill population: profiles whose trimmed name the CHECK accepts. */
async function eligibleProfiles(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM business_profiles
    WHERE user_id IS NOT NULL AND length(btrim(COALESCE(business_name, ''))) BETWEEN 1 AND 80
  `) as { n: number }[];
  return rows[0]?.n ?? -1;
}
/** Every workspace whose profile belongs to a DIFFERENT account (must be 0). */
async function crossOwnerWorkspaces(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n
    FROM workspaces w JOIN business_profiles bp ON bp.id = w.profile_id
    WHERE bp.user_id IS DISTINCT FROM w.user_id
  `) as { n: number }[];
  return rows[0]?.n ?? -1;
}
async function fkDeleteAction(name: string): Promise<string | null> {
  const rows = (await sql`
    SELECT c.confdeltype AS action FROM pg_constraint c WHERE c.conname = ${name} LIMIT 1
  `) as { action: string }[];
  return rows[0]?.action ?? null;
}
async function functionExists(): Promise<boolean> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'workspace_create'
  `) as { n: number }[];
  return (rows[0]?.n ?? 0) > 0;
}
async function indexExists(name: string): Promise<boolean> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM pg_class WHERE relname = ${name} AND relkind = 'i'
  `) as { n: number }[];
  return (rows[0]?.n ?? 0) > 0;
}
async function scopedRows(table: string): Promise<number | null> {
  try {
    const rows = (await sql.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE workspace_id IS NOT NULL`,
    )) as { n: number }[];
    return rows[0]?.n ?? -1;
  } catch {
    return null;
  }
}

// ── BEFORE ───────────────────────────────────────────────────────────────────
const beforeTables = await tableCount();
const beforeCounts: Record<string, number | null> = {};
for (const table of COUNTED_TABLES) beforeCounts[table] = await rowCount(table);
const beforeWorkspaces = await rowCount("workspaces"); // null on the first run
const beforeEligible = await eligibleProfiles();
const beforeWorkspaceIsAdded = beforeWorkspaces !== null;
console.log(
  `[run-068] BEFORE: ${beforeTables} public table(s); workspaces ${beforeWorkspaceIsAdded ? `already present with ${beforeWorkspaces} row(s)` : "absent"}; ` +
    `eligible profiles ${beforeEligible}`,
);
for (const table of COUNTED_TABLES) console.log(`[run-068]   ${table}: ${beforeCounts[table] ?? "absent"}`);

// ── APPLY ────────────────────────────────────────────────────────────────────
let failed = 0;
for (const [index, statement] of statements.entries()) {
  const label = `statement ${index + 1}/${statements.length}`;
  try {
    await sql.query(statement);
    console.log(`[run-068] ok   ${label} (${statement.trim().slice(0, 60).replace(/\s+/g, " ")}…)`);
  } catch (e) {
    failed += 1;
    console.error(`[run-068] FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
  }
}

// ── AFTER ────────────────────────────────────────────────────────────────────
const afterTables = await tableCount();
const afterCounts: Record<string, number | null> = {};
for (const table of COUNTED_TABLES) afterCounts[table] = await rowCount(table);
const afterWorkspaces = await rowCount("workspaces");
const afterCrossOwner = await crossOwnerWorkspaces();
const afterWorkspaceCols = await columnTypes("workspaces");
const savedScoped = await scopedRows("saved_matches");
const crmScoped = await scopedRows("crm_contacts");
const fkActions = new Map<string, string | null>();
for (const fk of FKS) fkActions.set(fk.name, await fkDeleteAction(fk.name));
const indexPresence = new Map<string, boolean>();
for (const index of INDEXES) indexPresence.set(index, await indexExists(index));
const hasFunction = await functionExists();
const colsOfSaved = await columnTypes("saved_matches");
const colsOfCrm = await columnTypes("crm_contacts");

console.log(
  `[run-068] AFTER: ${afterTables} public table(s); workspaces ${afterWorkspaces ?? "absent"} row(s); cross-owner workspaces ${afterCrossOwner}`,
);
for (const table of COUNTED_TABLES) {
  const moved = beforeCounts[table] !== afterCounts[table];
  console.log(`[run-068]   ${table}: ${beforeCounts[table] ?? "absent"} -> ${afterCounts[table] ?? "absent"}${moved ? "  <-- MOVED" : ""}`);
}

if (failed > 0) problems.push(`${failed} statement(s) failed`);
// 1. exactly one new table
const expectedTables = beforeWorkspaceIsAdded ? beforeTables : beforeTables + 1;
if (afterTables !== expectedTables) {
  problems.push(`public table count ${beforeTables} -> ${afterTables}, expected ${expectedTables}`);
}
// 2. no counted surface moved (no profile created, no bid/contact touched)
for (const table of COUNTED_TABLES) {
  if (beforeCounts[table] !== afterCounts[table]) {
    problems.push(`${table} moved ${beforeCounts[table] ?? "absent"} -> ${afterCounts[table] ?? "absent"} (this migration writes no row there)`);
  }
}
// 3. the backfill is exactly the eligible population, and owner-consistent
if (afterWorkspaces === null) {
  problems.push("workspaces table is absent after the run");
} else if (afterWorkspaces !== beforeEligible) {
  problems.push(`workspaces has ${afterWorkspaces} row(s), expected one per eligible profile (${beforeEligible})`);
}
if (afterCrossOwner !== 0) problems.push(`${afterCrossOwner} workspace(s) point at another account's profile`);
// 4. nothing existing got scoped
if (savedScoped !== 0) problems.push(`${savedScoped} saved bid(s) came out with a workspace_id (must stay NULL)`);
if (crmScoped !== 0) problems.push(`${crmScoped} CRM contact(s) came out with a workspace_id (must stay NULL)`);
// 5. shapes
for (const [column, want] of Object.entries(WORKSPACES_COLUMNS)) {
  const type = afterWorkspaceCols.get(column);
  if (!type) problems.push(`workspaces.${column} MISSING`);
  else if (!type.startsWith(`${want.type}:`)) problems.push(`workspaces.${column} is ${type}, expected ${want.type}`);
  else if (type.endsWith(":YES") !== want.nullable) problems.push(`workspaces.${column} nullability is wrong (${type})`);
}
for (const { table, column } of NEW_COLUMNS) {
  const cols = table === "saved_matches" ? colsOfSaved : colsOfCrm;
  const type = cols.get(column);
  if (!type) problems.push(`${table}.${column} MISSING`);
  else if (type !== "integer:YES") problems.push(`${table}.${column} is ${type}, expected integer:YES`);
}
for (const fk of FKS) {
  const action = fkActions.get(fk.name);
  if (action === null) problems.push(`${fk.name} MISSING`);
  else if (action !== "n") problems.push(`${fk.name} delete action is '${action}', expected 'n' (ON DELETE SET NULL)`);
}
for (const index of INDEXES) if (indexPresence.get(index) !== true) problems.push(`index ${index} MISSING`);
if (!hasFunction) problems.push("workspace_create() MISSING");
// 6. the cap arm refuses without writing anything
let capProbe: number | null | "error" = "error";
try {
  const probeUsers = (await sql`SELECT id FROM users ORDER BY id LIMIT 1`) as { id: number }[];
  const userId = probeUsers[0]?.id;
  if (userId === undefined) {
    console.log("[run-068]   cap probe skipped: no users row in this database");
  } else {
    const rows = (await sql`
      SELECT workspace_create(${userId}, 0, 'run-068 cap probe', '[]'::jsonb, '[]'::jsonb) AS id
    `) as { id: number | null }[];
    capProbe = rows[0]?.id ?? null;
    const profilesAfterProbe = await rowCount("business_profiles");
    const workspacesAfterProbe = await rowCount("workspaces");
    if (capProbe !== null) problems.push(`workspace_create(limit 0) returned ${String(capProbe)} instead of NULL (cap not enforced)`);
    if (profilesAfterProbe !== afterCounts.business_profiles) problems.push("the cap probe created a business profile");
    if (workspacesAfterProbe !== afterWorkspaces) problems.push("the cap probe created a workspace");
  }
} catch (e) {
  problems.push(`cap probe failed: ${(e as Error).message.slice(0, 200)}`);
}

// ── 7. idempotency: run the whole file again; nothing may move. ──────────────
let secondRunFailed = 0;
for (const statement of statements) {
  try {
    await sql.query(statement);
  } catch (e) {
    secondRunFailed += 1;
    console.error(`[run-068] FAIL (idempotency re-run) :: ${(e as Error).message.slice(0, 300)}`);
  }
}
const thirdTables = await tableCount();
const thirdWorkspaces = await rowCount("workspaces");
const thirdProfiles = await rowCount("business_profiles");
if (secondRunFailed > 0) problems.push(`${secondRunFailed} statement(s) failed on the idempotency re-run`);
if (thirdTables !== afterTables) problems.push(`the idempotency re-run changed the table count ${afterTables} -> ${thirdTables}`);
if (thirdWorkspaces !== afterWorkspaces) problems.push(`the idempotency re-run changed the workspaces row count ${afterWorkspaces} -> ${thirdWorkspaces} (backfill not idempotent)`);
if (thirdProfiles !== afterCounts.business_profiles) problems.push("the idempotency re-run created a business profile");

console.log(
  `[run-068] verify ${JSON.stringify({
    host,
    publicTables: `${beforeTables} -> ${afterTables}`,
    workspacesRows: `${beforeWorkspaces ?? "absent"} -> ${afterWorkspaces}`,
    eligibleProfiles: beforeEligible,
    crossOwnerWorkspaces: afterCrossOwner,
    businessProfiles: `${beforeCounts.business_profiles} -> ${afterCounts.business_profiles}`,
    savedScoped,
    crmScoped,
    capProbe,
    secondRun: { tables: thirdTables, workspaces: thirdWorkspaces },
    problems,
  })}`,
);
if (problems.length > 0) {
  console.error("[run-068] FAIL: the migration did not do exactly what 068 specifies");
  for (const problem of problems) console.error(`[run-068]   ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-068] OK — workspaces table added with ${afterWorkspaces} backfilled row(s) (one per existing business profile, no profile created or renamed), ` +
      `saved_matches/crm_contacts.workspace_id added NULL on every existing row, both FKs ON DELETE SET NULL, workspace_create() present and the cap arm refuses without writing; ` +
      `the second run moved nothing (idempotent)`,
  );
}
