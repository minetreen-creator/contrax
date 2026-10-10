/**
 * runner UPSERT REFRESH — DB-backed regression pins (owner-directed, 2026-10-10).
 *
 * WHY THIS FILE EXISTS. A stored `va_eva` row whose notice was amended in place
 * (same id, same title/agency, later `closedate`, bumped `version`) never
 * refreshed: the `WHERE NOT EXISTS (lower(title), lower(agency))` pre-filter on
 * both `INSERT … SELECT` statements in `src/jobs/runner.ts` matched the row
 * AGAINST ITSELF, so the candidate was discarded before `ON CONFLICT (source,
 * external_id) DO UPDATE` could ever fire. 743/745 stored `va_eva` rows had
 * `updated_at == created_at` after 32 sync runs, 0/45 amended rows had ever been
 * refreshed, and 21 live-open notices were hidden from Radar because their
 * stored `due_date` was in the past while the source was serving the new
 * deadline (evidence: shared/eva-staleness-2026-10-10/). The investigation
 * proved the guard was the only blocker by ELIMINATION + a 45/45 predicate match
 * — it could not execute the failing statement (read-only mandate). This suite
 * settles it by OBSERVATION: the first test below is RED on the pre-fix guard.
 *
 * THE PINS (all three belong to one fix, so they live in one file):
 *   (a) SELF-REFRESH — a re-fetch of an existing row whose `due_date` moved
 *       UPDATES the stored row, and the `source_url` (which embeds eVA's
 *       `rfp_id_round`) follows the live value in the SAME statement. Without the
 *       SET-list addition the URL would keep round 1 even though the update
 *       fires; without the guard fix NOTHING fires at all.
 *   (b) CROSS-SOURCE DEDUPE STILL BLOCKS — a SECOND source re-posting the same
 *       (title, agency) is still refused and the first source's row is left
 *       byte-identical. The candidate's natural-key 5-tuple deliberately DIFFERS
 *       in `due_date`, so the migration-048 partial UNIQUE index cannot be the
 *       blocker — the guard is the only thing that can refuse it.
 *   (c) NO-OP CONTROL — a byte-identical re-sync does NOT advance `updated_at`
 *       (the compute-saver still suppresses it), so pin (a) is not just "the
 *       writer runs on every sync".
 *
 * HOW IT IS PROVIDED (and why it never touches the team's data). It only issues
 * `CREATE DATABASE` / `DROP DATABASE … WITH (FORCE)` for a per-run name
 * containing "runner_upsert" (`contrax_runner_upsert_<run>`, see `RUN_SUFFIX`),
 * writes ONLY into that database, and drops it in `afterAll` — including after a
 * failed run. The writes go through the REAL `syncSource` + `insertBidsBatch` /
 * `insertBid` path (a fake `SyncSource` injects the rows, exactly like the
 * connector would), so the statements under test are the shipped ones.
 *
 * SCHEMA PROVISIONING — `src/db/schema.sql` is NOT sufficient for `bids`: its
 * `bids` block predates several ADDITIVE migrations the upsert references
 * unconditionally (`naics_code` 007, `naics_code_source` 012, `updated_at` 015,
 * the four location columns + the two run-log tables from the hand-run
 * db/migrations/run-039.ts). Those migration statements are applied here VERBATIM
 * (imported from their own files where they are plain `.sql`, quoted from
 * run-039.ts where the DDL lives in TypeScript) so the throwaway database has
 * every column the upsert names. Additive + IF NOT EXISTS guarded, so the order
 * relative to schema.sql does not matter.
 *
 * OPT-IN, CI-ONLY (the standing hard rule). The sandbox `DATABASE_URL` IS
 * production, so this suite does NOTHING unless BOTH `DATABASE_URL` and
 * `RUNNER_UPSERT_TEST_PROVISION_SCHEMA=1` are set — the same explicit opt-in
 * discipline as the nonprofit / state-grants integration halves. CI is its only
 * judge.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements, schemaStatements } from "../../db/migrations/sql-statements";
import { syncSource, type SyncSource } from "./runner";
import type { RawBid } from "./sources/sam-gov";

const ENABLED =
  process.env.RUNNER_UPSERT_TEST_PROVISION_SCHEMA === "1" && !!process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_URL ?? "";
/**
 * Unique-per-run throwaway name. A FIXED name let two Build Check runs build the
 * same database, and whichever reached its `DROP DATABASE … WITH (FORCE)` first
 * killed the other run's mid-test database (the collision the nonprofit
 * bootstrap suite already documents). `GITHUB_RUN_ID` is set on Actions; the pid
 * fallback keeps two local runs distinct.
 */
