/**
 * Migration 062 — re-stamp the 11 stale trucking category stamps (trucking item #2a).
 *
 * The reviewed record is db/migrations/062_bids_transportation_restamp.sql — this
 * runner executes ITS statements, one by one, through the shared splitter, so the
 * file that is reviewed is the file that runs.
 *
 *   bun run db/migrations/run-062.ts        (DATABASE_URL must be set)
 *
 * NUMBERING: the highest run-*.ts on main was run-060.ts, but the `NNN_*.sql` number
 * 061 is already taken by 061_bid_fit_review_flow.sql (hand-applied, no runner), so
 * this migration takes the next FREE pair of numbers: 062_*.sql + run-062.ts.
 * Nothing was overwritten.
 *
 * SPLITTER: the record is ONE plain `UPDATE … RETURNING id` with no `;` inside a
 * statement and no dollar-quoted body, so `migrationStatements()` (the `;`-only
 * splitter, whose "no `;` inside a statement" rule the file honours) is the correct
 * one — schemaStatements() is not needed here.
 *
 * WHAT IT PROVES (before/after, all SELECT-only comparisons):
 *   1. the bids table row count is unchanged (no insert, no delete);
 *   2. the full `category` histogram changes ONLY by the re-stamp itself: each of the
 *      listed ids that was not already `Transportation` leaves its old bucket and
 *      `Transportation` gains exactly that many — nothing else moves. The expected
 *      pairs are DERIVED PER ROW from the BEFORE rows, never assumed per bucket: on
 *      the first 11-row run the only expected deltas are `Other: n -> n-1` (330861)
 *      and `Transportation: 273 -> 274`, because the other ten ids are already
 *      Transportation; a re-run expects no delta at all. Hardcoding "one row per
 *      bucket" here is what produced the earlier spurious FAIL;
 *   3. every listed id exists and now reads `Transportation`;
 *   4. the two deliberately EXCLUDED classifier false positives (152951 surface
 *      transportation PLANNING studies, 133179 FTA transit-RESEARCH BAA) are
 *      untouched and are still NOT `Transportation` (re-stamping them would move the
 *      error, not fix it — the reason is spelled out in the .sql header);
 *   5. each re-stamped row is one the SHARED classifier itself calls
 *      Transportation (isTransportationWork over its real title/description) — this
 *      migration only makes the stored stamp agree with the classifier, it never
 *      invents a trucking label;
 *   6. the statement returns exactly the ids it moved, and they are a subset of the
 *      list (the WHERE clause cannot reach any other row);
 *   7. `category` is the only column written — every listed row's updated_at is
 *      reported before/after (an UPDATE that bumped it would be visible here).
 *
 * IDEMPOTENT BY CONSTRUCTION: `AND category IS DISTINCT FROM 'Transportation'` — a
 * second run returns 0 ids, moves nothing, and every assertion above still holds
 * (that is the proof the migration is safe to re-run).
 *
 * DELIBERATE-ONLY GUARD: never invoked by a test, CI job or scheduled task — it
 * exists to be run BY HAND, once, by the operator/lead. It prints the target host
 * before its first statement for exactly that reason: in this sandbox the
 * DATABASE_URL in the environment IS production.
 *
 * APPLIED: 2026-10-16 on the production Neon DB (host ep-soft-dawn-ayvxzmgk-pooler),
 * in two runs on the same day:
 *   run 1 (10 rows)  bids rows 51,241 -> 51,241; category='Transportation' 263 -> 273;
 *                    exactly the 10 measured ids moved; 152951/133179 untouched.
 *   run 2 (11 rows, 330861 added by owner order) bids rows 51,241 -> 51,241;
 *                    category='Transportation' 273 -> 274; exactly ONE id moved
 *                    (330861, Other -> Transportation) — the 10 prior rows were
 *                    already Transportation and the IS DISTINCT FROM guard skipped
 *                    them; 152951/133179 still untouched; every updated_at unchanged.
 *                    A re-run then moved 0 rows with an unchanged histogram — the
 *                    idempotency proof for the 11-row state.
 * Both run logs are kept in shared/trucking-2a-2026-10-16/.
 *
 * ROLLBACK: the listed rows' previous stamps are printed by the BEFORE section of
 * the run logs (id → old category), so the migration is reversible by hand from its
 * own output; nothing else was stored anywhere.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";
import { isTransportationWork } from "../../src/lib/trade-classification";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-062] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
try {
  console.warn(
    `[run-062] target database host: ${new URL(url).hostname} — DATA migration: re-stamps category='Transportation' on 11 listed bids ids (no DDL, no insert, no delete, no other column)`,
  );
} catch {
  console.warn("[run-062] target database host: (unparseable DATABASE_URL)");
}
/** The 10 MEASURED genuine trucking rows (COUNT.md §5 — classifier Transportation, stored stamp stale). */
const MEASURED_IDS = [5112, 130817, 135667, 136838, 138509, 139059, 139060, 152895, 152953, 152954] as const;
/**
 * ADDED PER OWNER ORDER 2026-10-16: 330861 "Hauling and Disposal Services of Scrap
 * Tires GS-27-05" (va_eva) — the +1 row the haul-and-disposal phrase shipped in this
 * PR unlocks. Its stored stamp was still the pre-fix `Other`, so leaving it out would
 * keep the measured gain invisible in every `category='Transportation'` view until
 * (and unless) that row happens to re-upsert. It is genuine hauling service work, not
 * a false positive — the buy IS hauling-and-disposal, and the shared classifier
 * assertion below holds it to that.
 */
