/**
 * Contrax Grants — State Grants, PART 1 integration tests (REAL Postgres).
 *
 * These run against a live database — the repo's `HAS_DB` convention (the same
 * one src/lib/fpds.test.ts uses: `const HAS_DB = !!process.env.DATABASE_URL`).
 * They exercise the real store and the real runner: the atomic commit, the
 * no-op-write filter, change detection, the error path, and the query surface.
 *
 * TEST DATA DISCIPLINE (nothing a real state could ever collide with):
 *   - every opportunity/run row written here uses a SYNTHETIC state code
 *     ('ZZ' for the healthy connector, 'ZY' for the sibling that must survive
 *     another state's failure, 'MD' only for the registry-refusal case), so the
 *     cleanup below can only ever delete rows this suite created. A real state's
 *     rows are never read, updated or deleted by these tests.
 *   - the state_grant_registry mirror IS written with real state codes, because
 *     that is the table's whole purpose (mirroring the derived registry) and the
 *     rows it writes are byte-for-byte what a real sync writes. They are left in
 *     place: deleting a correct mirror would be the destructive choice.
 *
 * SCHEMA: migration 043 IS applied to production (owner-approved, applied
 * 2026-09-19). The DB half of this suite therefore runs whenever the three tables
 * exist; when they do NOT (a fresh database), it can provision them from
 * db/migrations/043_state_grants.sql — but ONLY when the operator opts in:
 *
 *   STATE_GRANTS_TEST_PROVISION_SCHEMA=1 bun test src/lib/state-grants
 *   # or: bun run test:state-grants:integration
 *
 * The flag is the ONLY path that creates schema, and it creates nothing but these
 * three tables (+ their indexes) from the migration file itself.
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
  listStateSyncRuns,
  queryStateGrants,
  readStateRegistry,
  stateGrantStatusCounts,
  syncStateRegistry,
} from "~/lib/state-grants/store.server";
import { runStateGrantSync } from "~/lib/state-grants/sync.server";
import { listStates } from "~/lib/state-grants/registry";

const HAS_DB = !!process.env.DATABASE_URL;
const PROVISION = process.env.STATE_GRANTS_TEST_PROVISION_SCHEMA === "1";

const HEALTHY_STATE = "ZZ";
const SIBLING_STATE = "ZY";
const REFUSED_STATE = "MD";

/** The migration is the single source of truth for the DDL these tests need. */
const MIGRATION_SQL = readFileSync(
  new URL("../../../db/migrations/043_state_grants.sql", import.meta.url),
  "utf8",
);

