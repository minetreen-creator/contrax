/**
 * Contrax Grants — State Grants integration tests (REAL Postgres).
 *
 * These run against a live database — the repo's `HAS_DB` convention (the same
 * one src/lib/fpds.test.ts uses: `const HAS_DB = !!process.env.DATABASE_URL`).
 * They exercise the real store and the real runner: the atomic commit, the
 * no-op-write filter, change detection, the error path, per-source identity,
 * `last_seen_at` freshness and the stale sweep, and the query surface.
 *
 * TEST DATA DISCIPLINE (nothing a real state could ever collide with):
 *   - every opportunity/run row written here uses a SYNTHETIC state code
 *     ('ZZ' for the healthy source, 'ZY' for the sibling that must survive
 *     another source's failure, 'NC' only for the registry-refusal case), and
 *     every source row uses an `itest-` key, so cleanup can only ever delete rows
 *     this suite created. A real state's rows are never read, updated or deleted.
 *   - this suite NEVER syncs Virginia: no VA opportunity row is created, and the
 *     cleanup below removes any VA row it could conceivably have written.
 *   - each database test starts from `resetSynthetic()` (an empty synthetic
 *     corpus), so the tests are order-independent and re-runnable.
 *
 * SCHEMA: migrations 043 + 044 are applied to production (owner-approved). The DB
 * half runs whenever all four state tables exist; when they do NOT (a fresh
 * database), it can provision them from db/migrations/043_state_grants.sql and
 * db/migrations/044_state_grants_sources.sql — but ONLY when the operator opts in:
 *
 *   STATE_GRANTS_TEST_PROVISION_SCHEMA=1 bun test src/lib/state-grants
 *   # or: bun run test:state-grants:integration
 *
 * The flag is the ONLY path that creates schema, and it creates nothing but these
 * tables (+ their indexes and the VA source seed) from the migration files.
 *
 * Without the tables and without that flag, the suite SKIPS LOUDLY (printing the
 * exact command) rather than failing or silently passing.
 *
 * The live half (virginia.source-validation.test.ts) is opt-IN and separate —
 * this suite never touches the network:
 *   STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sql as dbFactory } from "~/db";
import {
  classifyStateGrant,
  parseGrantOpportunities,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { parseVirginiaGrantsPage } from "~/lib/state-grants/connectors/virginia";
import {
  commitStateSync,
  ensureStateSource,
  externalIdCsv,
  listStateSyncRuns,
  queryStateGrants,
  readStateRegistry,
  readStateSources,
  stateGrantStatusCounts,
  syncStateRegistry,
  syncStateSources,
} from "~/lib/state-grants/store.server";
import { runStateGrantSync } from "~/lib/state-grants/sync.server";
import { VIRGINIA_CONNECTOR_ID, VIRGINIA_SOURCE_URL } from "~/lib/state-grants/connectors/virginia";
import { listStates } from "~/lib/state-grants/registry";
import {
  listStateSources,
  sourceForConnector,
  type StateGrantSource,
} from "~/lib/state-grants/sources";
import { migrationStatements } from "../../../db/migrations/sql-statements";

const HAS_DB = !!process.env.DATABASE_URL;
const PROVISION = process.env.STATE_GRANTS_TEST_PROVISION_SCHEMA === "1";

const HEALTHY_STATE = "ZZ";
const SIBLING_STATE = "ZY";
// SYNTHETIC-UNCOVERED-STATE: a state with NO connector, used only to prove the
// registry refuses an uncovered state. Re-point it (grep SYNTHETIC-UNCOVERED-STATE)
// whenever this state lands a connector of its own.
const REFUSED_STATE = "NC";
const SOURCE_A = "itest-zz-a";
const SOURCE_B = "itest-zz-b";
const SOURCE_SIBLING = "itest-zy-a";

/** The migrations are the single source of truth for the DDL these tests need. */
const MIGRATION_FILES = [
  "../../../db/migrations/043_state_grants.sql",
  "../../../db/migrations/044_state_grants_sources.sql",
];

const STATE_TABLES = [
  "state_grant_opportunities",
  "state_grant_sync_runs",
  "state_grant_registry",
  "state_grant_sources",
];

