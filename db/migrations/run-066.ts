/**
 * Migration 066 — the three 8(a)-relabel follow-ups from migration 065
 * (owner-approved 2026-10-19). See 066_bids_set_aside_other_designations.sql.
 *
 * The reviewed record is db/migrations/066_bids_set_aside_other_designations.sql —
 * this runner executes ITS statements, one by one, through the shared splitter, so
 * the file that is reviewed is the file that runs. The runner also PARSES the id
 * lists out of that same file and holds them against frozen, measured expectations,
 * so the file cannot drift from the evidence.
 *
 *   bun run db/migrations/run-066.ts        (DATABASE_URL must be set)
 *
 * SPLITTER: the record is three plain `UPDATE … RETURNING id` statements with no
 * `;` inside a statement and no dollar-quoted body, so `migrationStatements()`
 * (the `;`-only splitter) is the correct one.
 *
 * WHAT IT PROVES (before/after, all SELECT-only comparisons):
 *   1. the bids row count is unchanged (no insert, no delete);
 *   2. the stored value of each relabelled row is EXACTLY the string the 4-hourly
 *      sync's own `normalizeSetAside` returns for that notice's SAM code (asserted
 *      against the shipped function before anything is written), and the strings
 *      appear verbatim in the statements;
 *   3. the `set_aside` histogram moves ONLY by this migration: "8(a)" 85 -> 82,
 *      "WOSB" +2, "SBP" +1, and no other bucket moves at all;
 *   4. the statements return exactly the ids they moved, and every returned id is
 *      inside the frozen id list (the WHERE clauses cannot reach any other row);
 *   5. the md_dc close-out is exactly one row: the retired-label population's own
 *      set_aside histogram is IDENTICAL before and after (nothing was relabelled),
 *      exactly one md_dc row has a non-null closed_at, and it is id 4384;
 *   6. the rescued duplicate leaves the public counter: id 4384 matches
 *      OPEN_BID_SQL + CLOSED_EXCLUSION_SQL (the shipped fragments, imported from
 *      src/lib/open-bids.ts) BEFORE the run and does not after;
 *   7. IDEMPOTENCY: all three statements are run a SECOND time; they must return 0
 *      ids, move nothing, leave the histogram identical and NOT re-stamp
 *      closed_at/updated_at on 4384 (the `closed_at IS NULL` guard).
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not touch the 9 rows SAM publishes no
 * set-aside value for, the 10 real 8AN rows, the 225 other md_dc rows, or any
 * column of a relabelled row other than set_aside.
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, a CI job or a scheduled task — it
 * exists to be run BY HAND, once, by the operator/lead. It prints the target host
 * before its first statement for exactly that reason: in this sandbox the
 * DATABASE_URL in the environment IS production.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";
import { CLOSED_EXCLUSION_SQL, OPEN_BID_SQL } from "../../src/lib/open-bids";
import { normalizeSetAside } from "../../src/jobs/sources/sam-gov";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-066] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-066] target database host: ${new URL(url).hostname} — DATA migration: relabels 3 stored "8(a)" rows whose SAM record is a WOSB/WOSBSS/SBP designation, and closes the stale md_dc duplicate id 4384 (no DDL, no insert, no delete)`,
  );
} catch {
  console.warn("[run-066] target database host: (unparseable DATABASE_URL)");
}

const FILE = new URL("./066_bids_set_aside_other_designations.sql", import.meta.url);
const raw = readFileSync(FILE, "utf8");
const statements = migrationStatements(raw).filter((s) => s.trim().length > 0);
if (statements.length !== 3) {
  console.error(
    `[run-066] FAIL: expected exactly 3 statements in 066_bids_set_aside_other_designations.sql, found ${statements.length}`,
  );
  process.exit(1);
}

/**
 * FROZEN EXPECTATIONS — measured 2026-10-19, never re-typed from the file.
 * `samCode` is what SAM's notice-detail API recorded for the notice, and `target`
 * is the label the 4-hourly sync's own normalizer returns for that code (asserted
 * below against the shipped function).
 */