const RUN_SUFFIX = process.env.GITHUB_RUN_ID ?? String(process.pid);
const TEST_DB = `contrax_runner_upsert_${RUN_SUFFIX}`;

type Db = ReturnType<typeof neon>;

function urlForDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** The hand-run DDL from db/migrations/run-039.ts that the upsert path needs. */
const RUN039_STATEMENTS = [
  // run-039.ts → "bids: additive location columns"
  `ALTER TABLE bids
     ADD COLUMN IF NOT EXISTS source_jurisdiction text,
     ADD COLUMN IF NOT EXISTS raw_location text,
     ADD COLUMN IF NOT EXISTS normalized_state text,
     ADD COLUMN IF NOT EXISTS location_conflict boolean`,
  // run-039.ts → "collector_run_log table (run-record + quality gate)"
  `CREATE TABLE IF NOT EXISTS collector_run_log (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     source text NOT NULL,
     ran_at timestamptz NOT NULL DEFAULT now(),
     rows_fetched integer NOT NULL DEFAULT 0,
     rows_new integer NOT NULL DEFAULT 0,
     ran_zero boolean NOT NULL DEFAULT false,
     errors integer NOT NULL DEFAULT 0,
     fetched_count integer NOT NULL DEFAULT 0,
     accepted_count integer NOT NULL DEFAULT 0,
     skipped_count integer NOT NULL DEFAULT 0,
     failed_count integer NOT NULL DEFAULT 0,
     skip_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
     quality_gate text NOT NULL DEFAULT 'pass'
   )`,
  // run-039.ts → "collector_collapse_log table"
  `CREATE TABLE IF NOT EXISTS collector_collapse_log (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     source text NOT NULL,
     occurred_at timestamptz NOT NULL DEFAULT now(),
     rows_fetched integer NOT NULL DEFAULT 0,
     rows_new integer NOT NULL DEFAULT 0,
     note text
   )`,
];

const PROVISIONING_SQL_FILES = [
  // Additive `bids` columns the upsert writes unconditionally.
  "../../db/migrations/007_bids_naics.sql", // bids.naics_code
  "../../db/migrations/012_naics_source.sql", // bids.naics_code_source
  "../../db/migrations/015_ai_summary.sql", // bids.updated_at (+ the ai_summary cache columns)
];

let DB: Db | null = null;
let READY = false;
let STATEMENT_COUNT = 0;

if (ENABLED) {
  const admin = neon(ADMIN_URL);
  await admin`DROP DATABASE IF EXISTS ${admin.unsafe(TEST_DB)} WITH (FORCE)`;
  await admin`CREATE DATABASE ${admin.unsafe(TEST_DB)}`;
  const db = neon(urlForDatabase(ADMIN_URL, TEST_DB));
  const statements: string[] = [
    ...schemaStatements(readFileSync(new URL("../../src/db/schema.sql", import.meta.url), "utf8")),
    ...PROVISIONING_SQL_FILES.flatMap((file) =>
      migrationStatements(readFileSync(new URL(file, import.meta.url), "utf8")),
    ),
    ...RUN039_STATEMENTS,
  ];
  STATEMENT_COUNT = statements.length;
  for (const statement of statements) {
    try {
      await db`${db.unsafe(statement)}`;
    } catch (error) {
      throw new Error(
        `[runner upsert] provisioning failed on: ${statement.split("\n")[0].slice(0, 120)} :: ${
          (error as Error).message
        }`,
      );
    }
  }
  DB = db;
  READY = true;
  console.log(
    `[runner upsert] built ${TEST_DB} (${STATEMENT_COUNT} statements: schema.sql + 007/012/015 + run-039 DDL)`,
  );
} else {
  console.warn(
    "[runner upsert] SKIPPED: set DATABASE_URL and RUNNER_UPSERT_TEST_PROVISION_SCHEMA=1 to build a " +
      "throwaway database from src/db/schema.sql + the additive migrations. This suite is CI-only on " +
      "purpose (the default sandbox DATABASE_URL IS production).",
  );
}

