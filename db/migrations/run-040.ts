/**
 * Migration 040 — backfill the 4 additive location columns to insert-time
 * semantics (PR-B.2). DATA-ONLY; schema is untouched (columns came from 039).
 *
 * WHY: the 21:07Z sync (PR-B post-merge) inserted 186 rows AFTER 039's
 * backfill ran, so those rows (and every row the pre-039 runner path ever
 * inserted) carry NULL source_jurisdiction / raw_location / normalized_state /
 * location_conflict. The PR-B.2 runner change makes FUTURE inserts write the
 * columns; this migration fixes EXISTING rows using EXACTLY the same
 * derivation — deriveInsertLocationColumns from src/lib/location-state.ts
 * (the identical function the new insert path calls). That guarantees stored
 * values == insert-time values == radar read-path derivation, which is what
 * the PR-C audit matrix will check.
 *
 * Rules (identical to the insert path — conservative, never guessed):
 *   - source_jurisdiction = 'PA'/'VA' for the pennbid / va_evirginia
 *     collectors (curated: the portal's home jurisdiction is provable by
 *     construction); for every other source it is the row's own geography
 *     derived from location/agency text; NULL when unprovable.
 *   - raw_location        = the row's own stored location, verbatim.
 *   - normalized_state    = resolveBidState(location, agency): performance
 *     location first, then buyer/agency; NULL when neither proves a state.
 *   - location_conflict   = true only when the row's OWN title/description
 *     names a DIFFERENT state than the derived one; false when a state is
 *     derived; NULL when no state is derived.
 *
 * Idempotent + deterministic: every row is recomputed from its own stored text
 * in a single pass; rows already correct are rewritten with identical values
 * (safe to re-run any time, e.g. after a fresh structure-only dev DB copy).
 */
import { neon } from "@neondatabase/serverless";
import { deriveInsertLocationColumns } from "../../src/lib/location-state";

const sql = neon(process.env.DATABASE_URL!);

async function run(label: string, q: string, params?: unknown[]) {
  try {
    await (params ? sql.query(q, params) : sql`${sql.unsafe(q)}`);
    console.log(`ok   ${label}`);
  } catch (e) {
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
    process.exitCode = 1;
  }
}

// Single-pass recompute of all four columns from stored text.
const rows = (await sql`
  SELECT id, source, location, agency, title, description
  FROM bids
  ORDER BY id
`) as any[];

console.log(`[run-040] ${rows.length} bids to normalize`);

const BATCH = 2000;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const params: unknown[] = [];
  const cases: string[] = [];
  for (const r of chunk) {
    const d = deriveInsertLocationColumns({
      location: r.location,
      agency: r.agency,
      title: r.title,
      description: r.description,
      sourceName: r.source,
    });
    const idx = params.length / 5;
    cases.push(
      `($${idx * 5 + 1}::int, $${idx * 5 + 2}::text, $${idx * 5 + 3}::text, $${idx * 5 + 4}::text, $${idx * 5 + 5}::boolean)`,
    );
    params.push(
      Number(r.id),
      d.source_jurisdiction,
      d.raw_location,
      d.normalized_state,
      d.location_conflict,
    );
  }
  await run(
    `bids: backfill location columns (rows ${i + 1}–${i + chunk.length})`,
    `
    UPDATE bids b
    SET source_jurisdiction = v.sj,
        raw_location = v.rl,
        normalized_state = v.ns,
        location_conflict = v.lc
    FROM (VALUES ${cases.join(", ")}) AS v(id, sj, rl, ns, lc)
    WHERE b.id = v.id
    `,
    params,
  );
}

console.log("[run-040] complete");