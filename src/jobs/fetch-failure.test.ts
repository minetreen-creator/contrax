/**
 * DEAD-COLLECTOR ERROR CLASSIFICATION — regression pins (owner direction
 * 2026-09-23, item ③: "correct dead-collector error reporting so a 404 becomes
 * DEAD, not EMPTY").
 *
 * THE GAP THESE PIN: migration 049's tier rule (and its TS twin
 * `src/lib/collector-freshness.ts`) reads a run as
 *   DEAD  ⇔ errors > 0 AND rows_fetched = 0
 *   EMPTY ⇔ errors = 0 AND rows_fetched = 0
 * Most connectors swallowed an HTTP 404 / transport failure into a bare
 * `return []` and only `console.error`-ed it, so a dead endpoint was recorded
 * as `errors = 0` — indistinguishable from an honest zero — and the DEAD tier
 * could never fire.
 *
 * BOTH DIRECTIONS ARE PINNED, for the shared rule AND for every connector that
 * had a swallow path:
 *   (a) 404 / transport failure ⇒ the fetch reports an error ⇒ run record
 *       `errors > 0, rows_fetched = 0` ⇒ tier DEAD (pass outcome `data_error`);
 *   (b) a HEALTHY 200 that carries zero rows ⇒ NO error ⇒ `errors = 0,
 *       rows_fetched = 0` ⇒ tier EMPTY, outcome `zero_empty`, unchanged;
 *   (c) a partial failure (one page failed, rows were read) ⇒ rows are returned
 *       and no error is raised — a productive fetch must never become DEAD.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE: `globalThis.fetch` is replaced per
 * test and restored in `afterEach`; the runner-level cases pass a fake `sql`
 * that records the statements instead of touching Neon.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  FetchFailures,
  FetchRequestError,
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "./fetch-failure";
import { syncSource } from "./runner";
import { classifyPassOutcome } from "./pass-outcome";
import { classifyCollectorTier } from "~/lib/collector-freshness";
import type { RawBid } from "./sources/sam-gov";

// ── fetch stubbing (the repo's existing pattern: see socrata.test.ts) ─────────

const REAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Answer every request with the SAME response (status/body). */
function stubFetchAlways(respond: () => Response): void {
  globalThis.fetch = (async () => respond()) as typeof fetch;
}

/** Answer by URL substring; the first matching needle wins. */
function stubFetchBy(answers: Record<string, () => Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, answer] of Object.entries(answers)) {
      if (url.includes(needle)) return answer();
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// ── the runner's run-record channel (fake sql, no database) ───────────────────

interface RunLogRow {
  source: string;
  rows_fetched: number;
  rows_new: number;
  ran_zero: boolean;
  errors: number;
}

/**
 * A `sql` stand-in that captures the `collector_run_log` INSERT `syncSource`
 * performs and returns no rows for reads. The column order of that INSERT is
 * the contract this file reads (runner.ts:827-837).
 */
function fakeSql(): { sql: any; runLog: RunLogRow[]; statements: string[] } {
  const runLog: RunLogRow[] = [];
  const statements: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push(text);
    if (/INSERT INTO collector_run_log/.test(text)) {
      runLog.push({
        source: String(values[0]),
        rows_fetched: Number(values[1]),
        rows_new: Number(values[2]),
        ran_zero: Boolean(values[3]),
        errors: Number(values[4]),
      });
    }
    return Promise.resolve([]);
  }) as any;
  return { sql, runLog, statements };
}

const NOW = new Date("2026-09-23T18:00:00.000Z");

function bid(over: Partial<RawBid> = {}): RawBid {
  return {
    external_id: "sam-100000",
    title: "W--LEAVENWORTH NFH-FISH TRANSPORTATION",
    agency: "AGRICULTURE, DEPARTMENT OF",
    description: "Fish transportation services.",
    location: "Leavenworth, WA",
    category: "Transportation",
    due_date: "2026-10-30T00:00:00.000Z",
    estimated_value: "",
    source_url: "https://sam.gov/opp/abc",
    set_aside: null,
    ...over,
  };
}