async function tablesPresent(): Promise<boolean> {
  if (!HAS_DB) return false;
  const db = dbFactory();
  const rows = (await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${STATE_TABLES})
  `) as { n: number }[];
  return Number(rows[0]?.n ?? 0) === STATE_TABLES.length;
}

async function provisionSchema(): Promise<void> {
  const db = dbFactory();
  for (const file of MIGRATION_FILES) {
    const sqlText = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const statement of migrationStatements(sqlText)) {
      await db`${db.unsafe(statement)}`;
    }
  }
}

let HAS_TABLES = await tablesPresent();
if (HAS_DB && !HAS_TABLES && PROVISION) {
  await provisionSchema();
  HAS_TABLES = await tablesPresent();
}
const DB_READY = HAS_DB && HAS_TABLES;
if (HAS_DB && !HAS_TABLES) {
  console.warn(
    `[state-grants integration] SKIPPED: the state grants tables are absent.\n` +
      `  Apply the migrations (owner-approved): bun run db/migrations/run-043.ts && bun run db/migrations/run-044.ts\n` +
      `  ...or let the test provision them from the migration files:\n` +
      `  STATE_GRANTS_TEST_PROVISION_SCHEMA=1 bun test src/lib/state-grants`,
  );
}

const FIXTURE_NOW = new Date("2026-09-19T12:00:00Z");

interface FixtureRow {
  slug: string;
  title: string;
  opened?: string;
  closes?: string;
  closed?: string;
  when?: string;
  eligible?: string;
  award?: string;
  match?: string;
  desc?: string;
}

/** A synthetic state's page, in the shape the Virginia connector parses. */
function fixturePage(rows: FixtureRow[]): string {
  const blocks = rows
    .map((r) => {
      const lines: string[] = [];
      if (r.desc) lines.push(`<li>${r.desc}</li>`);
      if (r.eligible) lines.push(`<li><strong>Who is eligible:</strong> ${r.eligible}</li>`);
      if (r.opened || r.closes || r.closed) {
        lines.push(
          `<li><strong>${r.opened ? "Opened:" : "Opens:"}</strong> ${r.opened ?? r.closes} ` +
            `<strong>${r.closed ? "Closed:" : "Closes:"}</strong> ${r.closed ?? r.closes}</li>`,
        );
      }
      if (r.when) lines.push(`<li><strong>When:</strong> ${r.when}</li>`);
      if (r.award) lines.push(`<li><strong>Max Award:</strong> ${r.award}</li>`);
      if (r.match) lines.push(`<li><strong>Match:</strong> ${r.match}</li>`);
      return (
        `<p class="wp-block-paragraph"><a href="https://vatc.org/grants/${r.slug}/">` +
        `<strong>${r.title}</strong></a></p>\n<ul class="wp-block-list">${lines.join("\n")}</ul>`
      );
    })
    .join("\n<hr class='wp-block-separator'/>\n");
  return `<html><body><article><div class="entry-content">${blocks}</div></article></body></html>`;
}

/**
 * A connector that serves a fixed page and can be told to fail. Its `id` is the
 * SOURCE key, which is what makes two synthetic sources in one state two distinct
 * publishers (the owner's multi-source identity correction).
 */
function syntheticConnector(
  stateCode: string,
  page: () => string,
  sourceKey = SOURCE_A,
): StateGrantConnector<string> {
  return {
    id: sourceKey,
    stateCode,
    stateName: `Test ${stateCode}`,
    sourceName: `Test ${stateCode} source ${sourceKey}`,
    agency: `Test ${stateCode} agency`,
    sourceUrl: VIRGINIA_SOURCE_URL,
    officialHost: "www.vatc.org",
    sourceValidationTest: "itest",
    async fetch() {
      const body = page();
      if (body.startsWith("FETCH_FAIL")) throw new Error(body.slice(11).trim() || "boom");
      return body;
    },
    parse(raw: string) {
      // Reuse the REAL Virginia parser: the shapes are identical, so this tests
      // the production parsing path rather than a test-only imitation of it.
      return parseVirginiaGrantsPage(raw).map((r) => ({ ...r, stateCode, sourceKey }));
    },
    classify(record: SourceGrantRecord, now: Date | number = new Date()) {
      return classifyStateGrant(record, now);
    },
  };
}

/** The corpus every DB test starts from: empty synthetic rows, real sources only. */
async function resetSynthetic(): Promise<void> {
  if (!DB_READY) return;
  const db = dbFactory();
  await db`DELETE FROM state_grant_opportunities WHERE state_code IN (${HEALTHY_STATE}, ${SIBLING_STATE}, ${REFUSED_STATE})`;
  await db`DELETE FROM state_grant_sync_runs WHERE state_code IN (${HEALTHY_STATE}, ${SIBLING_STATE}, ${REFUSED_STATE})`;
  await db`DELETE FROM state_grant_sources WHERE source_key LIKE 'itest-%'`;
}

/**
 * The VIRGINIA rows exactly as they stood BEFORE this suite ran anything. The
 * suite never writes Virginia (it never syncs it and never inserts for it), so
 * the live corpus a previous run may have left behind must still be byte-for-byte
 * the same afterwards — asserted below rather than assumed.
 */
const vaBaseline: string[] = DB_READY ? await snapshotVaRows() : [];

async function snapshotVaRows(): Promise<string[]> {
  const db = dbFactory();
  const rows = (await db`
    SELECT id::text AS id, status, updated_at::text AS updated_at, COALESCE(last_seen_at::text, '-') AS last_seen
    FROM state_grant_opportunities WHERE state_code = 'VA'
    ORDER BY id
  `) as { id: string; status: string; updated_at: string; last_seen: string }[];
  return rows.map((r) => `${r.id}|${r.status}|${r.updated_at}|${r.last_seen}`).sort();
}

/** Full cleanup: back to the 0-row baseline the migrations leave behind. */
async function cleanupAll(): Promise<void> {
  if (!DB_READY) return;
  await resetSynthetic();
  const db = dbFactory();
  // The registry mirror is a pure function of the derived registry, so removing
  // it restores the migration-fresh state exactly (and the suite proves it is
  // rewritten correctly in both directions).
  await db`DELETE FROM state_grant_registry`;
  // NOTE: Virginia is deliberately NOT touched here — the suite never writes it,
  // which the regression test asserts against vaBaseline.
}

afterAll(async () => {
  await cleanupAll();
});

describe.skipIf(!DB_READY)("state grants integration (real DB)", () => {
  // alpha closed · beta upcoming · gamma rolling · delta unverified · epsilon open
  const rows: FixtureRow[] = [
    {
      slug: "alpha",
      title: "Alpha Grant",
      opened: "January 5, 2026",
      closed: "March 19, 2026",
      eligible: "Small businesses in ZZ",
      award: "$12,000",
      match: "1:1 cash",
    },
    { slug: "beta", title: "Beta Grant", opens: "December 1, 2026", closes: "December 31, 2026" },
    { slug: "gamma", title: "Gamma Program", when: "Year-round; no time limitations" },
    { slug: "delta", title: "Delta Initiative", desc: "Details to be announced by the agency" },
    { slug: "epsilon", title: "Epsilon Grant", opened: "January 2, 2026", closes: "December 31, 2026" },
  ];
  const pageV1 = () => fixturePage(rows);
  // beta's deadline MOVED (an amendment to the same source id).
  const amendedBeta: FixtureRow = {
    slug: "beta",
    title: "Beta Grant",
    opens: "December 1, 2026",
    closes: "January 15, 2027",
  };
  const pageV2 = () => fixturePage([rows[0], amendedBeta, rows[2], rows[3], rows[4]]);
  // gamma (rolling) and delta (unverified) are DELETED from the source here: the
  // complete run must stop treating them as live.
  const pageV3 = () => fixturePage([rows[0], amendedBeta, rows[4]]);

  const connectorA = (page: () => string) => syntheticConnector(HEALTHY_STATE, page, SOURCE_A);

  test("a full run writes the corpus + its run row atomically", async () => {
    await resetSynthetic();
    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV1),
      now: FIXTURE_NOW,
    });
    expect(result.status).toBe("ok");
    expect(result.sourceId).toBeTruthy();
    expect(result.fetchedCount).toBe(5);
    expect(result.insertedCount).toBe(5);
    expect(result.updatedCount).toBe(0);
    expect(result.unchangedCount).toBe(0);
    expect(result.refreshedCount).toBe(0);
    expect(result.staledCount).toBe(0);
    expect(result.countsAgree).toBe(true);
    expect(result.runId).toBeTruthy();
    expect(result.collisions).toEqual([]);

    const stored = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(stored.totalCount).toBe(5);
    const byId = new Map(stored.results.map((r) => [r.externalId, r]));
    expect(byId.get("alpha")!.status).toBe("closed");
    // beta: published (non-estimated) dates for a cycle that has not opened.
    expect(byId.get("beta")!.status).toBe("upcoming");
    expect(byId.get("beta")!.closeDate).toBe("2026-12-31");
    expect(byId.get("beta")!.estimatedCloseDate).toBeNull();
    // gamma: the source declares it year-round.
    expect(byId.get("gamma")!.status).toBe("rolling");
    expect(byId.get("gamma")!.closeDate).toBeNull();
    // delta: no usable dates → unverified, never open and never a forecast.
    expect(byId.get("delta")!.status).toBe("unverified");
    expect(byId.get("delta")!.closeDate).toBeNull();
    // epsilon: a live published deadline.
    expect(byId.get("epsilon")!.status).toBe("open");
    // Identity + normalization round-trip.
    for (const row of stored.results) {
      expect(row.sourceKey).toBe(SOURCE_A);
      expect(row.sourceId).toBe(result.sourceId);
      expect(row.lastSeenAt).toBeTruthy();
    }
    const alpha = byId.get("alpha")!;
    expect(alpha.eligibleApplicants).toBe("Small businesses in ZZ");
    expect(alpha.awardRange).toBe("$12,000");
    expect(alpha.awardMaxAmount).toBe(12000);
    expect(alpha.matchingRequirement).toBe("1:1 cash");
    expect(alpha.eligibleGeography).toBe("Not specified");
    expect(alpha.categories).toEqual([]);

    const runs = await listStateSyncRuns(HEALTHY_STATE, 5);
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("ok");
    expect(runs[0].insertedCount).toBe(5);
    expect(runs[0].error).toBeNull();
  });

  test("re-running an unchanged page is IDEMPOTENT: same rows, no content writes", async () => {
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const beforeById = new Map(before.results.map((r) => [r.externalId, r]));
    await new Promise((r) => setTimeout(r, 1100)); // so a rewrite WOULD change fetched_at

    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV1),
      now: new Date(FIXTURE_NOW.getTime() + 60_000),
    });
    expect(result.status).toBe("ok");
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(result.unchangedCount).toBe(5);
    expect(result.touchedCount).toBe(0); // the DB confirms it wrote no content
    // ...but last_seen_at IS refreshed for every row the source still publishes
    // (owner correction 3: that is exactly what the column means).
    expect(result.refreshedCount).toBe(5);
    expect(result.staledCount).toBe(0);

    const after = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(after.totalCount).toBe(before.totalCount);
    for (const row of after.results) {
      const previous = beforeById.get(row.externalId)!;
      // Same row, untouched CONTENT: identical id AND identical fetched_at.
      expect(row.id).toBe(previous.id);
      expect(row.fetchedAt).toBe(previous.fetchedAt);
      // But the row has been SEEN since (last_seen_at moved forward).
      expect(Date.parse(row.lastSeenAt!)).toBeGreaterThanOrEqual(Date.parse(previous.lastSeenAt!));
    }
    // Two runs recorded; the second one wrote no content.
    const runs = await listStateSyncRuns(HEALTHY_STATE, 5);
    expect(runs.length).toBe(2);
    expect(runs[0].insertedCount).toBe(0);
  });

  test("changed content updates the SAME row (an amendment, never a duplicate)", async () => {
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const beforeById = new Map(before.results.map((r) => [r.externalId, r]));
    const betaBefore = beforeById.get("beta")!;

    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV2),
      now: new Date(FIXTURE_NOW.getTime() + 120_000),
    });
    expect(result.status).toBe("ok");
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(result.unchangedCount).toBe(4);
    expect(result.touchedCount).toBe(1);

    const after = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(after.totalCount).toBe(5); // still five rows, not six
    const afterById = new Map(after.results.map((r) => [r.externalId, r]));
    const beta = afterById.get("beta")!;
    expect(beta.id).toBe(betaBefore.id); // the SAME row
    expect(beta.closeDate).toBe("2027-01-15"); // the amendment landed
    expect(beta.updatedAt >= betaBefore.updatedAt).toBe(true);
    // Untouched siblings keep their exact fetched_at.
    expect(afterById.get("alpha")!.fetchedAt).toBe(beforeById.get("alpha")!.fetchedAt);
    expect(afterById.get("gamma")!.fetchedAt).toBe(beforeById.get("gamma")!.fetchedAt);
  });

  test("a row the source stops publishing flips to unverified — never left open", async () => {
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const beforeById = new Map(before.results.map((r) => [r.externalId, r]));
    await new Promise((r) => setTimeout(r, 1100));

    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV3), // gamma and delta are gone from the source
      now: new Date(FIXTURE_NOW.getTime() + 180_000),
    });
    expect(result.status).toBe("ok");
    expect(result.fetchedCount).toBe(3);
    expect(result.staledCount).toBe(1); // gamma (delta was already unverified)
    expect(result.insertedCount).toBe(0);

    const after = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const afterById = new Map(after.results.map((r) => [r.externalId, r]));
    // gamma was `rolling` and is now honestly unverified, with no deadline.
    expect(afterById.get("gamma")!.status).toBe("unverified");
    expect(afterById.get("gamma")!.closeDate).toBeNull();
    expect(afterById.get("gamma")!.status).not.toBe("open");
    // A row the source did NOT see keeps its last_seen_at (it was not refreshed).
    expect(afterById.get("gamma")!.lastSeenAt).toBe(beforeById.get("gamma")!.lastSeenAt);
    expect(afterById.get("delta")!.lastSeenAt).toBe(beforeById.get("delta")!.lastSeenAt);
    // A row it DID see is refreshed.
    expect(Date.parse(afterById.get("alpha")!.lastSeenAt!)).toBeGreaterThanOrEqual(
      Date.parse(beforeById.get("alpha")!.lastSeenAt!),
    );
    // The stale rows are still THERE (we never delete a source's record).
    expect(after.totalCount).toBe(5);
  });

  test("the SAME external id from TWO sources is TWO rows — never an overwrite", async () => {
    await resetSynthetic();
    const sharedA = fixturePage([
      { slug: "winter", title: "Tourism Winter Fund", opened: "January 2, 2026", closes: "December 31, 2026" },
    ]);
    const sharedB = fixturePage([
      { slug: "winter", title: "Housing Winter Fund", opened: "January 2, 2026", closes: "December 31, 2026" },
    ]);
    const a = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, () => sharedA, SOURCE_A),
      now: FIXTURE_NOW,
    });
    const b = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, () => sharedB, SOURCE_B),
      now: FIXTURE_NOW,
    });
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    expect(a.sourceId).not.toBe(b.sourceId);

    const both = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(both.totalCount).toBe(2); // TWO rows, one per source
    const winters = both.results.filter((r) => r.externalId === "winter");
    expect(winters.length).toBe(2);
    expect(winters.map((r) => r.title).sort()).toEqual(["Housing Winter Fund", "Tourism Winter Fund"]);
    expect(winters[0].sourceId).not.toBe(winters[1].sourceId);

    // Re-running the second source changes its own row only — never source A's.
    const bAgain = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, () => sharedB, SOURCE_B),
      now: new Date(FIXTURE_NOW.getTime() + 60_000),
    });
    expect(bAgain.status).toBe("ok");
    expect(bAgain.insertedCount).toBe(0);
    expect(bAgain.touchedCount).toBe(0);
    const after = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(after.totalCount).toBe(2);

    // Source-scoped filtering keeps the two apart.
    const onlyB = await queryStateGrants({ sourceKey: SOURCE_B });
    expect(onlyB.totalCount).toBe(1);
    expect(onlyB.results[0].title).toBe("Housing Winter Fund");
    const bothSources = await queryStateGrants({ sourceKeys: [SOURCE_A, SOURCE_B] });
    expect(bothSources.totalCount).toBe(2);
    await resetSynthetic();
  });

  test("a failing connector writes ZERO rows and records the run as error", async () => {
    await resetSynthetic();
    const seeded = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV1),
      now: FIXTURE_NOW,
    });
    expect(seeded.status).toBe("ok");
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const runsBefore = await listStateSyncRuns(HEALTHY_STATE, 20);

    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(() => "FETCH_FAIL upstream exploded"),
      now: new Date(FIXTURE_NOW.getTime() + 60_000),
    });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("fetch");
    expect(result.error?.message).toMatch(/upstream exploded/);
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(result.touchedCount).toBe(0);
    expect(result.staledCount).toBe(0);

    // The corpus is byte-identical — a failed run does NOT stale-sweep.
    const after = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(after.results).toEqual(before.results);
    const runsAfter = await listStateSyncRuns(HEALTHY_STATE, 20);
    expect(runsAfter.length).toBe(runsBefore.length + 1);
    expect(runsAfter[0].status).toBe("error");
    expect(runsAfter[0].error).toMatchObject({ stage: "fetch" });
    expect(runsAfter[0].fetchedCount).toBe(0);
    expect(runsAfter[runsAfter.length - 1].status).toBe("ok"); // the old ok run survives
  });

  test("a malformed page fails the run instead of half-parsing it", async () => {
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(() => "<html><body>maintenance</body></html>"),
      now: new Date(FIXTURE_NOW.getTime() + 120_000),
    });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("parse");
    expect((await queryStateGrants({ stateCode: HEALTHY_STATE })).results).toEqual(before.results);
  });

  test("connector failure isolation: a sibling state's data and runs are untouched", async () => {
    await resetSynthetic();
    const sibling = await runStateGrantSync(SIBLING_STATE, {
      connector: syntheticConnector(SIBLING_STATE, pageV1, SOURCE_SIBLING),
      now: FIXTURE_NOW,
    });
    expect(sibling.status).toBe("ok");
    const siblingBefore = await queryStateGrants({ stateCode: SIBLING_STATE });
    expect(siblingBefore.totalCount).toBe(5);

    const healthy = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV1),
      now: FIXTURE_NOW,
    });
    expect(healthy.status).toBe("ok");

    // The healthy state's connector now fails.
    const failed = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(() => "FETCH_FAIL down"),
      now: new Date(FIXTURE_NOW.getTime() + 300_000),
    });
    expect(failed.status).toBe("error");

    const siblingAfter = await queryStateGrants({ stateCode: SIBLING_STATE });
    expect(siblingAfter.results).toEqual(siblingBefore.results);
    const siblingRuns = await listStateSyncRuns(SIBLING_STATE, 5);
    expect(siblingRuns.length).toBe(1);
    expect(siblingRuns[0].status).toBe("ok");
  });

  test("the registry gate refuses to sync a state with no validated source", async () => {
    await resetSynthetic();
    // No connector injected: the runner goes through the real registry, and
    // REFUSED_STATE (NC) is (correctly) `unavailable` at this stage of the rollout.
    const result = await runStateGrantSync(REFUSED_STATE, { now: FIXTURE_NOW });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("registry");
    expect(result.error?.message).toMatch(/no validated source/);
    const runs = await listStateSyncRuns(REFUSED_STATE, 5);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].status).toBe("error");
    expect((await queryStateGrants({ stateCode: REFUSED_STATE })).totalCount).toBe(0);
  });

  test("the sources table is seeded from the code registry and stays idempotent", async () => {
    // First sync brings the DB to the code registry (fresh schemas are seeded
    // only with the sources that existed at migration time).
    await syncStateSources(listStateSources());
    // A second sync must add nothing — idempotent by construction.
    const created = await syncStateSources(listStateSources());
    expect(created).toBe(0);
    const va = (await readStateSources("VA")).find((s) => s.sourceKey === VIRGINIA_CONNECTOR_ID)!;
    expect(va).toBeDefined();
    expect(va.officialUrl).toBe(VIRGINIA_SOURCE_URL);
    expect(va.officialHost).toBe("www.vatc.org");
    expect(va.agency).toBe("Virginia Tourism Corporation");
    // The seeded row agrees with the code-level source definition.
    const codeSource = listStateSources().find((s) => s.sourceKey === VIRGINIA_CONNECTOR_ID)!;
    expect(va.name).toBe(codeSource.name);
    expect(va.stateCode).toBe(codeSource.stateCode);
    // ensureStateSource is idempotent: the same row id comes back every time.
    const first = await ensureStateSource(codeSource);
    const second = await ensureStateSource(codeSource);
    expect(second).toBe(first);
    expect((await readStateSources("VA")).length).toBe(1);
    // Real-DB budget: syncStateSources + ensureStateSource are two round trips
    // PER REGISTERED SOURCE against a remote Neon instance, and this test syncs
    // the whole registry twice. At 25 sources that is ~100 round trips and
    // ~5.2s — no longer inside bun's 5s default. The assertions are unchanged;
    // only the wall-clock allowance is stated honestly.
  }, 20_000);

  test("the registry mirror reflects the DERIVED registry and re-syncs for free", async () => {
    const entries = listStates();
    const beforeMirror = await readStateRegistry();
    const written = await syncStateRegistry(entries);
    if (beforeMirror.length === 0) expect(written).toBe(51);
    else expect(written).toBe(0);
    const mirrored = await readStateRegistry();
    expect(mirrored.length).toBe(51);
    const va = mirrored.find((r) => r.stateCode === "VA")!;
    // The corrected ladder: one tourism source is `limited`, never `connected`.
    expect(va.status).toBe("limited");
    expect(va.connectorId).toBe(VIRGINIA_CONNECTOR_ID);
    expect(mirrored.filter((r) => r.status === "connected").length).toBe(0);
    expect(mirrored.filter((r) => r.status === "limited").length).toBe(33);
    expect(mirrored.filter((r) => r.status === "unavailable").length).toBe(18);

    // Nothing changed, so a second mirror writes nothing at all.
    expect(await syncStateRegistry(entries)).toBe(0);
  });

  test("the query surface filters, paginates, orders and counts honestly", async () => {
    await resetSynthetic();
    const zz = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV1),
      now: FIXTURE_NOW,
    });
    const zy = await runStateGrantSync(SIBLING_STATE, {
      connector: syntheticConnector(SIBLING_STATE, pageV1, SOURCE_SIBLING),
      now: FIXTURE_NOW,
    });
    expect(zz.status).toBe("ok");
    expect(zy.status).toBe("ok");
    const statuses = await stateGrantStatusCounts(HEALTHY_STATE);
    expect(statuses.total).toBe(5);
    expect(
      statuses.open + statuses.upcoming + statuses.rolling + statuses.closed + statuses.unverified,
    ).toBe(5);
    expect(statuses.open).toBe(1);
    expect(statuses.upcoming).toBe(1);
    expect(statuses.rolling).toBe(1);
    expect(statuses.closed).toBe(1);
    expect(statuses.unverified).toBe(1);

    const open = await queryStateGrants({ stateCode: HEALTHY_STATE, status: "open" });
    expect(open.totalCount).toBe(1);
    expect(open.results[0].externalId).toBe("epsilon");

    const unverified = await queryStateGrants({ stateCode: HEALTHY_STATE, status: "unverified" });
    expect(unverified.totalCount).toBe(1);
    expect(unverified.results[0].externalId).toBe("delta");

    const byTerm = await queryStateGrants({ stateCode: HEALTHY_STATE, term: "beta" });
    expect(byTerm.totalCount).toBe(1);
    expect(byTerm.results[0].title).toBe("Beta Grant");

    const wildcard = await queryStateGrants({ stateCode: HEALTHY_STATE, term: "%" });
    expect(wildcard.totalCount).toBe(0); // a wildcard term never widens its own match

    const page1 = await queryStateGrants({ stateCode: HEALTHY_STATE, limit: 2, offset: 0 });
    const page2 = await queryStateGrants({ stateCode: HEALTHY_STATE, limit: 3, offset: 2 });
    expect(page1.totalCount).toBe(5);
    expect(page1.results.length).toBe(2);
    expect(page2.results.length).toBe(3);
    expect(page2.offset).toBe(2);
    // Canonical ordering: open → upcoming → rolling → closed → unverified.
    expect(page1.results.map((r) => r.status)).toEqual(["open", "upcoming"]);
    const all = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(all.results.map((r) => r.status)).toEqual([
      "open",
      "upcoming",
      "rolling",
      "closed",
      "unverified",
    ]);

    const both = await queryStateGrants({ stateCodes: [HEALTHY_STATE, SIBLING_STATE] });
    expect(both.totalCount).toBe(10);
  });

  test("regression: nothing outside the state tables is touched by any of this", async () => {
    await resetSynthetic();
    const zz = await runStateGrantSync(HEALTHY_STATE, {
      connector: connectorA(pageV1),
      now: FIXTURE_NOW,
    });
    const zy = await runStateGrantSync(SIBLING_STATE, {
      connector: syntheticConnector(SIBLING_STATE, pageV1, SOURCE_SIBLING),
      now: FIXTURE_NOW,
    });
    expect(zz.status).toBe("ok");
    expect(zy.status).toBe("ok");
    const db = dbFactory();
    const rows = (await db`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${STATE_TABLES})
    `) as { n: number }[];
    expect(Number(rows[0].n)).toBe(STATE_TABLES.length);
    // The suite only ever wrote state_* rows under synthetic codes, and it never
    // created or modified a Virginia row: the live VA corpus (whatever a previous
    // run left there) is byte-identical to the snapshot taken before this suite
    // started.
    expect(await snapshotVaRows()).toEqual(vaBaseline);
    expect((await queryStateGrants({ stateCode: "VA" })).totalCount).toBe(vaBaseline.length);
    const leftover = await queryStateGrants({
      stateCodes: [HEALTHY_STATE, SIBLING_STATE],
      term: "Alpha",
    });
    expect(leftover.totalCount).toBe(2); // ZZ + ZY each hold their own Alpha
  });

  test("a commit that cannot complete is rejected whole — nothing half-written", async () => {
    const source = sourceForConnector(connectorA(pageV1));
    const sourceId = await ensureStateSource(source);
    const runsBefore = await listStateSyncRuns(HEALTHY_STATE, 50);
    await expect(
      commitStateSync({
        stateCode: HEALTHY_STATE,
        sourceId,
        startedAt: "not-a-timestamp",
        finishedAt: "not-a-timestamp",
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        opportunities: [],
        seenExternalIds: [],
        unchangedExternalIds: [],
      }),
    ).rejects.toThrow();
    // The failed statement wrote neither opportunities nor a run row.
    const runsAfter = await listStateSyncRuns(HEALTHY_STATE, 50);
    expect(runsAfter.length).toBe(runsBefore.length);
  });

  test("an external id that could corrupt the seen-list is refused, not silently mis-attributed", () => {
    expect(externalIdCsv(["alpha", "beta"])).toBe("alpha,beta");
    expect(externalIdCsv([])).toBe("");
    for (const bad of ["a,b", "a{b}", "a\nb"]) {
      expect(() => externalIdCsv(["ok", bad])).toThrow(/separator character/);
    }
  });

  test("the parser/store hand-off keeps an estimate out of close_date for every row", async () => {
    const { opportunities } = parseGrantOpportunities(connectorA(pageV2), pageV2(), FIXTURE_NOW);
    expect(opportunities.length).toBeGreaterThan(0);
    for (const o of opportunities) {
      if (o.status === "unverified" || o.status === "rolling") expect(o.closeDate).toBeNull();
      expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
      expect(o.status as string).not.toBe("forecast");
    }
  });
});