const OWNER_ORDER_IDS = [330861] as const;
const IDS = [...MEASURED_IDS, ...OWNER_ORDER_IDS] as const;
/**
 * The 2 classifier FALSE POSITIVES among the 12 stale stamps, EXCLUDED on purpose
 * (the exclusion list is deliberately NOT extended by the owner's 330861 order — that
 * row is the opposite of these: a real hauling buy the classifier gets RIGHT).
 * Both are caught by the shipped /\btransport/ signal although they are planning /
 * research buys; re-stamping them would make a wrong label more visible instead of
 * correcting it (see the .sql header).
 */
const EXCLUDED: Array<{ id: number; why: string }> = [
  { id: 152951, why: "Professional Surface Transportation PLANNING Studies — planning, not trucking work" },
  { id: 133179, why: "FTA BAA transit RESEARCH in Support of ... Public Transportation — research BAA" },
];
const ID_LIST = IDS.join(", ");
const EXCLUDED_LIST = EXCLUDED.map((e) => e.id).join(", ");

interface BidRow {
  id: number;
  category: string | null;
  title: string | null;
  description: string | null;
  updated_at: string | null;
}

async function rowsByIds(list: string): Promise<BidRow[]> {
  return (await sql.query(
    `SELECT id, category, title, description, updated_at::text AS updated_at FROM bids WHERE id IN (${list}) ORDER BY id`,
  )) as BidRow[];
}
async function totalBids(): Promise<number> {
  const rows = (await sql`SELECT count(*)::int AS n FROM bids`) as { n: number }[];
  return rows[0]?.n ?? -1;
}
async function histogram(): Promise<Map<string, number>> {
  const rows = (await sql`
    SELECT COALESCE(category, '(null)') AS c, count(*)::int AS n FROM bids GROUP BY 1
  `) as { c: string; n: number }[];
  return new Map(rows.map((r) => [r.c, r.n]));
}
function histDiff(before: Map<string, number>, after: Map<string, number>): string[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  return keys
    .filter((k) => (before.get(k) ?? 0) !== (after.get(k) ?? 0))
    .map((k) => `${k}: ${before.get(k) ?? 0} -> ${after.get(k) ?? 0}`);
}