describe("FetchFailures — the one rule: unreachable vs honest empty", () => {
  test("nothing readable + a failure ⇒ SourceUnreachableError", () => {
    const f = new FetchFailures();
    f.record(httpFailureDetail(404, "https://data.ny.gov/resource/e5pk-us93.json"));
    expect(() => f.assertReached("nys_socrata")).toThrow(SourceUnreachableError);
    try {
      f.assertReached("nys_socrata");
    } catch (e) {
      expect((e as SourceUnreachableError).source).toBe("nys_socrata");
      expect((e as SourceUnreachableError).failures).toEqual([
        "HTTP 404 for https://data.ny.gov/resource/e5pk-us93.json",
      ]);
      expect((e as Error).message).toContain("nys_socrata unreachable: HTTP 404");
    }
  });

  test("no failure at all (an honest zero) ⇒ never throws", () => {
    expect(() => new FetchFailures().assertReached("nys_socrata")).not.toThrow();
  });

  test("a response body WAS read ⇒ reachable, even with earlier page failures", () => {
    const f = new FetchFailures().record(httpFailureDetail(500, "https://x/page0"));
    f.markReadable();
    expect(() => f.assertReached("cities")).not.toThrow();
  });

  test("rows came out ⇒ never reported as dead (safety net for a missed markReadable)", () => {
    const f = new FetchFailures().record(requestFailureDetail(new Error("ECONNRESET")));
    expect(() => f.assertReached("cities", 3)).not.toThrow();
  });

  test("details are deduplicated, and 404/transport labels are stable", () => {
    const f = new FetchFailures();
    f.record(httpFailureDetail(404, "https://x/page0"));
    f.record(httpFailureDetail(404, "https://x/page0"));
    f.record(requestFailureDetail(new TypeError("fetch failed")));
    expect(f.count).toBe(2);
    expect(f.details[0]).toBe("HTTP 404 for https://x/page0");
    expect(f.details[1]).toBe("request failed: fetch failed");
    // A status without a URL still reads honestly.
    expect(httpFailureDetail(503)).toBe("HTTP 503");
  });

  test("FetchRequestError carries the HTTP status so a log can name it", () => {
    const err = new FetchRequestError("HTTP 404 for https://x", { status: 404, url: "https://x" });
    expect(err.status).toBe(404);
    expect(err.name).toBe("FetchRequestError");
  });
});

