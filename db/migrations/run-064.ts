/**
 * Migration 064 — bids: closed_at / posted_date / archive_date (nightly SAM.gov
 * CSV ingest). The reviewed record is db/migrations/064_bids_closed_and_dates.sql;
 * this runner executes ITS statements, one by one, through the shared
 * dollar-quote-aware splitter, so the file that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-064.ts        (DATABASE_URL must be set)
 *
 * NUMBERING: 063 was the last committed/applied migration on main (hauling_leads,
 * applied to prod 2026-10-16), so the next FREE number is 064.
 *
 * ADDITIVE-ONLY, and the runner proves it. BEFORE and AFTER it counts every public
 * table and the row counts of the surfaces a wrong statement would disturb
 * (`bids` above all), then asserts:
 *   - exactly THREE columns were added to `bids`, all nullable, with the exact
 *     types, and no other column changed;
 *   - every counted surface's row count is UNMOVED (this migration writes no data);
 *   - no table was created or dropped.
 *
 * IDEMPOTENT BY CONSTRUCTION: ADD COLUMN IF NOT EXISTS. Running it twice on
 * purpose is the proof: the second run's BEFORE already shows the three columns,
 * nothing moves, and every assertion still holds.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it
 * exists to be run BY HAND, once, by the operator/lead, PROD-FIRST and BEFORE the
 * read/write code deploys (the 047/051/052/053/058/059/060/062/063 protocol). It
 * prints the target host before its first statement for exactly that reason: in
 * this sandbox the DATABASE_URL in the environment IS production.
 *
 * ROLLBACK: see the header of 064_bids_closed_and_dates.sql.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { schemaStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-064] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-064] target database host: ${new URL(url).hostname} — 3 nullable columns added to bids, no data rows written`,
  );
} catch {
  console.warn("[run-064] target database host: (unparseable DATABASE_URL)");
}

const COUNTED_TABLES = [
  "users",
  "bids",
  "saved_matches",
  "award_leads",
  "subcontract_opportunities",
  "subcontract_primes",
  "hauling_leads",
] as const;

/** The exact shape this migration must add to `bids`. */
const NEW_COLUMNS: Record<string, { type: string; nullable: boolean }> = {
  closed_at: { type: "timestamp with time zone", nullable: true },
  posted_date: { type: "date", nullable: true },
  archive_date: { type: "date", nullable: true },
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
      counts[table] = null;
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
console.log(`[run-064] BEFORE: ${before.tables} public table(s), bids=${before.counts.bids ?? "(absent)"}`);
if (before.counts.users === null || before.counts.bids === null) {
  console.error("[run-064] FAIL: the base schema (users + bids) must exist first");
  process.exit(1);
}
const beforeBids = await columnTypes("bids");
const alreadyPresent = Object.keys(NEW_COLUMNS).filter((c) => beforeBids.has(c));
console.log(
  `[run-064] BEFORE bids columns present: ${alreadyPresent.length ? alreadyPresent.join(", ") : "(none — first run)"}`,
);

const file = new URL("./064_bids_closed_and_dates.sql", import.meta.url);
const statements = schemaStatements(readFileSync(file, "utf8")).filter((s) => s.trim().length > 0);
console.log(`[run-064] ${statements.length} statement(s) from 064_bids_closed_and_dates.sql`);
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
const afterBids = await columnTypes("bids");
const moved = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]);
console.log(`[run-064] AFTER: ${after.tables} public table(s), bids=${after.counts.bids ?? "(absent)"}`);
for (const table of COUNTED_TABLES) {
  const flag = before.counts[table] !== after.counts[table] ? "   <-- CHANGED (not additive!)" : "";
  console.log(`[run-064]   ${table}: ${after.counts[table] ?? "(absent)"}${flag}`);
}

const shapeProblems = shapeDiff(NEW_COLUMNS, afterBids, "bids");
const added = [...afterBids.keys()].filter((c) => !beforeBids.has(c)).sort();
const removed = [...beforeBids.keys()].filter((c) => !afterBids.has(c)).sort();
if (removed.length > 0) shapeProblems.push(`bids columns REMOVED: ${removed.join(", ")}`);
const unexpected = added.filter((c) => !(c in NEW_COLUMNS));
if (unexpected.length > 0) shapeProblems.push(`bids gained unexpected column(s): ${unexpected.join(", ")}`);

console.log(
  `[run-064] verify ${JSON.stringify({
    host: (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })(),
    publicTables: `${before.tables} -> ${after.tables}`,
    addedColumns: added,
    shapeProblems,
    rowCountsMoved: moved,
  })}`,
);

if (failed > 0) {
  console.error(`[run-064] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (moved.length > 0) {
  console.error(`[run-064] FAIL: table(s) changed row count: ${moved.join(", ")}`);
  process.exitCode = 1;
} else if (after.tables !== before.tables) {
  console.error(`[run-064] FAIL: public table count went ${before.tables} -> ${after.tables} (expected no change)`);
  process.exitCode = 1;
} else if (shapeProblems.length > 0) {
  console.error("[run-064] FAIL: the database shape does not match migration 064");
  for (const problem of shapeProblems) console.error(`[run-064]   ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-064] OK — bids.closed_at / posted_date / archive_date present and nullable; additive (no row count moved, no table added, no column removed)${alreadyPresent.length ? " — IDEMPOTENT re-run" : ""}`,
  );
}
