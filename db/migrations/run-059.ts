/**
 * Migration 059 — BID TABULATIONS schema delta (Phase-1 build, ALDOT source).
 * The reviewed record is db/migrations/059_bid_tabulations.sql — this runner
 * executes ITS statements, one by one, through the shared splitter, so the file
 * that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-059.ts        (DATABASE_URL must be set)
 *
 * NUMBERING: 058 (tracked_bids.source) is the highest applied/committed number on
 * this branch's base, so 059 is the next free number. Nothing was overwritten.
 *
 * ADDITIVE-ONLY, and the runner proves it:
 *   - BEFORE / AFTER: every public table is counted and the row counts of the
 *     surfaces that must NOT move are compared (users / bids / tracked_bids /
 *     saved_matches / nonprofit_applications / state_grant_* / subcontract_*).
 *     Any moved row count fails the run.
 *   - This migration CREATES tables, so the expected table-count delta is exactly
 *     +3 on a first run and 0 on a re-run (idempotency). It refuses to accept any
 *     other delta.
 *   - AFTER: the three tables must exist with the exact column shape below
 *     (type + nullable) and the link table's match_kind CHECK must be present.
 *
 * IDEMPOTENT BY CONSTRUCTION: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
 * EXISTS only.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it is
 * run BY HAND, once, by the operator/lead. It prints the target host before its
 * first statement for exactly that reason: in this sandbox the DATABASE_URL in the
 * environment IS production.
 *
 * ROLLBACK: DROP TABLE IF EXISTS bid_tabulation_links, bid_tabulation_bidders,
 * bid_tabulations; — nothing else references them.
 *
 * SAFETY NOTE: `bids` already exists in every environment this runs against (it is
 * created by the base schema); the failing behaviour of a missing `bids` is a
 * loud error at the link table, never a silently-created stand-in.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-059] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-059] target database host: ${new URL(url).hostname} — 3 NEW tables (bid_tabulations, bid_tabulation_bidders, bid_tabulation_links), no data rows written`,
  );
} catch {
  console.warn("[run-059] target database host: (unparseable DATABASE_URL)");
}

/** The three tables this migration creates, and the shape each must have. */
const NEW_TABLES: Record<string, Record<string, { type: string; nullable: boolean }>> = {
  bid_tabulations: {
    id: { type: "integer", nullable: false },
    source: { type: "text", nullable: false },
    source_project_id: { type: "text", nullable: true },
    reference_number: { type: "text", nullable: true },
    project_number: { type: "text", nullable: true },
    agency: { type: "text", nullable: true },
    title: { type: "text", nullable: true },
    bid_opened_on: { type: "date", nullable: true },
    tabulation_type: { type: "text", nullable: true },
    bidders_count: { type: "integer", nullable: true },
    low_amount: { type: "numeric", nullable: true },
    high_amount: { type: "numeric", nullable: true },
    source_url: { type: "text", nullable: false },
    source_published: { type: "date", nullable: true },
    raw_format: { type: "text", nullable: true },
    fetched_at: { type: "timestamp with time zone", nullable: true },
    scanned: { type: "boolean", nullable: true },
    extraction_note: { type: "text", nullable: true },
  },
  bid_tabulation_bidders: {
    id: { type: "integer", nullable: false },
    tabulation_id: { type: "integer", nullable: false },
    bidder_name: { type: "text", nullable: false },
    bid_amount: { type: "numeric", nullable: true },
    source_url: { type: "text", nullable: false },
  },
  bid_tabulation_links: {
    bid_id: { type: "integer", nullable: false },
    tabulation_id: { type: "integer", nullable: false },
    match_kind: { type: "text", nullable: false },
    match_value: { type: "text", nullable: false },
    created_at: { type: "timestamp with time zone", nullable: true },
  },
};

/** The surfaces whose row counts must NOT move (a migration adds shape, not data). */
const COUNTED_TABLES = [
  "users",
  "bids",
  "tracked_bids",
  "saved_matches",
  "nonprofit_applications",
  "state_grant_opportunities",
  "subcontract_opportunities",
  "subcontract_primes",
  "subcontract_sync_runs",
] as const;

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

async function linkCheckConstraint(): Promise<string | null> {
  const rows = (await sql`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'bid_tabulation_links' AND c.contype = 'c'
    LIMIT 1
  `) as { def: string }[];
  return rows[0]?.def ?? null;
}

const before = await snapshot();
console.log(`[run-059] BEFORE: ${before.tables} public table(s)`);
for (const table of COUNTED_TABLES) {
  const value = before.counts[table];
  console.log(`[run-059]   ${table}: ${value === null ? "(absent)" : value}`);
}

const file = new URL("./059_bid_tabulations.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter(
  (s) => s.trim().length > 0,
);
console.log(`[run-059] executing ${statements.length} statement(s) from 059_bid_tabulations.sql`);
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
console.log(`[run-059] AFTER: ${after.tables} public table(s)`);
const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
for (const table of COUNTED_TABLES) {
  const value = after.counts[table];
  const flag = before.counts[table] !== value ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-059]   ${table}: ${value === null ? "(absent)" : value}${flag}`);
}

const shapeProblems: string[] = [];
for (const [table, columns] of Object.entries(NEW_TABLES)) {
  const actual = await columnTypes(table);
  if (actual.size === 0) {
    shapeProblems.push(`${table} MISSING`);
    continue;
  }
  for (const [column, expected] of Object.entries(columns)) {
    const type = actual.get(column);
    if (!type) {
      shapeProblems.push(`${table}.${column} MISSING`);
      continue;
    }
    if (!type.startsWith(`${expected.type}:`)) {
      shapeProblems.push(`${table}.${column} is ${type}, expected ${expected.type}`);
      continue;
    }
    if (type.endsWith(":YES") !== expected.nullable) {
      shapeProblems.push(
        `${table}.${column} is ${type.endsWith(":YES") ? "nullable" : "NOT NULL"} (${type}), expected ${expected.nullable ? "nullable" : "NOT NULL"}`,
      );
    }
  }
}
const check = await linkCheckConstraint();
if (!check || !/match_kind/.test(check)) {
  shapeProblems.push("bid_tabulation_links has no match_kind CHECK constraint");
} else {
  for (const kind of ["reference_number", "project_number", "predecessor_named"]) {
    if (!check.includes(kind)) shapeProblems.push(`match_kind CHECK is missing '${kind}': ${check}`);
  }
  if (/title|fuzzy|agency/i.test(check)) {
    shapeProblems.push(`match_kind CHECK accepts a non-provable kind: ${check}`);
  }
}

const delta = after.tables - before.tables;
const deltaOk = delta === 0 || delta === 3;
console.log(
  `[run-059] verify ${JSON.stringify({
    publicTables: after.tables,
    tableDelta: delta,
    addedTables: Object.keys(NEW_TABLES),
    matchKindCheck: check,
    shapeProblems,
    rowCountsMoved: moved,
  })}`,
);
if (failed > 0) {
  console.error(`[run-059] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (!deltaOk) {
  console.error(
    `[run-059] FAIL: public table count went ${before.tables} -> ${after.tables} (expected +3 on a first run, 0 on a re-run)`,
  );
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-059] FAIL: the database shape does not match migration 059");
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-059] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-059] OK — 3/3 tables present (bid_tabulations, bid_tabulation_bidders, bid_tabulation_links) with the reviewed shape, additive (no row count moved, +${delta} table(s))`,
  );
}