afterAll(async () => {
  if (!ENABLED) return;
  const admin = neon(ADMIN_URL);
  await admin`DROP DATABASE IF EXISTS ${admin.unsafe(TEST_DB)} WITH (FORCE)`;
  console.log(`[runner upsert] dropped ${TEST_DB}`);
});

/** A fake connector: same shape the runner calls, rows supplied by the test. */
function fakeSource(name: string, rows: () => RawBid[]): SyncSource {
  return { name, fetchFn: async () => rows() };
}

/** Minimal valid RawBid; `source_label` stays UNset so the stored `source` IS the SyncSource name. */
function row(over: Partial<RawBid> = {}): RawBid {
  return {
    external_id: "runner-upsert-1",
    title: "IFB 26-9100 — upsert refresh regression fixture",
    agency: "COMMONWEALTH OF VIRGINIA — TEST AGENCY (fixture)",
    description: "Fixture row for the upsert-refresh regression suite.",
    location: "Richmond, VA",
    category: "supplies",
    due_date: "2026-11-01T00:00:00.000Z",
    estimated_value: "",
    source_url: "https://eva.virginia.gov/fixture?rfp_id=TEST1&rfp_id_round=1",
    set_aside: null,
    psc: null,
    notice_type: "IFB",
    solicitation_number: "TEST-26-9100",
    ...over,
  };
}

/** Date-only view of a timestamptz that works whether the driver hands back a Date or a string. */
function dayOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function instantOf(value: unknown): number {
  return new Date(value as string | number | Date).getTime();
}

async function readRow(db: Db, source: string, externalId: string): Promise<any> {
  const rows = (await db`
    SELECT id, source, external_id, title, agency, due_date, source_url, description,
           created_at, updated_at
    FROM bids WHERE source = ${source} AND external_id = ${externalId}
  `) as any[];
  return rows[0] ?? null;
}

const D1 = "2026-11-01T00:00:00.000Z";
const URL1 = "https://eva.virginia.gov/fixture?rfp_id=TEST-SELF&rfp_id_round=1";

