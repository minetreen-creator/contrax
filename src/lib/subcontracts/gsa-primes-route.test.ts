/**
 * Contrax — /api/subcontracts/primes ROUTE WIRING (bun test).
 *
 * The route's ONLY job beyond parsing is to hand the right directory to the read layer:
 * `?source=gsa` must reach the read layer as `gsa`, an ABSENT source must reach it as the
 * shipped default `sba`, and a PRESENT-but-unknown source must answer 400 WITHOUT the read
 * layer (and therefore without SQL) ever being called.
 *
 * Network-free and database-free: the read layer is INJECTED as a recorder
 * (`primesHandler(read)`), so this suite proves the ROUTE's behaviour and touches no store.
 *
 * WHY INJECTION RATHER THAN `mock.module`: bun's mock registry is PROCESS-GLOBAL and is
 * never un-registered, so mocking `~/lib/subcontracts/read.server` here also replaced the
 * REAL module for every later test file in the same `bun test` run. That is exactly how CI
 * job 108393585184 failed: this suite ran second, and `gsa-read.test.ts` /
 * `polish-fixes-2026-09-25.test.ts` then compared this file's canned payload against their
 * assertions about the real read layer (a 400 body before any SQL, and a fail-closed
 * unavailable state). No test file in this directory registers a module mock any more: the
 * seam lives in the route, where the default argument is still the real read layer.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { PrimesPayload, PrimesSourceId } from "~/lib/subcontracts/read";

const calls: { source: PrimesSourceId; query: unknown }[] = [];

/** The body the injected read layer answers with — a real, GSA-shaped payload. */
function fakePayload(source: PrimesSourceId): PrimesPayload {
  return {
    rows: [],
    counts: { filtered: 0, directoryTotal: 0 },
    fy: "past fiscal year",
    sourceUrl: "https://www.gsa.gov/small-business/find-opportunities",
    page: 1,
    limit: 25,
    hasMore: false,
    options: { naics: [], states: [], naicsTruncated: false },
    generatedAt: "2026-09-26T12:00:00.000Z",
    source,
  };
}

const { primesHandler } = await import("~/routes/api/subcontracts/primes");

const handler = primesHandler(async (query, source) => {
  calls.push({ source, query });
  return fakePayload(source);
});

const get = (query: string) =>
  handler({ request: new Request(`https://www.contrax.company/api/subcontracts/primes${query}`) });

beforeEach(() => {
  calls.length = 0;
});

describe("primes route: the source parameter selects the directory", () => {
  test("an absent source reaches the read layer as the shipped default (sba)", async () => {
    const response = await get("?page=1&limit=25");
    expect(response.status).toBe(200);
    expect(calls.length).toBe(1);
    expect(calls[0]!.source).toBe("sba");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("?source=gsa reaches the read layer as gsa", async () => {
    const response = await get("?source=gsa&naics=236220&state=Virginia");
    expect(response.status).toBe(200);
    expect(calls[0]!.source).toBe("gsa");
    expect(calls[0]!.query).toEqual({ naics: "236220", state: "VIRGINIA", page: 1, limit: 25 });
  });

  test("a present-but-unknown source answers 400 and NEVER calls the read layer", async () => {
    const response = await get("?source=xyz");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "source must be sba or gsa" });
    expect(calls.length).toBe(0);
  });

  test("an invalid filter answers 400 and NEVER calls the read layer", async () => {
    for (const query of ["?naics=abc", "?page=0", "?limit=abc"]) {
      const response = await get(query);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error.length).toBeGreaterThan(10);
    }
    expect(calls.length).toBe(0);
  });

  test("the shipped default handler is the real read layer (the seam cannot silently no-op)", async () => {
    // The production `handler` is built with NO argument: it must be the read layer itself,
    // not a stub. Proving it does not answer from the recorder above keeps the injection
    // seam honest — an injected-only route would be a route nobody ships.
    const { handler: shipped } = await import("~/routes/api/subcontracts/primes");
    expect(shipped).not.toBe(handler);
    const before = calls.length;
    const response = await shipped({
      request: new Request("https://www.contrax.company/api/subcontracts/primes?source=xyz"),
    });
    expect(response.status).toBe(400);
    expect(calls.length).toBe(before);
  });
});