describe("RUN RECORD → TIER: a fetch that cannot read its source is DEAD, not EMPTY", () => {
  test("transport/404 throw ⇒ run row errors=1, rows_fetched=0 ⇒ DEAD + data_error", async () => {
    const { sql, runLog } = fakeSql();
    const result = await syncSource(sql, {
      name: "dead_source",
      fetchFn: async () => {
        throw new SourceUnreachableError("dead_source", [
          "HTTP 404 for https://data.example.gov/resource/gone.json",
        ]);
      },
    });

    // The in-memory result the run summary reads …
    expect(result.fetched).toBe(0);
    expect(result.new).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("HTTP 404");

    // … and the persisted run record, which is what the tier is derived from.
    expect(runLog.length).toBe(1);
    expect(runLog[0]).toEqual({
      source: "dead_source",
      rows_fetched: 0,
      rows_new: 0,
      ran_zero: true,
      errors: 1,
    });

    const tier = classifyCollectorTier(
      {
        source: runLog[0]!.source,
        last_run_at: NOW.toISOString(),
        rows_fetched: runLog[0]!.rows_fetched,
        ran_zero: runLog[0]!.ran_zero,
        errors: runLog[0]!.errors,
      },
      NOW,
    );
    expect(tier.tier).toBe("DEAD");
    expect(tier.tier).not.toBe("EMPTY");
    expect(tier.tier).not.toBe("FRESH");

    const outcome = classifyPassOutcome({
      source: runLog[0]!.source,
      rows_fetched: runLog[0]!.rows_fetched,
      accepted_count: 0,
      skipped_count: 0,
      failed_count: 0,
      rows_new: runLog[0]!.rows_new,
      errors: runLog[0]!.errors,
      ran_zero: runLog[0]!.ran_zero,
      skip_reasons: {},
    });
    expect(outcome.outcome).toBe("data_error");
  });

  test("a HEALTHY 200 with zero rows ⇒ run row errors=0 ⇒ EMPTY + zero_empty (unchanged)", async () => {
    const { sql, runLog } = fakeSql();
    const result = await syncSource(sql, {
      name: "honest_empty_source",
      fetchFn: async () => [],
    });

    expect(result.fetched).toBe(0);
    expect(result.errors).toEqual([]);
    expect(runLog.length).toBe(1);
    expect(runLog[0]).toEqual({
      source: "honest_empty_source",
      rows_fetched: 0,
      rows_new: 0,
      ran_zero: true,
      errors: 0,
    });

    const tier = classifyCollectorTier(
      {
        source: runLog[0]!.source,
        last_run_at: NOW.toISOString(),
        rows_fetched: runLog[0]!.rows_fetched,
        ran_zero: runLog[0]!.ran_zero,
        errors: runLog[0]!.errors,
      },
      NOW,
    );
    expect(tier.tier).toBe("EMPTY");
    expect(classifyPassOutcome({ ...runLog[0], accepted_count: 0, skipped_count: 0, failed_count: 0, skip_reasons: {} }).outcome).toBe(
      "zero_empty",
    );
  });

  test("a productive fetch is untouched (no false DEAD)", async () => {
    const { sql, runLog } = fakeSql();
    const result = await syncSource(sql, {
      name: "healthy_source",
      fetchFn: async () => [bid()],
    });
    expect(result.fetched).toBe(1);
    expect(result.errors).toEqual([]);
    const tier = classifyCollectorTier(
      {
        source: "healthy_source",
        last_run_at: NOW.toISOString(),
        rows_fetched: runLog[0]!.rows_fetched,
        ran_zero: runLog[0]!.ran_zero,
        errors: runLog[0]!.errors,
      },
      NOW,
    );
    expect(tier.tier).toBe("FRESH");
  });

  test("one dead source does NOT abort the run: the next source still runs", async () => {
    const { sql, runLog } = fakeSql();
    const dead = await syncSource(sql, {
      name: "dead_source",
      fetchFn: async () => {
        throw new SourceUnreachableError("dead_source", ["request failed: ECONNREFUSED"]);
      },
    });
    const alive = await syncSource(sql, { name: "alive_source", fetchFn: async () => [bid()] });
    expect(dead.errors.length).toBe(1);
    expect(alive.fetched).toBe(1);
    expect(runLog.map((r) => `${r.source}:${r.errors}`)).toEqual(["dead_source:1", "alive_source:0"]);
  });
});

// ── every connector that used to swallow a 404 ────────────────────────────────
// Each case: a 404 (or transport failure) must SURFACE as an unreachable source,
// while a 200-with-no-rows must stay the honest empty it always was.

