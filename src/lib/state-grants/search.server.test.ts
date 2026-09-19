/**
 * Contrax Grants — STATE GRANT API BUILDERS: unit tests (no database, no network).
 *
 * The store is INJECTED (the sync runner's pattern), so these tests pin the exact
 * response contract the routes serve — including the fail-closed 500 — without a
 * database in the process. The real store is exercised in
 * state-grants-search.integration.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { StateGrantRow } from "~/lib/state-grants/store.server";
import {
  runStateGrantSearch,
  type StateGrantSearchDeps,
} from "~/lib/state-grants/search.server";
import {
  buildStateGrantCoverage,
  coverageHeadline,
  type StateGrantCoverageDeps,
} from "~/lib/state-grants/coverage.server";
import { STATE_GRANT_DEFAULT_LIMIT } from "~/lib/state-grants/search";

const NOW = new Date("2026-09-19T12:00:00Z");

function row(overrides: Partial<StateGrantRow> = {}): StateGrantRow {
  return {
    id: "row-1",
    stateCode: "VA",
    externalId: "demo",
    title: "Demo Program",
    agency: "Virginia Tourism Corporation",
    summary: "A summary",
    status: "open",
    postedDate: "2026-01-05",
    closeDate: "2026-12-31",
    estimatedCloseDate: null,
    url: "https://www.vatc.org/grants/demo/",
    sourceUrl: "https://www.vatc.org/grants/",
    sourceUpdatedAt: null,
    fetchedAt: "2026-09-19T12:00:03.000Z",
    updatedAt: "2026-09-19T12:00:03.000Z",
    ...overrides,
  };
}

function deps(overrides: Partial<StateGrantSearchDeps> = {}): StateGrantSearchDeps {
  return {
    queryStateGrants: (async () => ({
      results: [],
      totalCount: 0,
      statesIncluded: [],
      limit: STATE_GRANT_DEFAULT_LIMIT,
      offset: 0,
    })) as unknown as StateGrantSearchDeps["queryStateGrants"],
    latestStateGrantSync: (async () => "2026-09-19T12:00:03.247Z") as unknown as StateGrantSearchDeps["latestStateGrantSync"],
    ...overrides,
  };
}

describe("runStateGrantSearch", () => {
  test("a valid request returns the honest payload shape", async () => {
    const outcome = await runStateGrantSearch({ stateCodes: ["VA"], status: "open" }, NOW, deps({
      queryStateGrants: (async (query: { limit?: number; offset?: number }) => ({
        results: [row(), row({ id: "row-2", externalId: "demo-2", status: "forecast", closeDate: null, estimatedCloseDate: "2026-10-29" })],
        totalCount: 7,
        statesIncluded: ["VA"],
        limit: query.limit ?? STATE_GRANT_DEFAULT_LIMIT,
        offset: query.offset ?? 0,
      })) as unknown as StateGrantSearchDeps["queryStateGrants"],
    }));
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) throw new Error("unreachable");
    const body = outcome.body;
    expect(body.ok).toBe(true);
    expect(body.status).toBe("open");
    expect(body.statesIncluded).toEqual(["VA"]);
    expect(body.statesMatched).toEqual(["VA"]);
    expect(body.totalCount).toBe(7);
    expect(body.countExact).toBe(true);
    expect(body.asOf).toBe("2026-09-19T12:00:03.247Z");
    expect(body.returned).toBe(2);
    expect(body.hasMore).toBe(true);
    expect(body.countLabel).toContain("7 records open");
    expect(body.records[0].sourceLabel).toBe("Virginia Tourism Corporation — vatc.org");
    expect(body.records[1].closeDate).toBeNull();
    expect(body.records[1].deadline?.value).toContain("source estimate");
  });

  test("no state filter searches every connected state and says so", async () => {
    let seen: { stateCodes?: string[] | null } | null = null;
    const outcome = await runStateGrantSearch({}, NOW, deps({
      queryStateGrants: (async (query: { stateCodes?: string[] | null }) => {
        seen = query;
        return { results: [], totalCount: 0, statesIncluded: [], limit: 25, offset: 0 };
      }) as unknown as StateGrantSearchDeps["queryStateGrants"],
    }));
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) throw new Error("unreachable");
    expect(seen?.stateCodes).toBeNull(); // no filter: the store decides
    expect(outcome.body.statesIncluded).toEqual(["VA"]); // the connected set today
    expect(outcome.body.asOf).toBe("2026-09-19T12:00:03.247Z");
  });

  test("invalid input is a 400 and the store is never called", async () => {
    let called = 0;
    const failing = deps({
      queryStateGrants: (async () => {
        called += 1;
        return { results: [], totalCount: 0, statesIncluded: [], limit: 25, offset: 0 };
      }) as unknown as StateGrantSearchDeps["queryStateGrants"],
    });
    for (const body of [{ stateCodes: ["XX"] }, { status: "nope" }, { limit: -1 }]) {
      const outcome = await runStateGrantSearch(body, NOW, failing);
      expect(outcome.status).toBe(400);
      if (outcome.status !== 400) throw new Error("unreachable");
      expect(outcome.body.ok).toBe(false);
      expect("records" in outcome.body).toBe(false);
    }
    expect(called).toBe(0);
  });

  test("a store failure fails closed: 500 with no partial result set", async () => {
    const outcome = await runStateGrantSearch({}, NOW, deps({
      queryStateGrants: (async () => {
        throw new Error("connection terminated");
      }) as unknown as StateGrantSearchDeps["queryStateGrants"],
    }));
    expect(outcome.status).toBe(500);
    if (outcome.status !== 500) throw new Error("unreachable");
    expect(outcome.body.ok).toBe(false);
    expect(outcome.body.error.length).toBeGreaterThan(0);
    expect(Object.keys(outcome.body).sort()).toEqual(["error", "ok"]);

    // The freshness read failing is a 500 too — never a partial payload.
    const second = await runStateGrantSearch({}, NOW, deps({
      latestStateGrantSync: (async () => {
        throw new Error("boom");
      }) as unknown as StateGrantSearchDeps["latestStateGrantSync"],
    }));
    expect(second.status).toBe(500);
  });
});

describe("buildStateGrantCoverage", () => {
  function coverageDeps(overrides: Partial<StateGrantCoverageDeps> = {}): StateGrantCoverageDeps {
    return {
      stateGrantEffectiveStatusCounts: (async () => ({
        open: 2,
        forecast: 2,
        closed: 4,
        total: 8,
      })) as unknown as StateGrantCoverageDeps["stateGrantEffectiveStatusCounts"],
      latestStateGrantSync: (async () => "2026-09-19T12:00:03.247Z") as unknown as StateGrantCoverageDeps["latestStateGrantSync"],
      listStateSyncRuns: (async () => [
        {
          id: "run-1",
          stateCode: "VA",
          startedAt: "2026-09-19T12:00:02.665Z",
          finishedAt: "2026-09-19T12:00:03.247Z",
          status: "ok" as const,
          fetchedCount: 8,
          insertedCount: 8,
          updatedCount: 0,
          error: null,
        },
      ]) as unknown as StateGrantCoverageDeps["listStateSyncRuns"],
      ...overrides,
    };
  }

  test("coverage comes from the DERIVED registry, never the mirror table", async () => {
    const outcome = await buildStateGrantCoverage(NOW, coverageDeps());
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) throw new Error("unreachable");
    const body = outcome.body;
    expect(body.headline).toBe("State grant coverage: 1 of 51 states connected");
    expect(body.counts).toEqual({ total: 51, connected: 1, unavailable: 50 });
    expect(body.states.length).toBe(51);
    expect(body.states.filter((s) => s.status === "connected").map((s) => s.stateCode)).toEqual(["VA"]);
    expect(body.noNationwideCoverage).toContain("not nationwide coverage");
    expect(body.connected.length).toBe(1);
    expect(body.connected[0].recordCount).toBe(8);
    expect(body.connected[0].statusCounts.open).toBe(2);
    expect(body.connected[0].sourceUrl).toBe("https://www.vatc.org/grants/");
    expect(body.connected[0].lastSyncedAt).toBe("2026-09-19T12:00:03.247Z");
    expect(body.connected[0].lastRun?.status).toBe("ok");
    expect(body.federalGrantsUrl).toBe("/grants");
  });

  test("a store failure fails closed: 500 and no partial payload", async () => {
    const outcome = await buildStateGrantCoverage(NOW, coverageDeps({
      stateGrantEffectiveStatusCounts: (async () => {
        throw new Error("boom");
      }) as unknown as StateGrantCoverageDeps["stateGrantEffectiveStatusCounts"],
    }));
    expect(outcome.status).toBe(500);
    if (outcome.status !== 500) throw new Error("unreachable");
    expect(Object.keys(outcome.body).sort()).toEqual(["error", "ok"]);
  });

  test("the headline is a function of the connected count alone", () => {
    expect(coverageHeadline({ total: 51, connected: 1, unavailable: 50 })).toBe(
      "State grant coverage: 1 of 51 states connected",
    );
    expect(coverageHeadline({ total: 51, connected: 6, unavailable: 45 })).toBe(
      "State grant coverage: 6 of 51 states connected",
    );
    expect(coverageHeadline({ total: 51, connected: 0, unavailable: 51 })).toBe(
      "State grant coverage: 0 of 51 states connected",
    );
  });
});
