/**
 * Migration 052 — BID WORKSPACE schema delta (owner directive 2026-09-28). The reviewed
 * record is db/migrations/052_bid_workspace.sql — this runner executes ITS statements, one
 * by one, through the shared splitter, so the file that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-052.ts        (DATABASE_URL must be set)
 *
 * ADDITIVE-ONLY, and the runner proves it: BEFORE and AFTER it counts every table in the
 * database plus the row counts of the touched surfaces (users / bids / saved_matches /
 * state_grant_* / the four subcontract tables). Seven columns are added to saved_matches
 * (pursuit_status, next_action, follow_up_date, contact_name, contact_organization,
 * contact_role, contact_email) and NOTHING else may change — the AFTER block fails the run
 * if any table's row count moved, if the public table count moved, or if the seven columns
 * are not present with the right shape.
 *
 * IDEMPOTENT BY CONSTRUCTION: every statement is `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
 * so a second invocation re-writes nothing. Running it twice on purpose is the proof (the
 * second run's BEFORE already shows all seven columns, and nothing moves).
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it exists to
 * be run BY HAND, once, by the operator/lead. It prints the target host before its first
 * statement for exactly that reason: in this sandbox the DATABASE_URL in the environment
 * IS production.
 *
 * ROLLBACK: ALTER TABLE saved_matches DROP COLUMN pursuit_status, DROP COLUMN next_action,
 * DROP COLUMN follow_up_date, DROP COLUMN contact_name, DROP COLUMN contact_organization,
 * DROP COLUMN contact_role, DROP COLUMN contact_email; — the seven columns are new, the
 * pre-existing saved_matches.notes column is untouched, and no row depends on them.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-052] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-052] target database host: ${new URL(url).hostname} — 7 columns added to saved_matches, no data rows written`,
  );
} catch {
  console.warn("[run-052] target database host: (unparseable DATABASE_URL)");
}

/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = [
  "users",
  "bids",
  "saved_matches",
  "state_grant_opportunities",
  "state_grant_sources",
  "subcontract_opportunities",
  "subcontract_sources",
  "subcontract_primes",
  "subcontract_sync_runs",
] as const;

/**
 * The seven columns this migration adds to saved_matches, with the shape each must have.
 *
 * `pursuit_status` is the one NON-nullable addition: `TEXT NOT NULL DEFAULT 'evaluating'`
 * mirrors the product's default so an existing saved bid reads as "evaluating" without a
 * data backfill. The other six are optional and NULLABLE — an existing saved bid keeps
 * NULL, which the read paths render as empty strings.
 */
const NEW_COLUMNS: Record<string, { type: string; nullable: boolean }> = {
  pursuit_status: { type: "text", nullable: false },
  next_action: { type: "text", nullable: true },
  follow_up_date: { type: "date", nullable: true },
  contact_name: { type: "text", nullable: true },
  contact_organization: { type: "text", nullable: true },
  contact_role: { type: "text", nullable: true },
  contact_email: { type: "text", nullable: true },
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
    WHERE table_schema = 'public' AND table_name = 'saved_matches'
  `) as { column_name: string; data_type: string; is_nullable: string }[];
  return new Map(rows.map((r) => [r.column_name, `${r.data_type}:${r.is_nullable}`]));
}

const before = await snapshot();
console.log(`[run-052] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-052]   ${table}: ${value === null ? "(absent)" : value}`);
}

const beforeColumns = await columnTypes();
const file = new URL("./052_bid_workspace.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter(
  (s) => s.trim().length > 0,
);

// Pre-flight: the target table must exist (052 is a delta on the saved_matches table that
// migration 043 created). A database that never built the pipeline table must fail LOUDLY
// here rather than silently writing nothing.
if (!beforeColumns.has("bid_id") || !beforeColumns.has("notes")) {
  console.error(
    "[run-052] FAIL: saved_matches does not exist (or lacks bid_id/notes) — the pipeline schema must be applied first",
  );
  process.exit(1);
}
console.log(
  `[run-052] BEFORE saved_matches columns already carrying this migration: ${
    Object.keys(NEW_COLUMNS).filter((c) => beforeColumns.has(c)).join(", ") || "(none — first run)"
  }`,
);
console.log(`[run-052] ${statements.length} statement(s) from 052_bid_workspace.sql`);

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
console.log(`[run-052] AFTER: ${after.tables} public table(s)`);

const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-052]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
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
  `[run-052] verify ${JSON.stringify({
    publicTables: after.tables,
    addedColumns: Object.keys(NEW_COLUMNS),
    shapeProblems,
    rowCountsMoved: moved,
  })}`,
);

if (failed > 0) {
  console.error(`[run-052] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-052] FAIL: the database shape does not match migration 052");
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-052] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables) {
  console.error(
    `[run-052] FAIL: public table count went ${before.tables} -> ${after.tables} (expected no change)`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "[run-052] OK — 7/7 columns present on saved_matches, additive (no row count moved, no new table)",
  );
}