describe("connector 404s now surface (and honest empties do not)", () => {
  test("sam-gov (national pass): every page 404 ⇒ unreachable", async () => {
    const { fetchBids } = await import("./sources/sam-gov");
    stubFetchAlways(() => new Response("not found", { status: 404 }));
    await expect(fetchBids()).rejects.toThrow(SourceUnreachableError);
  });

  test("sam-gov: a 200 with no matches is an honest empty", async () => {
    const { fetchBids } = await import("./sources/sam-gov");
    stubFetchAlways(() => jsonResponse({ _embedded: { results: [] } }));
    await expect(fetchBids()).resolves.toEqual([]);
  });

  test("sam-gov: transport failure ⇒ unreachable", async () => {
    const { fetchBids } = await import("./sources/sam-gov");
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(fetchBids()).rejects.toThrow(/sam_gov unreachable: request failed: fetch failed/);
  });

  test("cities keyword pass: all three queries 404 ⇒ unreachable", async () => {
    const { fetchBids } = await import("./sources/cities");
    stubFetchAlways(() => new Response("not found", { status: 404 }));
    await expect(fetchBids({ delayMs: 0 })).rejects.toThrow(/cities unreachable/);
  });

  test("cities keyword pass: 200 with no items stays an honest empty", async () => {
    const { fetchBids } = await import("./sources/cities");
    stubFetchAlways(() => jsonResponse({ _embedded: { results: [] } }));
    await expect(fetchBids({ delayMs: 0 })).resolves.toEqual([]);
  });

  test("state-keyword door: a 404 on the page ⇒ unreachable", async () => {
    const { createStateKeywordSource } = await import("./sources/state-keyword");
    const source = createStateKeywordSource("Ohio", "OH", {
      fetchJson: async () => {
        // Exactly what the production fetch does on a non-200.
        throw new FetchRequestError("HTTP 404 for https://sam.gov/api/...", { status: 404 });
      },
    });
    await expect(source()).rejects.toThrow(/OH unreachable: HTTP 404/);
  });

  test("state-keyword door: a 200 with no items stays an honest empty", async () => {
    const { createStateKeywordSource } = await import("./sources/state-keyword");
    const source = createStateKeywordSource("Ohio", "OH", {
      fetchJson: async () => ({ _embedded: { results: [] } }),
    });
    await expect(source()).resolves.toEqual([]);
  });

  test("va_evirginia: both SAM.gov passes 404 ⇒ unreachable", async () => {
    const { fetchVaEvirginia } = await import("./sources/va-ev");
    stubFetchAlways(() => new Response("not found", { status: 404 }));
    await expect(fetchVaEvirginia()).rejects.toThrow(/va_evirginia unreachable/);
  });

  test("pennbid: 404 ⇒ unreachable; 200 with no open projects stays an honest empty", async () => {
    const { fetchPennBidOpen } = await import("./sources/pennbid");
    stubFetchAlways(() => new Response("not found", { status: 404 }));
    await expect(fetchPennBidOpen()).rejects.toThrow(/pennbid unreachable: HTTP 404/);

    stubFetchAlways(() => jsonResponse({ success: true, payload: { projects: {} } }));
    await expect(fetchPennBidOpen()).resolves.toEqual({ rows: [], skipped: {}, skippedRows: [] });
  });

  test("oh_dayton: 404 ⇒ unreachable; 200 with an empty board stays an honest empty", async () => {
    const { fetchOhDaytonBids } = await import("./sources/oh-dayton");
    stubFetchAlways(() => new Response("not found", { status: 404 }));
    await expect(fetchOhDaytonBids()).rejects.toThrow(/oh_dayton unreachable: HTTP 404/);

    stubFetchAlways(() => new Response("<html><body>No bids</body></html>", { status: 200 }));
    const empty = await fetchOhDaytonBids();
    expect(empty.rows).toEqual([]);
  });

  test("city portals: a 404ed dataset ⇒ unreachable; an empty dataset stays EMPTY", async () => {
    const { CITY_SOURCES } = await import("~/lib/city-procurement");
    const nyc = CITY_SOURCES.find((s) => s.name === "nyc_open_data")!;

    stubFetchAlways(() => new Response("not found", { status: 404 }));
    await expect(nyc.fetch()).rejects.toThrow(/nyc_open_data unreachable: HTTP 404/);

    stubFetchAlways(() => jsonResponse([]));
    await expect(nyc.fetch()).resolves.toEqual([]);
  });

  test("city portals: a partial page failure keeps the rows it did read (never DEAD)", async () => {
    const { CITY_SOURCES } = await import("~/lib/city-procurement");
    const nyc = CITY_SOURCES.find((s) => s.name === "nyc_open_data")!;
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      request_id: `R${i}`,
      short_title: `Janitorial Services ${i}`,
      agency_name: "NYC DCAS",
    }));
    stubFetchBy({
      // Page 1 answers with a full page (forcing a page-2 request) …
      "offset=0": () => jsonResponse(fullPage),
      // … and page 2 fails: the 100 readable rows must still come back.
      "offset=100": () => new Response("boom", { status: 500 }),
    });
    const rows = await nyc.fetch();
    expect(rows.length).toBe(100);
  });

  test("nys_socrata raises the SHARED unreachable error (fix ② unified)", async () => {
    const { nysSocrataSource } = await import("./sources/socrata");
    stubFetchAlways(() => new Response("not found", { status: 404 }));
    const err = await nysSocrataSource().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceUnreachableError);
    expect((err as SourceUnreachableError).source).toBe("nys_socrata");
    expect((err as Error).message).toContain("e5pk-us93");
    expect((err as Error).message).toContain("hf3r-utnq");
  });
});
