/**
 * Migration 065 — relabel the 4,134 stored set-aside "8(a)" mislabels (owner-approved 2026-10-19).
 *
 * The reviewed record is db/migrations/065_bids_set_aside_relabel.sql — this runner
 * executes ITS statements, one by one, through the shared splitter, so the file that is
 * reviewed is the file that runs. The runner also PARSES the two external_id lists out
 * of that same file and uses them as the expected sets, so the exception list cannot
 * drift from what is checked.
 *
 *   bun run db/migrations/run-065.ts        (DATABASE_URL must be set)
 *
 * NUMBERING: the highest pair on main is 064_bids_closed_and_dates.sql + run-064.ts, so
 * this migration takes the next FREE pair: 065_*.sql + run-065.ts. Nothing overwritten.
 *
 * SPLITTER: the record is two plain `UPDATE … RETURNING id` statements with no `;`
 * inside a statement and no dollar-quoted body, so `migrationStatements()` (the
 * `;`-only splitter) is the correct one — schemaStatements() is not needed.
 *
 * WHAT IT PROVES (before/after, all SELECT-only comparisons):
 *   1. the bids row count is unchanged (no insert, no delete);
 *   2. the `set_aside` histogram moves ONLY by this migration: "8(a)" loses exactly the
 *      rows the two statements moved, "Small Business Set Aside - Total" gains exactly
 *      the statement-1 count, NULL gains exactly the statement-2 count, and no other
 *      bucket moves at all;
 *   3. EVERY exception id named in the file is still "8(a)" after the run (the 63 real
 *      8A rows, the 10 real 8AN rows, the 9 rows with no published set-aside and the 3
 *      rows carrying another designation) — the assertion that this migration does not
 *      delete a real 8(a) opportunity;
 *   4. every statement-2 id now reads NULL (SAM says "NONE" for those notices);
 *   5. the statements return exactly the ids they moved, and each returned id is inside
 *      the set the file names (the WHERE clause cannot reach any other row) — so the
 *      returned count IS the blast radius;
 *   6. IDEMPOTENCY: both statements are run a SECOND time; they must return 0 ids, move
 *      nothing and leave the histogram identical. That is the proof the file is safe to
 *      re-run (the `set_aside = '8(a)'` guard plus the frozen created_at cut-off).
 *
 * REPORTING: the BEFORE section prints the per-bucket counts and the per-group evidence
 * split (how many of the stored "8(a)" rows SAM's detail API recorded as SBA / 8A / 8AN
 * / NONE / other), which is the table quoted in the PR body and in the .sql header.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, a CI job or a scheduled task — it
 * exists to be run BY HAND, once, by the operator/lead. It prints the target host before
 * its first statement for exactly that reason: in this sandbox the DATABASE_URL in the
 * environment IS production. Nothing here writes anything but `bids.set_aside`.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-065] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-065] target database host: ${new URL(url).hostname} — DATA migration: relabels bids.set_aside on the SAM rows the "SBA" -> "8(a)" mapping bug mislabeled (no DDL, no insert, no delete, no other column)`,
  );
} catch {
  console.warn("[run-065] target database host: (unparseable DATABASE_URL)");
}

const FILE = new URL("./065_bids_set_aside_relabel.sql", import.meta.url);
const raw = readFileSync(FILE, "utf8");
const statements = migrationStatements(raw).filter((s) => s.trim().length > 0);
if (statements.length !== 2) {
  console.error(
    `[run-065] FAIL: expected exactly 2 statements in 065_bids_set_aside_relabel.sql, found ${statements.length}`,
  );
  process.exit(1);
}
/** The external_id lists the file itself names — the expected sets, parsed, never typed twice. */
const idLists = statements.map((s) => [...s.matchAll(/'(sam-[0-9a-f]{32})'/g)].map((m) => m[1]!));
const EXCEPTION_IDS = idLists[0]!; // statement 1's NOT IN list: real 8(a)/8AN/other, kept
const NONE_IDS = idLists[1]!; // statement 2's IN list: SAM says no set-aside at all
/** Held as data so the drift is caught, not just documented. */
const EXPECTED = { exception: 100, none: 15, statements: 2 };
const TARGET_LABEL = "Small Business Set Aside - Total";

