/**
 * Contrax Grants — STATE GRANT SEARCH: PART 2 INTEGRATION TESTS (REAL Postgres).
 *
 * Exercises the exact code path the routes serve (runStateGrantSearch →
 * queryStateGrants → the honesty mapping, and buildStateGrantCoverage) against a
 * live database. It uses:
 *   - the DETERMINISTIC fixture corpus in test-support.server.ts, written under
 *     MD (a real state code, so the API's own validation accepts it; MD is
 *     `unavailable` in the registry, so no production sync writes there; the
 *     suite deletes its rows in afterAll), and
 *   - the REAL Virginia rows for the source-label and pagination checks that
 *     must hold on live data (READ ONLY — this suite never writes, updates or
 *     deletes a real state's rows).
 *
 * It never touches the network and writes nothing without a database:
 * `bun run test:state-grants:integration` provisions the schema from the
 * migration when the operator opts in. Run:
 *
 *   STATE_GRANTS_TEST_PROVISION_SCHEMA=1 bun test src/lib/state-grants
 *   # or: bun run test:state-grants:integration
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runStateGrantSync } from "~/lib/state-grants/sync.server";
import { queryStateGrants, latestStateGrantSync } from "~/lib/state-grants/store.server";
import { buildStateGrantCoverage } from "~/lib/state-grants/coverage.server";
import {
  STATE_GRANT_DEFAULT_LIMIT,
  STATE_GRANT_MAX_LIMIT,
} from "~/lib/state-grants/search";
import { parseStateGrantSearchBody, runStateGrantSearch } from "~/lib/state-grants/search.server";
import {
  FIXTURE_NOW,
  SEARCH_FIXTURE_ROWS,
  SEARCH_FIXTURE_STATE,
  deleteSyntheticStateRows,
  ensureStateGrantsTables,
  fixturePage,
  syntheticConnector,
} from "~/lib/state-grants/test-support.server";

const DB_READY = await ensureStateGrantsTables();
const FIXTURE = SEARCH_FIXTURE_STATE;
const SYNTHETIC = [SEARCH_FIXTURE_STATE];
const page = () => fixturePage(SEARCH_FIXTURE_ROWS);

/**
 * Drives the SAME builder the route handler calls, with the real store. The
 * route files themselves are thin wrappers (asserted statically below, because
 * importing a TanStack route into a Bun test pulls the router runtime).
 */
async function postSearch(body: unknown): Promise<{
  status: number;
  json: Record<string, unknown> & { records?: Record<string, unknown>[] };
}> {
  const outcome = await runStateGrantSearch(body, new Date());
  return {
    status: outcome.status,
    json: outcome.body as unknown as Record<string, unknown> & {
      records?: Record<string, unknown>[];
    },
  };
}

