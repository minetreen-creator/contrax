/**
 * Unit tests — STATE GRANT SEARCH, SERVER HALF (part 2, re-cut for the corrected
 * model; owner R1 2026-09-19).
 *
 * DETERMINISTIC AND OFFLINE: the store is INJECTED, so the registry gate, the
 * response shape and the fail-closed 500 are exercised with no database in the
 * process and no network. The real-database half lives in
 * state-grants-search.integration.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { StateGrantRow } from "~/lib/state-grants/store.server";
import {
  parseStateGrantSearchBody,
  runStateGrantSearch,
  uncoveredStatesNotice,
  type StateGrantSearchDeps,
} from "~/lib/state-grants/search.server";

const TODAY = new Date("2026-09-19T12:00:00Z");

/** A stored row, in the shape the store returns it. */
function storedRow(overrides: Partial<StateGrantRow> = {}): StateGrantRow {
  return {
    id: "row-1",
    sourceId: "src-1",
    sourceKey: "va-vtc-grants",
    sourceName: "Virginia Tourism Corporation grants",
    sourceAgency: "Virginia Tourism Corporation",
    sourceOfficialUrl: "https://www.vatc.org/grants/",
    stateCode: "VA",
    externalId: "mmlp",
    title: "Matching Marketing Leverage Program",
    agency: "Virginia Tourism Corporation",
    summary: "A matching grant for marketing programs.",
    status: "open",
    storedStatus: "open",
    postedDate: "2026-09-01",
    closeDate: "2026-12-31",
    estimatedCloseDate: null,
    eligibleApplicants: "Virginia localities",
    eligibleGeography: "Virginia",
    categories: ["Tourism"],
    awardRange: "Tier One $10,000",
    awardMinAmount: null,
    awardMaxAmount: 10000,
    totalFunding: "Not specified",
    matchingRequirement: "1:1 cash match",
    url: "https://www.vatc.org/grants/mmlp/",
    sourceUrl: "https://www.vatc.org/grants/",
    sourceUpdatedAt: null,
    fetchedAt: "2026-09-19T12:00:00.000Z",
    lastSeenAt: "2026-09-19T12:00:00.000Z",
    updatedAt: "2026-09-19T12:00:00.000Z",
    ...overrides,
  };
}

interface Calls {
  query: unknown[];
  freshness: unknown[];
}

/** Injected deps that record what the builder asked the store for. */
function deps(
  rows: StateGrantRow[] = [storedRow()],
  validated: readonly string[] = ["VA"],
  calls: Calls = { query: [], freshness: [] },
  totalCount = rows.length,
): { deps: StateGrantSearchDeps; calls: Calls } {
  return {
    calls,
    deps: {
      validatedStateCodes: () => validated,
      queryStateGrants: (async (query: { limit?: number; offset?: number }) => {
        calls.query.push(query);
        return {
          results: rows,
          totalCount,
          limit: query.limit ?? 25,
          offset: query.offset ?? 0,
        };
      }) as unknown as StateGrantSearchDeps["queryStateGrants"],
      latestSuccessfulStateSync: (async (codes: unknown) => {
        calls.freshness.push(codes);
        return "2026-09-19T12:00:00.000Z";
      }) as unknown as StateGrantSearchDeps["latestSuccessfulStateSync"],
    },
  };
}

function bodyOf(outcome: Awaited<ReturnType<typeof runStateGrantSearch>>) {
  if (outcome.status !== 200) throw new Error(`expected 200, got ${outcome.status}`);
  return outcome.body;
}

describe("body parsing", () => {
  test("an empty body is a valid search; malformed JSON is a 400 and nothing else", () => {
    expect(parseStateGrantSearchBody("")).toEqual({ ok: true, value: null });
    expect(parseStateGrantSearchBody("   ")).toEqual({ ok: true, value: null });
    expect(parseStateGrantSearchBody('{"status":"open"}')).toEqual({
      ok: true,
      value: { status: "open" },
    });
    expect(parseStateGrantSearchBody("{nope").ok).toBe(false);
  });
});