const problems: string[] = [];
if (EXCEPTION_IDS.length !== EXPECTED.exception) {
  problems.push(`statement 1 names ${EXCEPTION_IDS.length} exception ids, expected ${EXPECTED.exception}`);
}
if (NONE_IDS.length !== EXPECTED.none) {
  problems.push(`statement 2 names ${NONE_IDS.length} ids, expected ${EXPECTED.none}`);
}
if (new Set(EXCEPTION_IDS).size !== EXCEPTION_IDS.length) problems.push("statement 1's exception list repeats an id");
if (new Set(NONE_IDS).size !== NONE_IDS.length) problems.push("statement 2's list repeats an id");
if (NONE_IDS.some((id) => EXCEPTION_IDS.includes(id))) {
  problems.push("an id is in BOTH lists (statement 2 would null a row statement 1 is told to keep)");
}
for (const s of statements) {
  if (/\b(delete|insert|truncate|drop|alter|create)\b/i.test(s)) {
    problems.push(`statement is not an UPDATE-only record: ${s.slice(0, 80)}`);
  }
  if (!/^\s*UPDATE\s+bids\s/i.test(s)) problems.push(`statement does not start with UPDATE bids: ${s.slice(0, 60)}`);
}

const quote = (ids: string[]) => ids.map((id) => `'${id}'`).join(", ");
async function bucketCounts(): Promise<Map<string, number>> {
  const rows = (await sql`
    SELECT COALESCE(set_aside, '(null)') AS v, count(*)::int AS n FROM bids GROUP BY 1
  `) as { v: string; n: number }[];
  return new Map(rows.map((r) => [r.v, r.n]));
}
async function totalBids(): Promise<number> {
  const rows = (await sql`SELECT count(*)::int AS n FROM bids`) as { n: number }[];
  return rows[0]?.n ?? -1;
}
async function countIn(ids: string[], label: string): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = (await sql.query(
    `SELECT count(*)::int AS n FROM bids WHERE set_aside = '${label}' AND external_id IN (${quote(ids)})`,
  )) as { n: number }[];
  return rows[0]?.n ?? -1;
}
function bucketDiff(before: Map<string, number>, after: Map<string, number>): string[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  return keys
    .filter((k) => (before.get(k) ?? 0) !== (after.get(k) ?? 0))
    .map((k) => `${k}: ${before.get(k) ?? 0} -> ${after.get(k) ?? 0}`);
}
/** SAM's detail-API verdict recorded for each stored row, as measured 2026-10-19. */
const EVIDENCE_SPLIT = [
  ["SBA", 4126],
  ["[\"SBA\"] (array form of the same code)", 1],
  ["8A (real 8(a))", 63],
  ["8AN (real 8(a) sole source)", 10],
  ["NONE (no set-aside at all)", 15],
  ["(nothing published)", 9],
  ["WOSB / WOSBSS / SBP", 3],
  ["(aged out — 404)", 7],
] as const;

console.log("[run-065] BEFORE");
const beforeTotal = await totalBids();
const beforeBuckets = await bucketCounts();
console.log(
  `[run-065]   bids rows: ${beforeTotal}; set_aside='8(a)': ${beforeBuckets.get("8(a)") ?? 0}; ` +
    `set_aside='${TARGET_LABEL}': ${beforeBuckets.get(TARGET_LABEL) ?? 0}; set_aside IS NULL: ${beforeBuckets.get("(null)") ?? 0}`,
);
console.log("[run-065]   stored '8(a)' rows by SAM's own record (detail API, 2026-10-19):");
for (const [what, n] of EVIDENCE_SPLIT) console.log(`[run-065]     ${String(n).padStart(6)}  ${what}`);
console.log(
  `[run-065]   file names ${EXCEPTION_IDS.length} exception ids (kept) and ${NONE_IDS.length} NONE ids (nulled)`,
);

const beforeExceptionEightA = await countIn(EXCEPTION_IDS, "8(a)");
const beforeNoneEightA = await countIn(NONE_IDS, "8(a)");
console.log(
  `[run-065]   exception ids currently '8(a)': ${beforeExceptionEightA}/${EXCEPTION_IDS.length}; NONE ids currently '8(a)': ${beforeNoneEightA}/${NONE_IDS.length}`,
);

console.log("[run-065] APPLYING");
let moved = 0;
let failed = 0;
for (const statement of statements) {
  const tag = statement.includes("SET set_aside = NULL") ? "statement 2 (NONE -> NULL)" : "statement 1 (SBA -> total small business)";
  try {
    const returned = (await sql.query(statement)) as { id: number }[];
    moved += returned.length;
    console.log(`[run-065] ok   ${tag}: ${returned.length} row(s) moved`);
  } catch (e) {
    failed += 1;
    console.error(`[run-065] FAIL ${tag} :: ${(e as Error).message.slice(0, 300)}`);
  }
}