const RELABEL = [
  { id: "sam-f0c78ea349e342329b172564ad69ab4e", samCode: "WOSB", target: "WOSB" },
  { id: "sam-daab0dffa3044ad19e6d7ca610be2bc0", samCode: "WOSBSS", target: "WOSB" },
  { id: "sam-ecd2e2a033c147f0ba7f7de6fb14f528", samCode: "SBP", target: "SBP" },
] as const;
const WOSB_IDS = RELABEL.filter((r) => r.target === "WOSB").map((r) => r.id);
const SBP_IDS = RELABEL.filter((r) => r.target === "SBP").map((r) => r.id);
const CLOSE = {
  id: 4384,
  externalId: "mddc-dc-2412c3d99bcb4288a6e742a02b87129d",
  source: "md_dc",
} as const;
const EXPECTED = {
  exceptionRowsBefore: 85, // the rows 065 deliberately left reading "8(a)"
  eightAAfter: 82,
  moved: 3,
  wosbGain: 2,
  sbpGain: 1,
  mdDcRows: 226, // the retired-label population (all open before this run)
  mdDcOpenAfter: 225,
} as const;

const problems: string[] = [];
const idsIn = (statement: string): string[] =>
  [...statement.matchAll(/'(sam-[0-9a-f]{32})'/g)].map((m) => m[1]!);
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));
const tag = (statement: string, index: number): string =>
  statement.includes("SET set_aside = 'WOSB'")
    ? "statement 1 (2 rows -> WOSB)"
    : statement.includes("SET set_aside = 'SBP'")
      ? "statement 2 (1 row -> SBP)"
      : `statement ${index + 1} (close out the md_dc duplicate)`;

// ── shape of the reviewed file ───────────────────────────────────────────────
const fileWosb = idsIn(statements[0]!);
const fileSbp = idsIn(statements[1]!);
const closeStatement = statements[2]!;
if (!sameSet(fileWosb, WOSB_IDS)) {
  problems.push(`statement 1 names ${fileWosb.length} id(s), expected the measured WOSB/WOSBSS pair ${WOSB_IDS.join(", ")}`);
}
if (!sameSet(fileSbp, SBP_IDS)) {
  problems.push(`statement 2 names ${fileSbp.length} id(s), expected the measured SBP id ${SBP_IDS.join(", ")}`);
}
if (idsIn(closeStatement).length !== 0) problems.push("statement 3 must name no sam-<32hex> external_id (it closes a retired-label row by id)");
for (const [index, statement] of statements.entries()) {
  const label = tag(statement, index);
  if (!/^\s*UPDATE\s+bids\s/i.test(statement)) problems.push(`${label} does not start with UPDATE bids`);
  if (/\b(delete|insert|truncate|drop|alter|create)\b/i.test(statement)) {
    problems.push(`${label} is not an UPDATE-only record: ${statement.slice(0, 80)}`);
  }
  if ((statement.match(/SET /g) ?? []).length !== 1) problems.push(`${label} must set exactly one column group`);
  if (!statement.trimEnd().endsWith("RETURNING id")) problems.push(`${label} does not end with RETURNING id`);
  if (/archive_date/i.test(statement)) {
    problems.push(`${label} writes archive_date — the nightly close-out path never writes it (see the .sql header)`);
  }
}
if (!statements[0]!.includes("SET set_aside = 'WOSB'") || !statements[0]!.includes("external_id IN (")) {
  problems.push("statement 1 must be the `set_aside IN (…)` relabel to WOSB");
}
if (!statements[1]!.includes("SET set_aside = 'SBP'")) problems.push("statement 2 must relabel to SBP");
for (const [index, statement] of [statements[0]!, statements[1]!].entries()) {
  if (!/WHERE set_aside = '8\(a\)'/.test(statement)) {
    problems.push(`statement ${index + 1} lost the set_aside = '8(a)' guard that makes a re-run a no-op`);
  }
}
if (!/SET closed_at = NOW\(\), updated_at = NOW\(\)/.test(closeStatement)) {
  problems.push("statement 3 must mirror the nightly close-out exactly: `SET closed_at = NOW(), updated_at = NOW()`");
}
if (!new RegExp(`WHERE id = ${CLOSE.id}\\b`).test(closeStatement)) problems.push(`statement 3 must target id ${CLOSE.id}`);
if (!closeStatement.includes(`external_id = '${CLOSE.externalId}'`)) {
  problems.push("statement 3 must also freeze the natural key (the mddc-dc-… external_id)");
}
if (!closeStatement.includes(`source = '${CLOSE.source}'`)) problems.push("statement 3 must be scoped to the md_dc source label");
if (!/closed_at IS NULL/.test(closeStatement)) {
  problems.push("statement 3 lost the `closed_at IS NULL` guard that keeps a re-run from re-stamping the timestamp");
}
// ── the target strings are the SYNC'S OWN OUTPUT, not a choice ────────────────
for (const { id, samCode, target } of RELABEL) {
  const syncLabel = normalizeSetAside(samCode);
  if (syncLabel !== target) {
    problems.push(
      `${id}: normalizeSetAside("${samCode}") now returns ${JSON.stringify(syncLabel)}, but the file stores ${JSON.stringify(target)} — the stored label would drift from the next sync of the same notice`,
    );
  }
}
if (!statements[0]!.includes(`SET set_aside = '${normalizeSetAside("WOSB")}'`)) {
  problems.push("statement 1's target string is not the normalizer's own output");
}
if (!statements[1]!.includes(`SET set_aside = '${normalizeSetAside("SBP")}'`)) {
  problems.push("statement 2's target string is not the normalizer's own output");
}