describe("the registry gate", () => {
  test("a requested state with no validated source is answered empty, and the store is never queried", async () => {
    const { deps: d, calls } = deps();
    const outcome = await runStateGrantSearch({ stateCodes: ["NC"] }, TODAY, d);
    const body = bodyOf(outcome);
    expect(body.totalCount).toBe(0);
    expect(body.records).toEqual([]);
    expect(body.statesIncluded).toEqual([]);
    expect(body.uncoveredStates).toEqual(["NC"]);
    expect(body.uncoveredNotice).toContain("North Carolina (NC)");
    expect(body.uncoveredNotice).toContain("no records are invented");
    expect(body.asOf).toBeNull();
    expect(calls.query).toEqual([]);
    expect(calls.freshness).toEqual([]);
  });

  test("a mixed request serves only the covered state and names the uncovered one", async () => {
    const { deps: d, calls } = deps();
    const body = bodyOf(await runStateGrantSearch({ stateCodes: ["VA", "NC"] }, TODAY, d));
    expect(body.statesIncluded).toEqual(["VA"]);
    expect(body.uncoveredStates).toEqual(["NC"]);
    const query = calls.query[0] as { stateCodes: string[] };
    expect(query.stateCodes).toEqual(["VA"]);
  });
  test("statesIncluded can only ever hold validated states — repeats and uncovered codes never leak in", async () => {
    const { deps: d, calls } = deps([storedRow()], ["VA"]);
    const body = bodyOf(
      await runStateGrantSearch({ stateCodes: ["NC", "VA", "NC", "CA"] }, TODAY, d),
    );
    expect(body.statesIncluded).toEqual(["VA"]);
    expect(body.uncoveredStates).toEqual(["NC", "CA"]);
    // The echoed scope is the narrowed one, so a client can never read an
    // uncovered state out of the applied filters either.
    expect(body.filters.stateCodes).toEqual(["VA"]);
    const query = calls.query[0] as { stateCodes: string[] };
    expect(query.stateCodes).toEqual(["VA"]);
  });
  test("a repeated covered code is not queried twice and does not inflate the echo", async () => {
    const { deps: d, calls } = deps([storedRow()], ["VA"]);
    const body = bodyOf(await runStateGrantSearch({ stateCodes: ["VA", "VA"] }, TODAY, d));
    expect(body.statesIncluded).toEqual(["VA"]);
    expect(body.uncoveredStates).toEqual([]);
    const query = calls.query[0] as { stateCodes: string[] };
    expect(query.stateCodes).toEqual(["VA"]);
  });

  test("with no state requested the scope is exactly the validated set", async () => {
    const { deps: d, calls } = deps([], ["VA"]);
    const body = bodyOf(await runStateGrantSearch({}, TODAY, d));
    expect(body.statesIncluded).toEqual(["VA"]);
    expect(body.uncoveredStates).toEqual([]);
    expect(body.uncoveredNotice).toBeNull();
    const query = calls.query[0] as { stateCodes: string[] };
    expect(query.stateCodes).toEqual(["VA"]);
  });

  test("an unvalidated state is never even queried — the filter is bound to the validated set", async () => {
    // The store below holds a ZZ row, but the gate must never ask for ZZ: the
    // real-database proof that such a row cannot be served is in
    // state-grants-search.integration.test.ts (the default deps + a real ZZ
    // corpus), because an injected store cannot enforce a filter it does not run.
    const { deps: d, calls } = deps([storedRow({ stateCode: "ZZ" })], ["VA"]);
    await runStateGrantSearch({}, TODAY, d);
    const query = calls.query[0] as { stateCodes: string[] };
    expect(query.stateCodes).toEqual(["VA"]);
    expect(query.stateCodes).not.toContain("ZZ");
  });

  test("the uncovered notice speaks about one or many states correctly", () => {
    expect(uncoveredStatesNotice([])).toBeNull();
    expect(uncoveredStatesNotice(["NC"])).toContain("has no validated source yet");
    expect(uncoveredStatesNotice(["NC", "CA"])).toContain("have no validated source yet");
    expect(uncoveredStatesNotice(["NC", "CA"])).toContain("California (CA)");
  });
});