console.log("[run-065] AFTER");
const afterTotal = await totalBids();
const afterBuckets = await bucketCounts();
console.log(
  `[run-065]   bids rows: ${afterTotal}; set_aside='8(a)': ${afterBuckets.get("8(a)") ?? 0}; ` +
    `set_aside='${TARGET_LABEL}': ${afterBuckets.get(TARGET_LABEL) ?? 0}; set_aside IS NULL: ${afterBuckets.get("(null)") ?? 0}`,
);
const afterExceptionEightA = await countIn(EXCEPTION_IDS, "8(a)");
const afterNoneEightA = await countIn(NONE_IDS, "8(a)");
const afterNoneNull = (await sql.query(
  `SELECT count(*)::int AS n FROM bids WHERE set_aside IS NULL AND external_id IN (${quote(NONE_IDS)})`,
)) as { n: number }[];

// 6. idempotency: run the same statements again; nothing may move.
let secondRunMoved = 0;
for (const statement of statements) {
  const returned = (await sql.query(statement)) as { id: number }[];
  secondRunMoved += returned.length;
}
const afterSecondTotal = await totalBids();
const afterSecondBuckets = await bucketCounts();

if (failed > 0) problems.push(`${failed} statement(s) failed`);
if (afterTotal !== beforeTotal) problems.push(`bids row count moved ${beforeTotal} -> ${afterTotal} (not data-only)`);
if (afterSecondTotal !== afterTotal) problems.push(`bids row count moved on the second (idempotency) run`);
if (secondRunMoved !== 0) problems.push(`the idempotency re-run moved ${secondRunMoved} row(s), expected 0`);
const secondDiff = bucketDiff(afterBuckets, afterSecondBuckets);
if (secondDiff.length > 0) problems.push(`the idempotency re-run changed the set_aside histogram: ${secondDiff.join(", ")}`);

const beforeEightA = beforeBuckets.get("8(a)") ?? 0;
const afterEightA = afterBuckets.get("8(a)") ?? 0;
// The file names 100 exception rows; 15 of them (the NONE rows) statement 2 nulls, so
// the rows that must STILL read "8(a)" afterwards are the other 85.
const expectedAfterEightA = EXCEPTION_IDS.length - NONE_IDS.length;
if (afterEightA !== expectedAfterEightA) {
  problems.push(`after: '8(a)' is ${afterEightA}, expected ${expectedAfterEightA} (the exception rows only)`);
}
if (afterExceptionEightA !== expectedAfterEightA) {
  problems.push(
    `after: only ${afterExceptionEightA}/${expectedAfterEightA} kept exception ids still read '8(a)' — a real 8(a)/8AN row lost its label`,
  );
}
if (afterNoneEightA !== 0) problems.push(`after: ${afterNoneEightA} NONE ids still read '8(a)'`);
if ((afterNoneNull[0]?.n ?? -1) !== NONE_IDS.length) {
  problems.push(`after: only ${afterNoneNull[0]?.n ?? "?"}/${NONE_IDS.length} NONE ids read NULL`);
}
if (afterEightA > beforeEightA) problems.push(`after: '8(a)' grew ${beforeEightA} -> ${afterEightA}`);
const totalDelta = (afterBuckets.get(TARGET_LABEL) ?? 0) - (beforeBuckets.get(TARGET_LABEL) ?? 0);
const nullDelta = (afterBuckets.get("(null)") ?? 0) - (beforeBuckets.get("(null)") ?? 0);
const eightADelta = beforeEightA - afterEightA;
if (eightADelta !== moved) {
  problems.push(`'8(a)' lost ${eightADelta} rows but the statements reported moving ${moved}`);
}
if (totalDelta + nullDelta !== eightADelta) {
  problems.push(
    `histogram does not balance: '8(a)' lost ${eightADelta}, '${TARGET_LABEL}' gained ${totalDelta}, NULL gained ${nullDelta}`,
  );
}

console.log(
  `[run-065] verify ${JSON.stringify({
    host: (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })(),
    bidsRows: `${beforeTotal} -> ${afterTotal}`,
    eightA: `${beforeEightA} -> ${afterEightA} (kept: the ${EXCEPTION_IDS.length} exception rows)`,
    targetLabel: `${beforeBuckets.get(TARGET_LABEL) ?? 0} -> ${afterBuckets.get(TARGET_LABEL) ?? 0}`,
    nullSetAside: `${beforeBuckets.get("(null)") ?? 0} -> ${afterBuckets.get("(null)") ?? 0}`,
    moved,
    secondRunMoved,
    problems,
  })}`,
);
if (problems.length > 0) {
  console.error("[run-065] FAIL: the relabel did not do exactly what migration 065 specifies");
  for (const problem of problems) console.error(`[run-065]   ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-065] OK — ${moved} row(s) relabelled; ${EXCEPTION_IDS.length} real 8(a)/8AN/other rows untouched; ` +
      `re-run moved ${secondRunMoved} rows with an unchanged histogram (idempotent)`,
  );
  if (moved === 0) console.log("[run-065] (re-run: nothing left to move — idempotent)");
}