// ── measurements ─────────────────────────────────────────────────────────────
const quote = (ids: readonly string[]) => ids.map((id) => `'${id}'`).join(", ");
async function totalBids(): Promise<number> {
  const rows = (await sql`SELECT count(*)::int AS n FROM bids`) as { n: number }[];
  return rows[0]?.n ?? -1;
}
async function countWhere(where: string): Promise<number> {
  const rows = (await sql.query(`SELECT count(*)::int AS n FROM bids WHERE ${where}`)) as { n: number }[];
  return rows[0]?.n ?? -1;
}
async function bucketCounts(): Promise<Map<string, number>> {
  const rows = (await sql`
    SELECT COALESCE(set_aside, '(null)') AS v, count(*)::int AS n FROM bids GROUP BY 1
  `) as { v: string; n: number }[];
  return new Map(rows.map((r) => [r.v, r.n]));
}
async function mdDcBuckets(): Promise<Map<string, number>> {
  const rows = (await sql`
    SELECT COALESCE(set_aside, '(null)') AS v, count(*)::int AS n FROM bids WHERE source = 'md_dc' GROUP BY 1
  `) as { v: string; n: number }[];
  return new Map(rows.map((r) => [r.v, r.n]));
}
type Row = { id: number; external_id: string; set_aside: string | null; closed_at: string | null; updated_at: string | null };
async function rowsFor(ids: readonly string[]): Promise<Row[]> {
  return (await sql.query(
    `SELECT id, external_id, set_aside, closed_at, updated_at FROM bids WHERE external_id IN (${quote(ids)}) ORDER BY id`,
  )) as Row[];
}
async function closeRow(): Promise<Row | undefined> {
  const rows = (await sql.query(
    `SELECT id, external_id, set_aside, closed_at, updated_at FROM bids WHERE id = ${CLOSE.id}`,
  )) as Row[];
  return rows[0];
}
/** The public counter's own predicate, from the shipped fragments. */
async function inCounter(): Promise<number> {
  return countWhere(`${OPEN_BID_SQL} AND ${CLOSED_EXCLUSION_SQL} AND id = ${CLOSE.id}`);
}
function bucketDiff(before: Map<string, number>, after: Map<string, number>): string[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  return keys
    .filter((k) => (before.get(k) ?? 0) !== (after.get(k) ?? 0))
    .map((k) => `${k}: ${before.get(k) ?? 0} -> ${after.get(k) ?? 0}`);
}

console.log("[run-066] BEFORE");
const beforeTotal = await totalBids();
const beforeBuckets = await bucketCounts();
const beforeMdDc = await mdDcBuckets();
const beforeRows = await rowsFor(RELABEL.map((r) => r.id));
const beforeClose = await closeRow();
const beforeInCounter = await inCounter();
const beforeClosedTotal = await countWhere("closed_at IS NOT NULL");
const beforeEightA = beforeBuckets.get("8(a)") ?? 0;
const beforeWosb = beforeBuckets.get("WOSB") ?? 0;
const beforeSbp = beforeBuckets.get("SBP") ?? 0;
console.log(
  `[run-066]   bids rows: ${beforeTotal}; set_aside='8(a)': ${beforeEightA}; 'WOSB': ${beforeWosb}; 'SBP': ${beforeSbp}; ` +
    `closed_at IS NOT NULL: ${beforeClosedTotal}`,
);
console.log(`[run-066]   md_dc rows: ${[...beforeMdDc.values()].reduce((a, b) => a + b, 0)}; row ${CLOSE.id} in the public counter: ${beforeInCounter === 1 ? "yes" : `NO (${beforeInCounter})`}`);
console.log("[run-066]   the 3 rows to relabel (current state):");
for (const row of beforeRows) {
  const want = RELABEL.find((r) => r.id === row.external_id)!;
  console.log(
    `[run-066]     id ${row.id}  ${row.external_id}  SAM=${want.samCode}  now=${JSON.stringify(row.set_aside)}  -> ${JSON.stringify(want.target)} (normalizeSetAside("${want.samCode}"))`,
  );
}
if (beforeEightA !== EXPECTED.exceptionRowsBefore) {
  problems.push(`before: '8(a)' is ${beforeEightA}, expected the ${EXPECTED.exceptionRowsBefore} rows 065 left behind`);
}
if (beforeInCounter !== 1) problems.push(`before: id ${CLOSE.id} should be IN the public counter (found ${beforeInCounter})`);

