/**
 * Contrax — /api/subcontracts/primes ROUTE WIRING (bun test).
 *
 * The route's ONLY job beyond parsing is to hand the right directory to the read layer:
 * `?source=gsa` must reach `readPrimesPayload` as `gsa`, an ABSENT source must reach it as
 * the shipped default `sba`, and a PRESENT-but-unknown source must answer 400 WITHOUT the
 * read layer (and therefore without SQL) ever being called.
 *
 * Network-free and database-free: `readPrimesPayload` is mocked to a recorder, so this
 * suite proves the ROUTE's behaviour and touches no store.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

const calls: { source: unknown; query: unknown }[] = [];
mock.module("~/lib/subcontracts/read.server", () => ({
  readPrimesPayload: async (query: unknown, source: unknown) => {
    calls.push({ source, query });
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
  },
}));

const { handler } = await import("~/routes/api/subcontracts/primes");

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
});