const problems: string[] = [];
console.log("[run-062] BEFORE");
const beforeTotal = await totalBids();
const beforeHist = await histogram();
const beforeRows = await rowsByIds(ID_LIST);
const beforeExcluded = await rowsByIds(EXCLUDED_LIST);
console.log(
  `[run-062]   bids rows: ${beforeTotal}; category='Transportation': ${beforeHist.get("Transportation") ?? 0}`,
);
for (const row of beforeRows) {
  console.log(`[run-062]   ${row.id}: ${JSON.stringify(row.category)} — ${(row.title ?? "").slice(0, 90)}`);
}
for (const row of beforeExcluded) {
  const why = EXCLUDED.find((e) => e.id === row.id)?.why ?? "";
  console.log(`[run-062]   EXCLUDED ${row.id}: ${JSON.stringify(row.category)} — ${why}`);
}
if (beforeRows.length !== IDS.length) {
  const found = new Set(beforeRows.map((r) => r.id));
  problems.push(
    `listed ids missing from bids: ${IDS.filter((id) => !found.has(id)).join(", ")} (found ${beforeRows.length}/${IDS.length})`,
  );
}
if (beforeExcluded.length !== EXCLUDED.length) {
  problems.push(`excluded control ids missing: ${EXCLUDED_LIST}`);
}
// 5. only classifier-endorsed rows are in the list (and the exclusions ARE the FP).
for (const row of beforeRows) {
  if (!isTransportationWork(row.title ?? "", `${row.title ?? ""} ${row.description ?? ""}`)) {
    problems.push(
      `${row.id} is NOT transportation work per the shared classifier — it must never be re-stamped`,
    );
  }
}
const toMove = beforeRows.filter((r) => r.category !== "Transportation").map((r) => r.id);
console.log(
  `[run-062]   classifier-endorsed: ${beforeRows.length}/${IDS.length}; not yet Transportation (to move): ${toMove.length} [${toMove.join(", ")}]`,
);
const file = new URL("./062_bids_transportation_restamp.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8")).filter((s) => s.trim().length > 0);
console.log(`[run-062] ${statements.length} statement(s) from 062_bids_transportation_restamp.sql`);
const returnedIds: number[] = [];
let failed = 0;
for (const statement of statements) {
  const label = statement.split("\n")[0]!.slice(0, 100).replace(/\s+/g, " ");
  try {
    const rows = (await sql.query(statement)) as Array<{ id?: number }>;
    for (const r of rows) if (typeof r?.id === "number") returnedIds.push(r.id);
    console.log(`ok   ${label} (${rows.length} row(s) returned)`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
  }
}
console.log(`[run-062] AFTER`);
const afterTotal = await totalBids();
const afterHist = await histogram();
const afterRows = await rowsByIds(ID_LIST);
const afterExcluded = await rowsByIds(EXCLUDED_LIST);
console.log(
  `[run-062]   bids rows: ${afterTotal}; category='Transportation': ${afterHist.get("Transportation") ?? 0}`,
);
for (const row of afterRows) {
  console.log(`[run-062]   ${row.id}: ${JSON.stringify(row.category)}`);
}
for (const row of afterExcluded) {
  console.log(`[run-062]   EXCLUDED ${row.id}: ${JSON.stringify(row.category)}`);
}
const diff = histDiff(beforeHist, afterHist);
console.log(`[run-062]   category histogram changes: ${diff.length ? diff.join(" | ") : "(none)"}`);
if (afterTotal !== beforeTotal) {
  problems.push(`bids row count moved ${beforeTotal} -> ${afterTotal} (a re-stamp writes no rows in or out)`);
}
for (const row of afterRows) {
  if (row.category !== "Transportation") problems.push(`${row.id} is ${JSON.stringify(row.category)} after the run`);
}
for (const row of afterExcluded) {
  const was = beforeExcluded.find((b) => b.id === row.id)?.category ?? null;
  if (row.category !== was) problems.push(`EXCLUDED ${row.id} category moved ${JSON.stringify(was)} -> ${JSON.stringify(row.category)}`);
  if (row.category === "Transportation") problems.push(`EXCLUDED ${row.id} must never be stamped Transportation`);
}
// The ONLY histogram change a correct run may produce: each listed id that was not
// already `Transportation` leaves its old bucket (−1 per row) and Transportation
// gains exactly that many rows. Anything else means the UPDATE reached a row it
// should not have.
const movedRows = beforeRows.filter((r) => r.category !== "Transportation");
const oldBucketCounts = new Map<string, number>();
for (const row of movedRows) {
  const old = row.category ?? "(null)";
  oldBucketCounts.set(old, (oldBucketCounts.get(old) ?? 0) + 1);
}
const transportationBefore = beforeHist.get("Transportation") ?? 0;
const expectedPairs = new Set<string>([
  `Transportation: ${transportationBefore} -> ${transportationBefore + movedRows.length}`,
  ...[...oldBucketCounts.entries()]
    .filter(([old]) => old !== "Transportation")
    .map(([old, n]) => `${old}: ${beforeHist.get(old) ?? 0} -> ${(beforeHist.get(old) ?? 0) - n}`),
]);
const unexpected = diff.filter((d) => !expectedPairs.has(d));
if (unexpected.length > 0) {
  problems.push(`unexpected category-histogram change: ${unexpected.join(" | ")} (only the ${IDS.length} listed ids may move)`);
}
const strays = returnedIds.filter((id) => !(IDS as readonly number[]).includes(id));
if (strays.length > 0) problems.push(`the statement touched ids outside the list: ${strays.join(", ")}`);
if (returnedIds.length !== movedRows.length) {
  problems.push(`the statement returned ${returnedIds.length} id(s), expected ${movedRows.length}`);
}
const dupes = returnedIds.filter((id, i) => returnedIds.indexOf(id) !== i);
if (dupes.length > 0) problems.push(`statement returned duplicate ids: ${dupes.join(", ")}`);
const updatedAtMoved = afterRows.filter((row) => {
  const was = beforeRows.find((b) => b.id === row.id)?.updated_at ?? null;
  return was !== row.updated_at;
});
console.log(
  `[run-062]   updated_at (category is the only column written): ${
    updatedAtMoved.length === 0 ? `unchanged on all ${afterRows.length} listed rows` : `MOVED on ${updatedAtMoved.map((r) => r.id).join(", ")}`
  }`,
);
console.log(
  `[run-062] verify ${JSON.stringify({
    host: (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })(),
    bidsRows: `${beforeTotal} -> ${afterTotal}`,
    transportation: `${beforeHist.get("Transportation") ?? 0} -> ${afterHist.get("Transportation") ?? 0}`,
    idsMoved: returnedIds,
    excludedUntouched: EXCLUDED.map((e) => e.id),
    histogramChanges: diff,
    problems,
  })}`,
);
if (failed > 0) {
  console.error(`[run-062] ${failed} statement(s) failed`);
  process.exitCode = 1;
} else if (problems.length > 0) {
  console.error("[run-062] FAIL: the re-stamp did not do exactly what migration 062 specifies");
  for (const problem of problems) console.error(`[run-062]   ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `[run-062] OK — ${returnedIds.length} row(s) re-stamped to Transportation; every other row, and every other column, untouched`,
  );
  if (returnedIds.length === 0) {
    console.log("[run-062] (re-run: nothing left to move — idempotent)");
  }
}