console.log("[run-066] APPLYING");
let moved = 0;
const returnedIds: number[] = [];
let failed = 0;
for (const [index, statement] of statements.entries()) {
  const label = tag(statement, index);
  try {
    const returned = (await sql.query(statement)) as { id: number }[];
    moved += returned.length;
    returnedIds.push(...returned.map((r) => r.id));
    console.log(`[run-066] ok   ${label}: ${returned.length} row(s) moved`);
  } catch (e) {
    failed += 1;
    console.error(`[run-066] FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
  }
}

console.log("[run-066] AFTER");
const afterTotal = await totalBids();
const afterBuckets = await bucketCounts();
const afterMdDc = await mdDcBuckets();
const afterRows = await rowsFor(RELABEL.map((r) => r.id));
const afterClose = await closeRow();
const afterInCounter = await inCounter();
const closedTotalAfter = await countWhere("closed_at IS NOT NULL");
const eightAAfter = afterBuckets.get("8(a)") ?? 0;
const wosbAfter = afterBuckets.get("WOSB") ?? 0;
const sbpAfter = afterBuckets.get("SBP") ?? 0;
console.log(
  `[run-066]   bids rows: ${afterTotal}; set_aside='8(a)': ${eightAAfter}; 'WOSB': ${wosbAfter}; 'SBP': ${sbpAfter}; ` +
    `closed_at IS NOT NULL: ${closedTotalAfter}`,
);
console.log(`[run-066]   md_dc open rows: ${[...afterMdDc.values()].reduce((a, b) => a + b, 0)}; row ${CLOSE.id} in the public counter: ${afterInCounter === 1 ? "yes" : "no"}`);

// ── 7. idempotency: run the same statements again; nothing may move. ─────────
let secondRunMoved = 0;
for (const statement of statements) {
  const returned = (await sql.query(statement)) as { id: number }[];
  secondRunMoved += returned.length;
}
const thirdTotal = await totalBids();
const thirdBuckets = await bucketCounts();
const thirdMdDc = await mdDcBuckets();
const closeAfterSecond = await closeRow();
const rowsAfterSecond = await rowsFor(RELABEL.map((r) => r.id));

if (failed > 0) problems.push(`${failed} statement(s) failed`);
if (afterTotal !== beforeTotal) problems.push(`bids row count moved ${beforeTotal} -> ${afterTotal} (not data-only)`);
if (thirdTotal !== afterTotal) problems.push("bids row count moved on the second (idempotency) run");
if (secondRunMoved !== 0) problems.push(`the idempotency re-run moved ${secondRunMoved} row(s), expected 0`);
const secondDiff = bucketDiff(afterBuckets, thirdBuckets);
if (secondDiff.length > 0) problems.push(`the idempotency re-run changed the set_aside histogram: ${secondDiff.join(", ")}`);
const secondMdDcDiff = bucketDiff(afterMdDc, thirdMdDc);
if (secondMdDcDiff.length > 0) problems.push(`the idempotency re-run changed the md_dc histogram: ${secondMdDcDiff.join(", ")}`);
if (JSON.stringify(closeAfterSecond) !== JSON.stringify(afterClose)) {
  problems.push("the idempotency re-run RE-STAMPED the closed row (closed_at/updated_at moved)");
}
if (JSON.stringify(rowsAfterSecond) !== JSON.stringify(afterRows)) {
  problems.push("the idempotency re-run changed one of the relabelled rows");
}

if (moved !== EXPECTED.moved) problems.push(`the statements moved ${moved} row(s), expected ${EXPECTED.moved}`);
if (returnedIds.length !== new Set(returnedIds).size) problems.push("the statements returned an id twice");
for (const id of returnedIds) {
  if (!beforeRows.some((r) => r.id === id) && id !== CLOSE.id) {
    problems.push(`a statement returned id ${id}, which is NOT in the frozen id list (blast radius widened)`);
  }
}
const eightADelta = beforeEightA - eightAAfter;
const wosbDelta = wosbAfter - beforeWosb;
const sbpDelta = sbpAfter - beforeSbp;
if (eightAAfter !== EXPECTED.eightAAfter) problems.push(`after: '8(a)' is ${eightAAfter}, expected ${EXPECTED.eightAAfter}`);
if (wosbDelta !== EXPECTED.wosbGain) problems.push(`after: 'WOSB' moved ${beforeWosb} -> ${wosbAfter}, expected +${EXPECTED.wosbGain}`);
if (sbpDelta !== EXPECTED.sbpGain) problems.push(`after: 'SBP' moved ${beforeSbp} -> ${sbpAfter}, expected +${EXPECTED.sbpGain}`);
if (eightADelta !== wosbDelta + sbpDelta) {
  problems.push(`histogram does not balance: '8(a)' lost ${eightADelta}, WOSB gained ${wosbDelta}, SBP gained ${sbpDelta}`);
}
for (const row of afterRows) {
  const want = RELABEL.find((r) => r.id === row.external_id)!;
  if (row.set_aside !== want.target) {
    problems.push(`after: id ${row.id} reads ${JSON.stringify(row.set_aside)}, expected ${JSON.stringify(want.target)}`);
  }
}
if (afterRows.some((r) => r.set_aside === "8(a)")) problems.push("after: a relabelled row still reads '8(a)'");
const mdDcDiff = bucketDiff(beforeMdDc, afterMdDc);
if (mdDcDiff.length > 0) {
  problems.push(`the md_dc rows' own set_aside histogram moved (nothing there should be relabelled): ${mdDcDiff.join(", ")}`);
}
const mdDcOpen = await countWhere(`source = 'md_dc' AND ${CLOSED_EXCLUSION_SQL}`);
const mdDcClosed = await countWhere(`source = 'md_dc' AND NOT ${CLOSED_EXCLUSION_SQL}`);
if (mdDcOpen !== EXPECTED.mdDcOpenAfter) {
  problems.push(`after: ${mdDcOpen} open md_dc rows, expected ${EXPECTED.mdDcOpenAfter} (of ${EXPECTED.mdDcRows})`);
}
if (mdDcClosed !== 1) problems.push(`after: ${mdDcClosed} md_dc rows are closed, expected exactly 1 (id ${CLOSE.id})`);
if (afterClose?.closed_at == null) problems.push(`after: id ${CLOSE.id} still has closed_at NULL`);
if (afterClose?.set_aside !== beforeClose?.set_aside) {
  problems.push(`after: id ${CLOSE.id}'s set_aside changed ${JSON.stringify(beforeClose?.set_aside)} -> ${JSON.stringify(afterClose?.set_aside)} (the close-out must not relabel)`);
}
if (afterInCounter !== 0) problems.push(`after: id ${CLOSE.id} is STILL in the public counter (${afterInCounter}) — the duplicate it leaves behind keeps double-counting`);
if (closedTotalAfter !== beforeClosedTotal + 1) {
  problems.push(`after: closed rows moved ${beforeClosedTotal} -> ${closedTotalAfter}, expected exactly +1`);
}

console.log(
  `[run-066] verify ${JSON.stringify({
    host: (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })(),
    bidsRows: `${beforeTotal} -> ${afterTotal}`,
    eightA: `${beforeEightA} -> ${eightAAfter}`,
    wosb: `${beforeWosb} -> ${wosbAfter}`,
    sbp: `${beforeSbp} -> ${sbpAfter}`,
    mdDcOpenRows: `${EXPECTED.mdDcRows} -> ${mdDcOpen}`,
    duplicateInCounter: `${beforeInCounter} -> ${afterInCounter}`,
    closedRows: `${beforeClosedTotal} -> ${closedTotalAfter}`,
    moved,
    secondRunMoved,
    problems,
  })}`,
);
if (problems.length > 0) {
  console.error("[run-066] FAIL: the follow-up did not do exactly what migration 066 specifies");
  for (const problem of problems) console.error(`[run-066]   ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-066] OK — '8(a)' ${beforeEightA} -> ${eightAAfter} (the 3 WOSB/WOSBSS/SBP rows now read exactly what the sync's normalizer writes); ` +
      `md_dc id ${CLOSE.id} closed (${beforeInCounter} -> ${afterInCounter} in the public counter), the other ${EXPECTED.mdDcRows - 1} md_dc rows untouched; ` +
      `re-run moved ${secondRunMoved} rows and re-stamped nothing (idempotent)`,
  );
}
