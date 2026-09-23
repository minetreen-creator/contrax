/**
 * FIX ② REGRESSION PINS — a Socrata source that cannot be read must FAIL its run,
 * not report an honest-looking zero (owner-locked nationwide correctness fix,
 * 2026-09-23).
 *
 * THE LIVE CASE: `nys_socrata`'s two data.ny.gov datasets both answer HTTP 404
 * (verified live 2026-09-23). The old page loop swallowed the 404 (`break`), so
 * the run recorded `rows_fetched = 0, errors = 0, ran_zero = true` — identical
 * to an honest empty source — and `collector_staleness` called it FRESH for 43
 * consecutive runs.
 *
 * DETERMINISTIC BY CONSTRUCTION: zero network. `fetch` is replaced by a stub for
 * the duration of each test and restored afterwards; every response body is a
 * literal in this file.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  fetchSocrataBids,
  newSocrataFetchReport,
} from "~/jobs/sources/socrata";
import { classifyCollectorTier } from "~/lib/collector-freshness";

const REAL_FETCH = globalThis.fetch;
let calls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A stub that answers by dataset id from a lookup table. */
function stubFetch(answers: Record<string, () => Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [needle, answer] of Object.entries(answers)) {
      if (url.includes(needle)) return answer();
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

describe("FIX ② — the fetch report distinguishes 'unreachable' from 'honestly empty'", () => {
  test("a 404 page sets the failure and never marks the dataset reached", async () => {
    stubFetch({ "e5pk-us93": () => new Response("not found", { status: 404 }) });
    const report = newSocrataFetchReport();
    const rows = await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", report);
    expect(rows).toEqual([]);
    expect(report.reached).toBe(false);
    expect(report.failure).toContain("HTTP 404");
  });

  test("a 200 with records marks reached and yields rows", async () => {
    stubFetch({
      "e5pk-us93": () =>
        jsonResponse([{ request_id: "R1", short_title: "Janitorial Services", agency_name: "OGS" }]),
    });
    const report = newSocrataFetchReport();
    const rows = await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", report);
    expect(report.reached).toBe(true);
    expect(report.failure).toBe(null);
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("Janitorial Services");
  });

  test("a 200 with an EMPTY array is an honest zero: reached, no failure, no rows", async () => {
    stubFetch({ "e5pk-us93": () => jsonResponse([]) });
    const report = newSocrataFetchReport();
    const rows = await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", report);
    expect(rows).toEqual([]);
    expect(report.reached).toBe(true);
    expect(report.failure).toBe(null);
  });

  test("a non-array JSON body (or a thrown request) is a failure, not an empty result", async () => {
    stubFetch({ "e5pk-us93": () => jsonResponse({ message: "dataset moved" }) });
    const report = newSocrataFetchReport();
    await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", report);
    expect(report.reached).toBe(false);
    expect(report.failure).toContain("non-array");

    const thrown = newSocrataFetchReport();
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", thrown);
    expect(thrown.reached).toBe(false);
    expect(thrown.failure).toContain("ECONNREFUSED");
  });

  test("a caller that passes NO report keeps the previous behaviour exactly", async () => {
    stubFetch({ "e5pk-us93": () => new Response("not found", { status: 404 }) });
    await expect(fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata")).resolves.toEqual([]);
  });
});

/**
 * PR-1 RESTRUCTURE (owner-approved source-provenance policy, plan rev 315,
 * ruling c): the `nys_socrata` / `nyc_socrata` collector entry points were
 * RETIRED and removed from this module, so FIX ② is now pinned at the level that
 * survives — the SODA page reader's honest reach/failure report, which is what
 * the persisted run record (and therefore the DEAD-vs-EMPTY tier) is derived
 * from. The "a source that cannot be reached THROWS" half stays pinned for every
 * collector that still runs by src/jobs/fetch-failure.test.ts.
 */
describe("FIX ② — an unreadable SODA dataset is never an honest empty", () => {
  test("both datasets 404 (the retired source's live state) ⇒ not reached, tier DEAD not FRESH", async () => {
    stubFetch({
      "e5pk-us93": () => new Response("not found", { status: 404 }),
      "hf3r-utnq": () => new Response("not found", { status: 404 }),
    });
    const primary = newSocrataFetchReport();
    const fallback = newSocrataFetchReport();
    const rows = [
      ...(await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", primary)),
      ...(await fetchSocrataBids("https://data.ny.gov", "hf3r-utnq", "nys_socrata", fallback)),
    ];
    expect(rows).toEqual([]);
    expect(primary.reached).toBe(false);
    expect(fallback.reached).toBe(false);
    expect(primary.failure).toContain("HTTP 404");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const now = new Date("2026-09-23T12:00:00.000Z");
    const dead = classifyCollectorTier(
      { source: "nys_socrata", last_run_at: new Date(now.getTime() - 3_600_000).toISOString(), rows_fetched: 0, ran_zero: true, errors: 1 },
      now,
    );
    expect(dead.tier).toBe("DEAD");
    expect(dead.tier).not.toBe("FRESH");
  });

  test("a dataset that ANSWERS with zero rows stays an honest EMPTY", async () => {
    stubFetch({ "e5pk-us93": () => jsonResponse([]) });
    const report = newSocrataFetchReport();
    await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", report);
    expect(report.reached).toBe(true);
    expect(report.failure).toBe(null);
    const now = new Date("2026-09-23T12:00:00.000Z");
    const empty = classifyCollectorTier(
      { source: "nys_socrata", last_run_at: now.toISOString(), rows_fetched: 0, ran_zero: true, errors: 0 },
      now,
    );
    expect(empty.tier).toBe("EMPTY");
    expect(empty.tier).not.toBe("FRESH");
  });
});