describe.skipIf(!DB_READY)("state grants search integration (real DB)", () => {
  beforeAll(async () => {
    await deleteSyntheticStateRows(SYNTHETIC);
    const run = await runStateGrantSync(FIXTURE, {
      connector: syntheticConnector(FIXTURE, page),
      now: FIXTURE_NOW,
    });
    expect(run.status).toBe("ok");
    expect(run.insertedCount).toBe(5);
  });

  afterAll(async () => {
    await deleteSyntheticStateRows(SYNTHETIC);
  });

  test("the routes are registered at the paths the UI calls", () => {
    // Static check on purpose: importing a TanStack route file into a Bun test
    // pulls the router runtime, so the ROUTE PATH + HANDLER METHOD are asserted
    // from the source, and the handlers themselves are exercised through the
    // builders above (and over real HTTP against the preview deployment).
    const searchRoute = readFileSync(
      new URL("../../routes/api/state-grants/search.ts", import.meta.url),
      "utf8",
    );
    const coverageRoute = readFileSync(
      new URL("../../routes/api/state-grants/coverage.ts", import.meta.url),
      "utf8",
    );
    expect(searchRoute).toContain('createFileRoute("/api/state-grants/search")');
    expect(searchRoute).toContain("handlers: { POST: handler }");
    expect(coverageRoute).toContain('createFileRoute("/api/state-grants/coverage")');
    expect(coverageRoute).toContain("handlers: { GET: handler }");
    expect(searchRoute).toContain('"cache-control": "no-store"');
    expect(coverageRoute).toContain('"cache-control": "no-store"');
  });

  test("a bare POST searches everything stored and reports honest totals", async () => {
    const { status, json } = await postSearch({});
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.countExact).toBe(true);
    const records = json.records as Record<string, unknown>[];
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    expect(json.totalCount).toBeGreaterThanOrEqual(records.length);
    expect(json.returned).toBe(records.length);
    expect(json.limit).toBe(STATE_GRANT_DEFAULT_LIMIT);
    expect(json.offset).toBe(0);
    // asOf is the last SUCCESSFUL sync of the states covered, echoed honestly.
    expect(typeof json.asOf).toBe("string");
    expect(json.asOf).toBe(await latestStateGrantSync());
    // Every record carries its official source label + URL and a status label.
    for (const r of records) {
      expect(typeof r.title).toBe("string");
      expect(String(r.sourceUrl)).toMatch(/^https:\/\//);
      expect(String(r.sourceUrl)).toContain("vatc.org");
      expect(String(r.sourceLabel)).toContain("—");
      expect(String(r.statusLabel).length).toBeGreaterThan(0);
      expect(["open", "forecast", "closed"]).toContain(String(r.status));
    }
    // Real VA rows are in there and carry the VTC label.
    const va = records.filter((r) => r.stateCode === "VA");
    expect(va.length).toBeGreaterThan(0);
    for (const r of va) {
      expect(String(r.sourceLabel)).toBe("Virginia Tourism Corporation — vatc.org");
      expect(String(r.stateName)).toBe("Virginia");
    }
  });

  test("state filter: one state returns only that state; two states are the union", async () => {
    const va = await postSearch({ stateCodes: ["VA"] });
    expect(va.status).toBe(200);
    const vaRecords = va.json.records as Record<string, unknown>[];
    expect(vaRecords.length).toBeGreaterThan(0);
    for (const r of vaRecords) expect(r.stateCode).toBe("VA");
    expect(va.json.statesIncluded).toEqual(["VA"]);
    expect(va.json.statesMatched).toEqual(["VA"]);

    const fixture = await postSearch({ stateCodes: [FIXTURE] });
    expect(fixture.json.totalCount).toBe(5);
    const fixtureRecords = fixture.json.records as Record<string, unknown>[];
    expect(fixtureRecords.length).toBe(5);
    for (const r of fixtureRecords) expect(r.stateCode).toBe(FIXTURE);
    expect(fixture.json.statesIncluded).toEqual([FIXTURE]);
    expect(fixture.json.statesMatched).toEqual([FIXTURE]);

    const both = await postSearch({ stateCodes: [FIXTURE, "VA"] });
    expect(both.json.totalCount).toBe(
      (fixture.json.totalCount as number) + (va.json.totalCount as number),
    );
    expect(both.json.statesMatched).toEqual(["MD", "VA"]); // ordered by the SQL
    expect(both.json.statesIncluded).toEqual([FIXTURE, "VA"]); // as requested
  });

  test("status filter uses the READ-TIME status, and per-status totals add up", async () => {
    const open = await postSearch({ stateCodes: [FIXTURE], status: "open" });
    const forecast = await postSearch({ stateCodes: [FIXTURE], status: "forecast" });
    const closed = await postSearch({ stateCodes: [FIXTURE], status: "closed" });
    expect(open.json.totalCount).toBe(2); // gamma (ongoing) + delta (real future deadline)
    expect(forecast.json.totalCount).toBe(1);
    expect(closed.json.totalCount).toBe(2);
    expect(
      (open.json.totalCount as number) +
        (forecast.json.totalCount as number) +
        (closed.json.totalCount as number),
    ).toBe(5);
    // A forecast NEVER carries a real closing date; its date is an estimate.
    for (const r of (forecast.json.records ?? []) as Record<string, unknown>[]) {
      expect(r.closeDate).toBeNull();
      expect(String(r.statusLabel)).toContain("Forecast");
      const deadline = r.deadline as { label: string; value: string } | null;
      expect(deadline?.label).toBe("Estimated application deadline");
      expect(deadline?.value).toContain("source estimate — not a posted closing date");
      expect(deadline?.value).toContain(String(r.estimatedCloseDate));
    }
    // An open row with no source deadline says so rather than inventing one.
    const ongoing = ((open.json.records ?? []) as Record<string, unknown>[]).find(
      (r) => r.externalId === "md-gamma",
    );
    expect(ongoing).toBeTruthy();
    expect((ongoing!.deadline as { value: string }).value).toContain("Not specified");
    // Real-VA statuses are whatever the source published — assert the invariant,
    // not a hard number, so the suite does not encode the source's contents.
    const vaOpen = await postSearch({ stateCodes: ["VA"], status: "open" });
    for (const r of (vaOpen.json.records ?? []) as Record<string, unknown>[]) {
      expect(r.status).toBe("open");
      expect(r.closeDate === null || typeof r.closeDate === "string").toBe(true);
    }
  });

  test("term search matches, and a wildcard term can NEVER widen the result", async () => {
    const byTerm = await postSearch({ stateCodes: [FIXTURE], term: "Delta" });
    expect(byTerm.json.totalCount).toBe(1);
    expect((byTerm.json.records as Record<string, unknown>[])[0].externalId).toBe("md-delta");

    const noMatch = await postSearch({ stateCodes: [FIXTURE], term: "md-no-such-thing" });
    expect(noMatch.status).toBe(200);
    expect(noMatch.json.totalCount).toBe(0);
    expect(noMatch.json.records).toEqual([]);
    expect(noMatch.json.statesMatched).toEqual([]);
    expect(typeof noMatch.json.asOf).toBe("string"); // freshness still reported

    // The honesty rule: '%' and '_' are literal characters, not wildcards.
    for (const wildcard of ["%", "_", "%%", "m%", "%md-", "\\%"]) {
      const widened = await postSearch({ stateCodes: [FIXTURE], term: wildcard });
      expect(widened.json.totalCount).toBe(0);
      expect(widened.json.records).toEqual([]);
    }
    // Same rule on the real state's rows: '%' stays LITERAL, so it can only
    // match a record whose own source text contains a percent sign (one Virginia
    // summary does) — never the whole set, which is what a wildcard would do.
    const va = await postSearch({ stateCodes: ["VA"], limit: 1 });
    const vaWildcard = await postSearch({ stateCodes: ["VA"], term: "%", limit: 100 });
    expect(vaWildcard.json.totalCount).toBeLessThan(va.json.totalCount as number);
    for (const r of (vaWildcard.json.records ?? []) as Record<string, unknown>[]) {
      expect([r.title, r.agency, r.summary].join(" ")).toContain("%");
    }
    const first = (va.json.records as Record<string, unknown>[])[0];
    const word = String(first.title).split(/\s+/).find((w) => w.length > 3) ?? String(first.title);
    const vaTerm = await postSearch({ stateCodes: ["VA"], term: word });
    expect(vaTerm.json.totalCount).toBeGreaterThanOrEqual(1);
    expect((vaTerm.json.records as Record<string, unknown>[]).map((r) => r.id)).toContain(first.id);
  });

  test("pagination: limit/offset walk the same ordered set, and the cap is enforced", async () => {
    const all = await postSearch({ stateCodes: [FIXTURE], limit: 100 });
    const ids = (all.json.records as Record<string, unknown>[]).map((r) => r.id);

    const page1 = await postSearch({ stateCodes: [FIXTURE], limit: 2, offset: 0 });
    const page2 = await postSearch({ stateCodes: [FIXTURE], limit: 2, offset: 2 });
    const page3 = await postSearch({ stateCodes: [FIXTURE], limit: 2, offset: 4 });
    expect((page1.json.records as unknown[]).length).toBe(2);
    expect((page2.json.records as unknown[]).length).toBe(2);
    expect((page3.json.records as unknown[]).length).toBe(1);
    const walked = [page1, page2, page3].flatMap((p) =>
      (p.json.records as Record<string, unknown>[]).map((r) => r.id),
    );
    expect(walked).toEqual(ids); // no gaps, no repeats
    // The total is the whole matching set, not the page.
    for (const p of [page1, page2, page3]) expect(p.json.totalCount).toBe(5);
    expect(page1.json.hasMore).toBe(true);
    expect(page3.json.hasMore).toBe(false);
    expect(page2.json.offset).toBe(2);

    // Past the end: an empty page, an unchanged total, still a 200.
    const beyond = await postSearch({ stateCodes: [FIXTURE], limit: 2, offset: 50 });
    expect(beyond.status).toBe(200);
    expect(beyond.json.records).toEqual([]);
    expect(beyond.json.totalCount).toBe(5);

    // limit cap: a bigger limit is clamped, reported, never rejected.
    const capped = await postSearch({ stateCodes: [FIXTURE], limit: 5000 });
    expect(capped.status).toBe(200);
    expect(capped.json.limit).toBe(STATE_GRANT_MAX_LIMIT);
    expect(capped.json.limitCapped).toBe(true);

    // The real state paginates under the same rules.
    const vaPage = await postSearch({ stateCodes: ["VA"], limit: 2, offset: 0 });
    expect(vaPage.json.limit).toBe(2);
    expect((vaPage.json.records as unknown[]).length).toBeLessThanOrEqual(2);
    expect(vaPage.json.totalCount).toBeGreaterThanOrEqual(
      (vaPage.json.records as unknown[]).length,
    );
  });

  test("READ-TIME FRESHNESS: a deadline the calendar overtook is never served as open", async () => {
    // Written on 2026-09-19, md-delta is legitimately open (deadline 2026-12-31).
    const today = await queryStateGrants({ stateCode: FIXTURE, now: FIXTURE_NOW });
    const deltaToday = today.results.find((r) => r.externalId === "md-delta")!;
    expect(deltaToday.status).toBe("open");

    // Read later, with the same stored rows: the deadline has passed, so the row
    // is served closed — in the row itself, in the status filter and in the count.
    const later = new Date("2027-01-15T12:00:00Z");
    const laterAll = await queryStateGrants({ stateCode: FIXTURE, now: later });
    const deltaLater = laterAll.results.find((r) => r.externalId === "md-delta")!;
    expect(deltaLater.status).toBe("closed");
    expect(deltaLater.id).toBe(deltaToday.id); // same row, expired deadline

    const openLater = await queryStateGrants({ stateCode: FIXTURE, status: "open", now: later });
    expect(openLater.totalCount).toBe(1); // gamma only: the ongoing row has no deadline
    expect(openLater.results.map((r) => r.externalId)).toEqual(["md-gamma"]);
    const closedLater = await queryStateGrants({ stateCode: FIXTURE, status: "closed", now: later });
    expect(closedLater.totalCount).toBe(3);
    expect(closedLater.results.some((r) => r.externalId === "md-delta")).toBe(true);

    // The STORED snapshot is untouched by a read: the next sync re-classifies,
    // a read never rewrites.
    const stored = await queryStateGrants({ stateCode: FIXTURE, status: "open", now: FIXTURE_NOW });
    expect(stored.totalCount).toBe(2);
  });

  test("coverage comes from the DERIVED registry and reports real sync facts", async () => {
    const outcome = await buildStateGrantCoverage();
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) throw new Error("unreachable");
    const body = outcome.body;
    expect(body.headline).toBe("State grant coverage: 1 of 51 states connected");
    expect(body.counts.total).toBe(51);
    expect(body.counts.connected).toBe(1);
    expect(body.counts.unavailable).toBe(50);
    expect(body.states.length).toBe(51);
    expect(body.states.filter((s) => s.status === "connected").map((s) => s.stateCode)).toEqual([
      "VA",
    ]);
    // Every non-connected state is stated as such, with a reason.
    for (const s of body.states) {
      if (s.stateCode === "VA") continue;
      expect(s.status).toBe("unavailable");
      expect(s.reason.length).toBeGreaterThan(0);
    }
    expect(body.noNationwideCoverage).toContain("not nationwide coverage");
    expect(body.federalGrantsUrl).toBe("/grants");

    const va = body.connected[0];
    expect(va.stateCode).toBe("VA");
    expect(va.sourceUrl).toBe("https://www.vatc.org/grants/");
    expect(va.sourceValidationTest).toBe("src/lib/state-grants/virginia.source-validation.test.ts");
    expect(va.recordCount).toBeGreaterThan(0);
    expect(va.statusCounts.total).toBe(va.recordCount);
    expect(va.lastSyncedAt).toBe(await latestStateGrantSync(["VA"]));
    expect(va.lastRun?.status).toBe("ok");

    // The fixture state is NOT in the registry, so rows written under it can
    // never be reported as coverage.
    expect(body.connected.map((c) => c.stateCode)).not.toContain(FIXTURE);
  });

  test("validation: present-but-invalid input is a 400 and never reaches the store", async () => {
    const before = await queryStateGrants({ stateCodes: SYNTHETIC });
    const cases: unknown[] = [
      { stateCodes: ["XX"] },
      { stateCodes: ["ZZ"] }, // a synthetic code is not a US state
      { stateCodes: "VA" },
      { stateCodes: [1] },
      { status: "openish" },
      { term: 42 },
      { term: "x".repeat(121) },
      { limit: 0 },
      { limit: 1.5 },
      { limit: "10" },
      { offset: -1 },
    ];
    for (const body of cases) {
      const { status, json } = await postSearch(body);
      expect(status).toBe(400);
      expect(json.ok).toBe(false);
      expect(typeof json.error).toBe("string");
      expect(json.records).toBeUndefined(); // never a partial body
    }
    // A malformed JSON body is a 400 too — the handler's first step, shared with
    // the route (parseStateGrantSearchBody).
    const malformed = parseStateGrantSearchBody("{not json");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error).toContain("valid JSON");
    // A bare POST (no body at all) is a valid search, not an error.
    const parsedEmpty = parseStateGrantSearchBody("");
    expect(parsedEmpty.ok).toBe(true);
    const empty = await runStateGrantSearch(parsedEmpty.ok ? parsedEmpty.value : null, new Date());
    expect(empty.status).toBe(200);
    // Nothing above wrote anything.
    expect((await queryStateGrants({ stateCodes: SYNTHETIC })).totalCount).toBe(before.totalCount);
  });

  test("the state tables are independent of the federal grants product", async () => {
    // This suite only ever wrote the one fixture state code; the federal grants
    // experience stores nothing at all (it is a live Grants.gov proxy), so there
    // is no federal table for a state search to have touched.
    const fixtureOnly = await queryStateGrants({ stateCodes: SYNTHETIC, term: "Delta" });
    expect(fixtureOnly.totalCount).toBe(1);
    expect(fixtureOnly.results[0].stateCode).toBe(FIXTURE);
  });
});