describe.skipIf(!READY)("runner upsert — self-refresh, cross-source dedupe, no-op control", () => {
  test("(a) a re-fetch whose due_date moved UPDATES the stored row (and source_url follows)", async () => {
    const db = DB!;
    const SOURCE = "runner_upsert_self";
    const EXTERNAL = "self-refresh-1";
    const TITLE = "IFB 26-9101 — amended-in-place notice (same id, same title)";
    let rows = [
      row({ external_id: EXTERNAL, title: TITLE, due_date: D1, source_url: URL1 }),
    ];
    const source = fakeSource(SOURCE, () => rows);

    // First sighting: a genuinely new row (the guard has nothing to match).
    const first = await syncSource(db, source);
    expect(first.new).toBe(1);
    expect(first.failed).toBe(0);
    const before = await readRow(db, SOURCE, EXTERNAL);
    expect(dayOf(before.due_date)).toBe("2026-11-01");
    expect(before.source_url).toBe(URL1);

    // The eVA amendment shape: SAME id, SAME title/agency, later close date,
    // bumped version (⇒ a new rfp_id_round in the source URL).
    const D2 = "2026-12-15T00:00:00.000Z";
    const URL2 = "https://eva.virginia.gov/fixture?rfp_id=TEST-SELF&rfp_id_round=2";
    rows = [row({ external_id: EXTERNAL, title: TITLE, due_date: D2, source_url: URL2 })];

    const second = await syncSource(db, source);
    expect(second.new).toBe(0); // a refresh is NOT a new row
    expect(second.failed).toBe(0); // and must not fail: the fix is not an error path

    const after = await readRow(db, SOURCE, EXTERNAL);
    // THE REGRESSION PIN: before the guard fix the row was discarded by its own
    // (title, agency) match and `due_date` stayed 2026-11-01 forever.
    expect(dayOf(after.due_date)).toBe("2026-12-15");
    // The SET-list pin: without `source_url = EXCLUDED.source_url` the fired
    // update would still leave round 1 embedded in the stored link.
    expect(after.source_url).toBe(URL2);
    // The refresh really is a rewrite, not a rebuilt row.
    expect(after.id).toBe(before.id);
    expect(instantOf(after.updated_at)).toBeGreaterThan(instantOf(before.updated_at));
    expect(instantOf(after.created_at)).toBe(instantOf(before.created_at));
  });

  test("(b) cross-source dedupe still refuses a DIFFERENT source's copy of the same (title, agency)", async () => {
    const db = DB!;
    const SOURCE_A = "runner_upsert_cross_a";
    const SOURCE_B = "runner_upsert_cross_b";
    const TITLE = "IFB 26-9102 — one notice, two portals";

    await syncSource(
      db,
      fakeSource(SOURCE_A, () => [
        row({
          external_id: "cross-a-1",
          title: TITLE,
          due_date: D1,
          source_url: "https://eva.virginia.gov/fixture?rfp_id=TEST-CROSS-A",
        }),
      ]),
    );

    // Source B posts the same notice under its own id. Its `due_date` differs on
    // purpose: the migration-048 natural-key 5-tuple (title, agency, notice_type,
    // due_date, psc) therefore CANNOT be the blocker — only the cross-source
    // guard can refuse this candidate.
    const resB = await syncSource(
      db,
      fakeSource(SOURCE_B, () => [
        row({
          external_id: "cross-b-1",
          title: TITLE,
          due_date: "2026-12-05T00:00:00.000Z",
          source_url: "https://vendor.other-portal.test/fixture?rfp_id=TEST-CROSS-B",
        }),
      ]),
    );
    expect(resB.new).toBe(0); // refused, not inserted
    expect(resB.failed).toBe(0); // refused by the guard, not by an error/unique violation

    const stored = (await db`
      SELECT source, external_id, due_date, source_url, updated_at
      FROM bids WHERE lower(btrim(title)) = lower(${TITLE})
    `) as any[];
    expect(stored.length).toBe(1); // exactly one row: B did NOT duplicate it
    expect(stored[0].source).toBe(SOURCE_A); // and ownership did not move
    expect(stored[0].external_id).toBe("cross-a-1");
    // Source B's attempt left source A's row byte-identical (a blocked candidate
    // must not refresh the winner through its own VALUES list).
    expect(dayOf(stored[0].due_date)).toBe("2026-11-01");
    expect(stored[0].source_url).toBe("https://eva.virginia.gov/fixture?rfp_id=TEST-CROSS-A");
  });

  test("(c) control — a byte-identical re-sync does NOT churn updated_at", async () => {
    const db = DB!;
    const SOURCE = "runner_upsert_noop";
    const EXTERNAL = "noop-1";
    const TITLE = "IFR 26-9103 — unchanged re-sync control";
    const rows = [
      row({
        external_id: EXTERNAL,
        title: TITLE,
        due_date: D1,
        source_url: "https://eva.virginia.gov/fixture?rfp_id=TEST-NOOP",
      }),
    ];
    const source = fakeSource(SOURCE, () => rows);

    const first = await syncSource(db, source);
    expect(first.new).toBe(1);
    const before = await readRow(db, SOURCE, EXTERNAL);

    const second = await syncSource(db, source);
    expect(second.new).toBe(0);
    expect(second.failed).toBe(0);

    const after = await readRow(db, SOURCE, EXTERNAL);
    // The compute-saver's whole point: no-op re-syncs stay no-op. If pin (a) made
    // every re-fetch a rewrite, this control would fail — and the nightly corpus
    // would rewrite ~2,300 rows per sync for nothing.
    expect(instantOf(after.updated_at)).toBe(instantOf(before.updated_at));
    expect(dayOf(after.due_date)).toBe(dayOf(before.due_date));
    expect(after.source_url).toBe(before.source_url);
  });
});