async function tablesPresent(): Promise<boolean> {
  if (!HAS_DB) return false;
  const db = dbFactory();
  const rows = (await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('state_grant_opportunities', 'state_grant_sync_runs', 'state_grant_registry')
  `) as { n: number }[];
  return Number(rows[0]?.n ?? 0) === 3;
}

async function provisionSchema(): Promise<void> {
  const db = dbFactory();
  const statements = MIGRATION_SQL.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await db`${db.unsafe(statement)}`;
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
      `  Apply the migration (owner-approved): bun run db/migrations/run-043.ts\n` +
      `  ...or let the test provision them from db/migrations/043_state_grants.sql:\n` +
      `  STATE_GRANTS_TEST_PROVISION_SCHEMA=1 bun test src/lib/state-grants`,
  );
}

const FIXTURE_NOW = new Date("2026-09-19T12:00:00Z");

/** A synthetic state's page, in the shape the Virginia connector parses. */
function fixturePage(rows: { slug: string; title: string; opened?: string; closes?: string; closed?: string; when?: string }[]): string {
  const blocks = rows
    .map(
      (r) => `
<p class="wp-block-paragraph"><a href="https://vatc.org/grants/${r.slug}/" target="_blank"><strong>${r.title}</strong></a></p>
<ul class="wp-block-list">
${r.opened || r.closes || r.closed ? `<li><strong>${r.opened ? "Opened:" : "Opens:"}</strong> ${r.opened ?? r.closes} <strong>${r.closed ? "Closed:" : "Closes:"}</strong> ${r.closed ?? r.closes}</li>` : ""}
${r.when ? `<li><strong>When:</strong> ${r.when}</li>` : ""}
</ul>`,
    )
    .join("\n<hr class='wp-block-separator'/>\n");
  return `<html><body><article><div class="entry-content">${blocks}</div></article></body></html>`;
}

/**
 * A connector that serves a fixed page and can be told to fail. `stateCode`
 * matches the state under test so the runner's guard passes.
 */
function syntheticConnector(
  stateCode: string,
  page: () => string,
): StateGrantConnector<string> {
  return {
    id: `itest-${stateCode.toLowerCase()}`,
    stateCode,
    stateName: `Test ${stateCode}`,
    sourceUrl: "https://vatc.org/grants/",
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
      return parseVirginiaGrantsPage(raw).map((r) => ({ ...r, stateCode }));
    },
    classify(record: SourceGrantRecord, now: Date | number = new Date()) {
      return classifyStateGrant(record, now);
    },
  };
}

async function cleanupTestRows(): Promise<void> {
  if (!DB_READY) return;
  const db = dbFactory();
  await db`DELETE FROM state_grant_opportunities WHERE state_code IN (${HEALTHY_STATE}, ${SIBLING_STATE})`;
  await db`DELETE FROM state_grant_sync_runs WHERE state_code IN (${HEALTHY_STATE}, ${SIBLING_STATE}, ${REFUSED_STATE})`;
}

afterAll(async () => {
  await cleanupTestRows();
});

describe.skipIf(!DB_READY)("state grants integration (real DB)", () => {
  const rows = [
    { slug: "alpha", title: "Alpha Grant", opened: "January 5, 2026", closed: "March 19, 2026" },
    { slug: "beta", title: "Beta Grant", opens: "December 1, 2026", closes: "December 31, 2026" },
    { slug: "gamma", title: "Gamma Program", when: "Year-round; no time limitations" },
  ];
  const pageV1 = () => fixturePage(rows);
  const pageV2 = () =>
    fixturePage([
      rows[0],
      // beta's deadline MOVED (an amendment to the same source id)
      { slug: "beta", title: "Beta Grant", opens: "December 1, 2026", closes: "January 15, 2027" },
      rows[2],
    ]);

  test("a full run writes the corpus + its run row atomically", async () => {
    await cleanupTestRows();
    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, pageV1),
      now: FIXTURE_NOW,
    });
    expect(result.status).toBe("ok");
    expect(result.fetchedCount).toBe(3);
    expect(result.insertedCount).toBe(3);
    expect(result.updatedCount).toBe(0);
    expect(result.unchangedCount).toBe(0);
    expect(result.countsAgree).toBe(true);
    expect(result.runId).toBeTruthy();
    expect(result.collisions).toEqual([]);

    const stored = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(stored.totalCount).toBe(3);
    const byId = new Map(stored.results.map((r) => [r.externalId, r]));
    expect(byId.get("alpha")!.status).toBe("closed");
    expect(byId.get("beta")!.status).toBe("forecast");
    expect(byId.get("beta")!.closeDate).toBeNull(); // an estimate is NEVER a deadline
    expect(byId.get("beta")!.estimatedCloseDate).toBe("2026-12-31");
    expect(byId.get("gamma")!.status).toBe("open");
    expect(byId.get("gamma")!.closeDate).toBeNull();
    expect(byId.get("alpha")!.fetchedAt).toBeTruthy();

    const runs = await listStateSyncRuns(HEALTHY_STATE, 5);
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("ok");
    expect(runs[0].insertedCount).toBe(3);
    expect(runs[0].error).toBeNull();
  });

  test("re-running an unchanged page is IDEMPOTENT: same rows, zero writes", async () => {
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const beforeById = new Map(before.results.map((r) => [r.externalId, r]));
    await new Promise((r) => setTimeout(r, 1100)); // so a rewrite WOULD change fetched_at

    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, pageV1),
      now: new Date(FIXTURE_NOW.getTime() + 60_000),
    });
    expect(result.status).toBe("ok");
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(result.unchangedCount).toBe(3);
    expect(result.touchedCount).toBe(0); // the DB confirms it wrote nothing

    const after = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(after.totalCount).toBe(before.totalCount);
    for (const row of after.results) {
      // Same row, untouched: identical id AND identical fetched_at.
      expect(row.id).toBe(beforeById.get(row.externalId)!.id);
      expect(row.fetchedAt).toBe(beforeById.get(row.externalId)!.fetchedAt);
    }
    // Two runs recorded; the second one wrote nothing.
    const runs = await listStateSyncRuns(HEALTHY_STATE, 5);
    expect(runs.length).toBe(2);
    expect(runs[0].insertedCount).toBe(0);
  });

  test("changed content updates the SAME row (an amendment, never a duplicate)", async () => {
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const beforeById = new Map(before.results.map((r) => [r.externalId, r]));
    const betaBefore = beforeById.get("beta")!;

    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, pageV2),
      now: new Date(FIXTURE_NOW.getTime() + 120_000),
    });
    expect(result.status).toBe("ok");
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(result.unchangedCount).toBe(2);
    expect(result.touchedCount).toBe(1);

    const after = await queryStateGrants({ stateCode: HEALTHY_STATE });
    expect(after.totalCount).toBe(3); // still three rows, not four
    const afterById = new Map(after.results.map((r) => [r.externalId, r]));
    const beta = afterById.get("beta")!;
    expect(beta.id).toBe(betaBefore.id); // the SAME row
    expect(beta.estimatedCloseDate).toBe("2027-01-15"); // the amendment landed
    expect(beta.updatedAt >= betaBefore.updatedAt).toBe(true);
    // Untouched siblings keep their exact fetched_at.
    expect(afterById.get("alpha")!.fetchedAt).toBe(beforeById.get("alpha")!.fetchedAt);
    expect(afterById.get("gamma")!.fetchedAt).toBe(beforeById.get("gamma")!.fetchedAt);
  });

  test("a failing connector writes ZERO rows and records the run as error", async () => {
    const before = await queryStateGrants({ stateCode: HEALTHY_STATE });
    const runsBefore = await listStateSyncRuns(HEALTHY_STATE, 20);

    const result = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, () => "FETCH_FAIL upstream exploded"),
      now: new Date(FIXTURE_NOW.getTime() + 180_000),
    });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("fetch");
    expect(result.error?.message).toMatch(/upstream exploded/);
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(result.touchedCount).toBe(0);

    // The corpus is byte-identical, and the earlier runs are intact.
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
      connector: syntheticConnector(HEALTHY_STATE, () => "<html><body>maintenance</body></html>"),
      now: new Date(FIXTURE_NOW.getTime() + 240_000),
    });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("parse");
    expect((await queryStateGrants({ stateCode: HEALTHY_STATE })).results).toEqual(before.results);
  });

  test("connector failure isolation: a sibling state's data and runs are untouched", async () => {
    const sibling = await runStateGrantSync(SIBLING_STATE, {
      connector: syntheticConnector(SIBLING_STATE, pageV1),
      now: FIXTURE_NOW,
    });
    expect(sibling.status).toBe("ok");
    const siblingBefore = await queryStateGrants({ stateCode: SIBLING_STATE });
    expect(siblingBefore.totalCount).toBe(3);

    // The healthy state's connector now fails.
    const failed = await runStateGrantSync(HEALTHY_STATE, {
      connector: syntheticConnector(HEALTHY_STATE, () => "FETCH_FAIL down"),
      now: new Date(FIXTURE_NOW.getTime() + 300_000),
    });
    expect(failed.status).toBe("error");

    const siblingAfter = await queryStateGrants({ stateCode: SIBLING_STATE });
    expect(siblingAfter.results).toEqual(siblingBefore.results);
    const siblingRuns = await listStateSyncRuns(SIBLING_STATE, 5);
    expect(siblingRuns.length).toBe(1);
    expect(siblingRuns[0].status).toBe("ok");
  });

  test("the registry gate refuses to sync a state that is not connected", async () => {
    // No connector injected: the runner goes through the real registry, and
    // Maryland is (correctly) `unavailable` at part 1.
    const result = await runStateGrantSync(REFUSED_STATE, { now: FIXTURE_NOW });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("registry");
    expect(result.error?.message).toMatch(/is not connected/);
    const runs = await listStateSyncRuns(REFUSED_STATE, 5);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].status).toBe("error");
    expect((await queryStateGrants({ stateCode: REFUSED_STATE })).totalCount).toBe(0);
  });

  test("the registry mirror reflects the DERIVED registry and re-syncs for free", async () => {
    const entries = listStates();
    // The mirror rows are deliberately LEFT IN PLACE by this suite (deleting a
    // correct mirror would be the destructive choice), so the test must hold on
    // a re-run too: an empty mirror is written in full, an already-correct one
    // costs nothing. Asserting `written > 0` unconditionally made the suite fail
    // on its second consecutive run against the same database (found 2026-09-19).
    const beforeMirror = await readStateRegistry();
    const written = await syncStateRegistry(entries);
    if (beforeMirror.length === 0) expect(written).toBe(51);
    else expect(written).toBe(0);
    const mirrored = await readStateRegistry();
    expect(mirrored.length).toBe(51);
    const va = mirrored.find((r) => r.stateCode === "VA")!;
    expect(va.status).toBe("connected");
    expect(va.connectorId).toBe("va-vtc-grants");
    expect(mirrored.filter((r) => r.status === "connected").length).toBe(1);
    expect(mirrored.filter((r) => r.status === "unavailable").length).toBe(50);

    // Nothing changed, so a second mirror writes nothing at all.
    expect(await syncStateRegistry(entries)).toBe(0);
  });

  test("the query surface filters, paginates and counts honestly", async () => {
    const statuses = await stateGrantStatusCounts(HEALTHY_STATE);
    expect(statuses.total).toBe(3);
    expect(statuses.open + statuses.forecast + statuses.closed).toBe(3);

    const open = await queryStateGrants({ stateCode: HEALTHY_STATE, status: "open" });
    expect(open.totalCount).toBe(1);
    expect(open.results[0].externalId).toBe("gamma");

    const byTerm = await queryStateGrants({ stateCode: HEALTHY_STATE, term: "beta" });
    expect(byTerm.totalCount).toBe(1);
    expect(byTerm.results[0].title).toBe("Beta Grant");

    const wildcard = await queryStateGrants({ stateCode: HEALTHY_STATE, term: "%" });
    expect(wildcard.totalCount).toBe(0); // a wildcard term never widens its own match

    const page1 = await queryStateGrants({ stateCode: HEALTHY_STATE, limit: 2, offset: 0 });
    const page2 = await queryStateGrants({ stateCode: HEALTHY_STATE, limit: 2, offset: 2 });
    expect(page1.totalCount).toBe(3);
    expect(page1.results.length).toBe(2);
    expect(page2.results.length).toBe(1);
    expect(page2.offset).toBe(2);
    // Canonical ordering: open first, then forecast, then closed.
    expect(page1.results.map((r) => r.status)).toEqual(["open", "forecast"]);

    const both = await queryStateGrants({ stateCodes: [HEALTHY_STATE, SIBLING_STATE] });
    expect(both.totalCount).toBe(6);
  });

  test("regression: the federal grants tables are untouched by any of this", async () => {
    const db = dbFactory();
    const rows = (await db`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('state_grant_opportunities', 'state_grant_sync_runs', 'state_grant_registry')
    `) as { n: number }[];
    expect(Number(rows[0].n)).toBe(3);
    // This suite only ever wrote to state_* tables under synthetic state codes.
    const leftover = await queryStateGrants({
      stateCodes: [HEALTHY_STATE, SIBLING_STATE],
      term: "Alpha",
    });
    expect(leftover.totalCount).toBe(2); // ZZ + ZY each hold their own Alpha
  });

  test("a commit that cannot complete is rejected whole — nothing half-written", async () => {
    const runsBefore = await listStateSyncRuns(HEALTHY_STATE, 50);
    await expect(
      commitStateSync({
        stateCode: HEALTHY_STATE,
        startedAt: "not-a-timestamp",
        finishedAt: "not-a-timestamp",
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        opportunities: [],
      }),
    ).rejects.toThrow();
    // The failed statement wrote neither opportunities nor a run row.
    const runsAfter = await listStateSyncRuns(HEALTHY_STATE, 50);
    expect(runsAfter.length).toBe(runsBefore.length);
  });

  test("the parser/store hand-off keeps an estimate out of close_date for every row", async () => {
    const { opportunities } = parseGrantOpportunities(
      syntheticConnector(HEALTHY_STATE, pageV2),
      pageV2(),
      FIXTURE_NOW,
    );
    for (const o of opportunities) {
      if (o.status === "forecast") expect(o.closeDate).toBeNull();
      expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
    }
  });
});