describe("the response", () => {
  test("a covered search returns honest records with the applied filters echoed", async () => {
    const { deps: d, calls } = deps();
    const body = bodyOf(
      await runStateGrantSearch(
        {
          stateCodes: ["va"],
          status: "open",
          term: "matching",
          eligibleApplicants: "localities",
          categories: ["Tourism"],
          awardMaxAmount: 25000,
          limit: 100,
        },
        TODAY,
        d,
      ),
    );
    expect(body.status).toBe("open");
    expect(body.countExact).toBe(true);
    expect(body.countLabel).toBe("1 record open for applications");
    expect(body.hasMore).toBe(false);
    expect(body.limitCapped).toBe(false);
    expect(body.filters).toEqual({
      stateCodes: ["VA"],
      sourceKeys: [],
      status: "open",
      term: "matching",
      eligibleApplicants: "localities",
      eligibleGeography: null,
      categories: ["Tourism"],
      awardRange: null,
      totalFunding: null,
      matchingRequirement: null,
      awardMinAmount: null,
      awardMaxAmount: 25000,
    });
    const query = calls.query[0] as Record<string, unknown>;
    expect(query.status).toBe("open");
    expect(query.term).toBe("matching");
    expect(query.eligibleApplicants).toBe("localities");
    expect(query.categories).toEqual(["Tourism"]);
    expect(query.awardMaxAmount).toBe(25000);
    // The scope is always bound to validated states.
    expect(query.stateCodes).toEqual(["VA"]);
    expect(calls.freshness[0]).toEqual(["VA"]);
    expect(body.records[0].sourceLabel).toBe("Virginia Tourism Corporation — vatc.org");
    expect(body.records[0].statusLabel).toContain("Open");
  });

  test("an empty category list is not passed as a filter", async () => {
    const { deps: d, calls } = deps();
    await runStateGrantSearch({}, TODAY, d);
    expect((calls.query[0] as { categories: unknown }).categories).toBeNull();
  });

  test("pagination reports the store's own totals, and hasMore is derived from them", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => storedRow({ id: `row-${i}`, externalId: `ext-${i}` }));
    // 60 matches on the server; this page is the second one.
    const { deps: d, calls } = deps(rows, ["VA"], { query: [], freshness: [] }, 60);
    const body = bodyOf(await runStateGrantSearch({ offset: 25, limit: 25 }, TODAY, d));
    expect((calls.query[0] as { offset: number }).offset).toBe(25);
    expect(body.offset).toBe(25);
    expect(body.limit).toBe(25);
    expect(body.returned).toBe(25);
    expect(body.totalCount).toBe(60);
    expect(body.hasMore).toBe(true);
  });

  test("a limit above the cap is clamped and reported in the response", async () => {
    const { deps: d, calls } = deps();
    const body = bodyOf(await runStateGrantSearch({ limit: 500 }, TODAY, d));
    expect(body.limitCapped).toBe(true);
    expect(body.limit).toBe(100);
    expect((calls.query[0] as { limit: number }).limit).toBe(100);
  });

  test("the read-time status applies to the returned records", async () => {
    const { deps: d } = deps([storedRow({ closeDate: "2026-09-01" })]);
    const body = bodyOf(await runStateGrantSearch({}, TODAY, d));
    expect(body.records[0].status).toBe("closed");
    expect(body.records[0].closeDate).toBe("2026-09-01");
  });

  test("no pricing, no upgrade prompt and no analytics in the payload", async () => {
    const { deps: d } = deps();
    const body = bodyOf(await runStateGrantSearch({}, TODAY, d));
    const json = JSON.stringify(body).toLowerCase();
    for (const forbidden of ["upgrade", "pricing", "$19", "subscribe", "forecast"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe("fail closed", () => {
  test("an invalid request is a 400 and the store is never touched", async () => {
    const { deps: d, calls } = deps();
    const outcome = await runStateGrantSearch({ status: "forecast" }, TODAY, d);
    expect(outcome.status).toBe(400);
    expect(outcome.body.ok).toBe(false);
    expect(JSON.stringify(outcome.body)).toContain("open, upcoming, rolling, closed, unverified");
    expect(calls.query).toEqual([]);
  });

  test("a store failure is a 500 with NO records at all", async () => {
    const failing: StateGrantSearchDeps = {
      validatedStateCodes: () => ["VA"],
      queryStateGrants: (async () => {
        throw new Error("connection reset");
      }) as unknown as StateGrantSearchDeps["queryStateGrants"],
      latestSuccessfulStateSync: (async () => null) as unknown as StateGrantSearchDeps["latestSuccessfulStateSync"],
    };
    const originalError = console.error;
    console.error = () => {};
    try {
      const outcome = await runStateGrantSearch({ stateCodes: ["VA"] }, TODAY, failing);
      expect(outcome.status).toBe(500);
      expect(outcome.body).toEqual({
        ok: false,
        error: "The state grant store is unavailable right now. Please try again.",
      });
      expect(JSON.stringify(outcome.body)).not.toContain("records");
    } finally {
      console.error = originalError;
    }
  });

  test("a freshness lookup failure is also a 500, not an optimistic timestamp", async () => {
    const failing: StateGrantSearchDeps = {
      validatedStateCodes: () => ["VA"],
      queryStateGrants: (async () => ({
        results: [storedRow()],
        totalCount: 1,
        limit: 25,
        offset: 0,
      })) as unknown as StateGrantSearchDeps["queryStateGrants"],
      latestSuccessfulStateSync: (async () => {
        throw new Error("runs table unavailable");
      }) as unknown as StateGrantSearchDeps["latestSuccessfulStateSync"],
    };
    const originalError = console.error;
    console.error = () => {};
    try {
      const outcome = await runStateGrantSearch({}, TODAY, failing);
      expect(outcome.status).toBe(500);
    } finally {
      console.error = originalError;
    }
  });
});
