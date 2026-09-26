/**
 * Contrax — GSA DIRECTORY SWEEP, unit tests (bun test).
 *
 * Deterministic, network-free, database-free: the run is driven through its OWN injection
 * points (a fake fetcher and a fake store), and the HTTP half is exercised with a fake
 * `fetchImpl`. Nothing here touches gsa.gov, a DATABASE_URL or the clock.
 *
 * WHAT IS PINNED:
 *   1. THE 200-CHANGED WRITE PATH reports exactly what changed, and the rows it writes carry
 *      the raw NAICS value for every invalid code (`naicsRaw`) — the owner refinement: the
 *      invalid values stay identifiable in the data, only validated codes are displayed.
 *   2. A 304 WRITES NO DIRECTORY ROW but still records an `ok` run, so "last checked by
 *      Contrax" stays truthful; the counts a 304 cannot measure are carried from the last
 *      completed run rather than reset to 0.
 *   3. THE BUNDLE RE-RESOLUTION FALLBACK: a moved/broken pinned handle is re-resolved from
 *      the page's own JS, the resolution path is reported in the run log, and if BOTH fail
 *      the fetch THROWS instead of guessing a URL.
 *   4. FAIL-CLOSED: a throw writes ZERO directory rows, records an `error` run row, and the
 *      sweep returns status "error".
 *   5. MISSING/EMPTY FILE REFUSAL: a body with no rows, an empty body and a body-less
 *      "downloaded" result are all refused rather than stored as an empty directory.
 *   6. `nonNaicsDropped` and `nonUsRows` are BOTH reported, distinctly.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createGsaHttp,
  type GsaDirectoryFetchResult,
} from "./gsa-directory.server";
import { EMPTY_GSA_COUNTS, runGsaPrimesSync, type GsaSyncStore } from "./gsa-sync.server";
import { GSA_PRIME_DIRECTORY_SOURCE } from "./connector";
import type { GsaDirectoryRow } from "./gsa-directory";

/** The committed slice of the REAL file: 23 rows, 12 invalid NAICS, 2 `Non-US`. */
const FIXTURE_TEXT = readFileSync(
  new URL("./fixtures/gsa-directory-slice.csv", import.meta.url),
  "utf8",
);
const DATED_URL = "https://www.gsa.gov/system/files/subcontractor_directory_Jul-9-2025.csv";
const PAGE_URL = "https://www.gsa.gov/small-business/find-opportunities";
/** The pinned handle resolves at the HOST ROOT (the path in the page's JS is absolute). */
const PINNED_URL = "https://www.gsa.gov/media/170283";
const SOURCE_ID = "11111111-2222-3333-4444-555555555555";

function downloaded(over: Partial<GsaDirectoryFetchResult> = {}): GsaDirectoryFetchResult {
  return {
    kind: "downloaded",
    fileUrl: DATED_URL,
    fileName: "subcontractor_directory_Jul-9-2025.csv",
    fileDate: "2025-07-09",
    lastModified: "Wed, 13 May 2026 12:00:00 GMT",
    contentSha256: "sha-of-new-bytes",
    text: FIXTURE_TEXT,
    pathResolvedFrom: "pin",
    notModified: false,
    contentUnchanged: false,
    requests: 2,
    ...over,
  };
}

function notModified(over: Partial<GsaDirectoryFetchResult> = {}): GsaDirectoryFetchResult {
  return {
    ...downloaded(),
    kind: "not-modified",
    contentSha256: "sha-already-stored",
    text: null,
    notModified: true,
    contentUnchanged: true,
    requests: 2,
    ...over,
  };
}

/** A recording fake of the store surface the sweep uses. NOTHING here is a database. */
function fakeStore(options: { stored?: number; previous?: Record<string, unknown> | null } = {}) {
  const calls = { upsert: [] as { rows: readonly GsaDirectoryRow[]; fetchedAt: string }[], runs: [] as Record<string, unknown>[] };
  const stored = options.stored ?? 0;
  const store: GsaSyncStore & { calls: typeof calls } = {
    calls,
    ensureSource: async () => SOURCE_ID,
    previousRunCounts: async () => options.previous ?? null,
    storedUeis: async () => new Set<string>(),
    storedRowCount: async () => stored,
    upsertPrimes: async (_sourceId, rows, fetchedAt) => {
      calls.upsert.push({ rows, fetchedAt });
      return { inserted: rows.length, updated: 0 };
    },
    recordRun: async (opts) => {
      calls.runs.push(opts as unknown as Record<string, unknown>);
      return "run-id-1";
    },
  };
  return store;
}

describe("gsa sweep: the 200-changed path reports what changed and stores the raw codes", () => {
  test("counts are measured, the invalid codes are stored verbatim, and the run is ok", async () => {
    const store = fakeStore();
    const result = await runGsaPrimesSync({
      store,
      fetchDirectory: async () => downloaded(),
      now: new Date("2026-09-26T12:00:00.000Z"),
    });

    expect(result.status).toBe("ok");
    expect(result.runId).toBe("run-id-1");
    const c = result.counts;
    expect(c.rowsSeen).toBe(23);
    expect(c.inserted).toBe(23);
    expect(c.updated).toBe(0);
    expect(c.unchanged).toBe(0);
    expect(c.missingFromLatestFile).toBe(0);
    // BOTH honesty counts, distinctly:
    expect(c.nonNaicsDropped).toBe(12);
    expect(c.nonUsRows).toBe(2);
    expect(c.validNaicsRows).toBe(11);
    // The source's own evidence, never a claim:
    expect(c.fileDate).toBe("2025-07-09");
    expect(c.fileName).toBe("subcontractor_directory_Jul-9-2025.csv");
    expect(c.lastModified).toBe("Wed, 13 May 2026 12:00:00 GMT");
    expect(c.contentSha256).toBe("sha-of-new-bytes");
    expect(c.pathResolvedFrom).toBe("pin");
    expect(c.notModified).toBe(false);
    expect(c.requests).toBe(2);

    // THE OWNER REFINEMENT: what is written carries the raw value for every invalid code and
    // NULL for every valid one, so `naics_raw IS NOT NULL` counts the 12 exactly.
    const written = store.calls.upsert[0]!.rows;
    expect(written.length).toBe(23);
    const withRaw = written.filter((row) => row.naicsRaw !== null);
    expect(withRaw.length).toBe(12);
    expect(withRaw.map((row) => row.naicsRaw).sort().slice(0, 3)).toEqual(["0000", "006", "01"]);
    expect(written.filter((row) => row.naicsRaw === null).length).toBe(11);
    // And only validated six-digit codes are in the DISPLAYED array.
    expect(written.every((row) => row.naics.every((code) => /^\d{6}$/.test(code)))).toBe(true);

    // The run row carries the same counts, verbatim.
    const run = store.calls.runs[0]!;
    expect(run.status).toBe("ok");
    expect((run.counts as Record<string, unknown>).nonNaicsDropped).toBe(12);
    expect((run.counts as Record<string, unknown>).nonUsRows).toBe(2);
  });

  test("a row that vanished from the newer file is COUNTED, never deleted", async () => {
    const store = fakeStore();
    store.storedUeis = async () => new Set(["GONE00000001", "FBMJWJUTP7Z2"]);
    store.storedRowCount = async () => 2;
    const result = await runGsaPrimesSync({ store, fetchDirectory: async () => downloaded() });
    // Only the UEI that is genuinely absent from the new file counts.
    expect(result.counts.missingFromLatestFile).toBe(1);
    expect(result.status).toBe("ok");
  });
});

describe("gsa sweep: a 304 writes NO row but still records the check", () => {
  test("nothing is written, an ok run row is recorded, and counts are carried honestly", async () => {
    const store = fakeStore({
      stored: 2072,
      previous: {
        nonNaicsDropped: 105,
        nonUsRows: 17,
        lastModified: "Wed, 13 May 2026 12:00:00 GMT",
        contentSha256: "sha-already-stored",
        fileUrl: DATED_URL,
      },
    });
    const result = await runGsaPrimesSync({ store, fetchDirectory: async () => notModified() });

    expect(result.status).toBe("ok");
    expect(store.calls.upsert.length).toBe(0);
    expect(result.counts.notModified).toBe(true);
    expect(result.counts.rowsSeen).toBe(0);
    expect(result.counts.unchanged).toBe(2072);
    expect(result.counts.storedRows).toBe(2072);
    // The counts a 304 cannot measure come from the last completed run, never reset to 0.
    expect(result.counts.nonNaicsDropped).toBe(105);
    expect(result.counts.nonUsRows).toBe(17);
    const run = store.calls.runs[0]!;
    expect(run.status).toBe("ok");
    expect(String(run.message)).toContain("no directory rows written");
  });
});

describe("gsa sweep: failures are fail-closed (zero writes, an error row, status error)", () => {
  test("a throw from the fetcher writes nothing and records which STAGE failed", async () => {
    const store = fakeStore();
    const result = await runGsaPrimesSync({
      store,
      fetchDirectory: async () => {
        throw new Error("could not resolve the GSA directory CSV: refusing to guess a URL");
      },
    });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("fetch");
    expect(store.calls.upsert.length).toBe(0);
    expect(store.calls.runs.length).toBe(1);
    expect(store.calls.runs[0]!.status).toBe("error");
    expect(result.counts.rowsSeen).toBe(0);
    expect(EMPTY_GSA_COUNTS.nonUsRows).toBe(0);
  });

  test("a header-only file is refused (never stored as an empty directory)", async () => {
    const store = fakeStore();
    const headerOnly = FIXTURE_TEXT.split("\r\n")[0]!;
    const result = await runGsaPrimesSync({
      store,
      fetchDirectory: async () => downloaded({ text: headerOnly }),
    });
    expect(result.status).toBe("error");
    expect(result.error?.stage).toBe("parse");
    expect(String(result.error?.message)).toContain("refusing to write an empty prime directory");
    expect(store.calls.upsert.length).toBe(0);
  });

  test("an EMPTY body and a body-less 'downloaded' result are both refused", async () => {
    const empty = await runGsaPrimesSync({
      store: fakeStore(),
      fetchDirectory: async () => downloaded({ text: "   " }),
    });
    expect(empty.status).toBe("error");
    expect(empty.error?.stage).toBe("parse");

    const bodyless = await runGsaPrimesSync({
      store: fakeStore(),
      fetchDirectory: async () => downloaded({ text: null }),
    });
    expect(bodyless.status).toBe("error");
    expect(String(bodyless.error?.message)).toContain("carried no body");
  });

  test("a dry run writes nothing at all, not even a run row", async () => {
    const result = await runGsaPrimesSync({ dryRun: true, fetchDirectory: async () => downloaded() });
    expect(result.status).toBe("ok");
    expect(result.runId).toBeNull();
    expect(result.counts.rowsSeen).toBe(23);
    expect(result.counts.nonUsRows).toBe(2);
    expect(result.counts.unchanged).toBe(23);
  });
});

describe("gsa fetch: the resolution guard (no browser, no guessed URL)", () => {
  const csvResponse = (body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status: 200, headers });

  test("a pinned 302 resolves the dated file, and the path is reported", async () => {
    const calls: string[] = [];
    const fetcher = createGsaHttp({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/media/170283")) {
          return new Response(null, { status: 302, headers: { location: DATED_URL } });
        }
        return csvResponse(FIXTURE_TEXT, { "last-modified": "Wed, 13 May 2026 12:00:00 GMT" });
      }) as unknown as typeof fetch,
    });
    const result = await fetcher();
    expect(result.pathResolvedFrom).toBe("pin");
    expect(result.fileUrl).toBe(DATED_URL);
    expect(result.fileDate).toBe("2025-07-09");
    expect(result.fileName).toBe("subcontractor_directory_Jul-9-2025.csv");
    expect(result.notModified).toBe(false);
    expect(result.text).toContain("Unique Entity ID (UEI)");
    expect(calls).toEqual([PINNED_URL, DATED_URL]);
  });

  test("a moved handle is re-resolved from the page's own JS bundles", async () => {
    const calls: string[] = [];
    const bundle = 'var x = Papa.parse("/media/999999", { download: true });';
    const fetcher = createGsaHttp({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/media/170283")) return new Response(null, { status: 404 });
        if (url === PAGE_URL) {
          return new Response('<html><script src="/files/js/js_abc123.js"></script></html>', {
            status: 200,
          });
        }
        if (url.endsWith("/files/js/js_abc123.js")) return new Response(bundle, { status: 200 });
        if (url.endsWith("/media/999999")) {
          return new Response(null, { status: 302, headers: { location: DATED_URL } });
        }
        return csvResponse(FIXTURE_TEXT);
      }) as unknown as typeof fetch,
    });
    const result = await fetcher();
    expect(result.pathResolvedFrom).toBe("bundle-discovery");
    expect(result.fileUrl).toBe(DATED_URL);
    expect(calls[0]).toBe(PINNED_URL);
    expect(calls).toContain("https://www.gsa.gov/files/js/js_abc123.js");
  });

  test("when BOTH the handle and the bundles fail, the fetch THROWS (never a guessed URL)", async () => {
    const fetcher = createGsaHttp({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url === PAGE_URL) return new Response("<html>no scripts</html>", { status: 200 });
        return new Response(null, { status: 500 });
      }) as unknown as typeof fetch,
      attempts: 1,
    });
    await expect(fetcher()).rejects.toThrow(/refusing to guess a URL/);
  });

  test("a non-allowlisted host is refused outright", async () => {
    const fetcher = createGsaHttp({
      fetchImpl: (async () => new Response("nope", { status: 200 })) as unknown as typeof fetch,
      pageUrl: "https://evil.example.com/small-business/find-opportunities",
      attempts: 1,
    });
    await expect(fetcher()).rejects.toThrow(/not on the GSA allowlist/);
  });

  test("a conditional GET on the SAME dated file returns 304 with no body", async () => {
    let sentIfModifiedSince: string | null = null;
    const fetcher = createGsaHttp({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/media/170283")) {
          return new Response(null, { status: 302, headers: { location: DATED_URL } });
        }
        sentIfModifiedSince = new Headers(init?.headers).get("if-modified-since");
        return new Response(null, { status: 304 });
      }) as unknown as typeof fetch,
    });
    const result = await fetcher({
      stored: { lastModified: "Wed, 13 May 2026 12:00:00 GMT", contentSha256: null, fileUrl: DATED_URL },
    });
    expect(sentIfModifiedSince).toBe("Wed, 13 May 2026 12:00:00 GMT");
    expect(result.notModified).toBe(true);
    expect(result.text).toBeNull();
    expect(result.fileDate).toBe("2025-07-09");
  });

  test("a 200 whose bytes match the stored sha256 is reported as unchanged content", async () => {
    const fetcher = createGsaHttp({
      fetchImpl: (async (input: string | URL | Request) =>
        String(input).endsWith("/media/170283")
          ? new Response(null, { status: 302, headers: { location: DATED_URL } })
          : csvResponse(FIXTURE_TEXT)) as unknown as typeof fetch,
    });
    // The sha256 of the fixture bytes, computed the same way the fetcher does.
    const first = await fetcher();
    const second = await createGsaHttp({
      fetchImpl: (async (input: string | URL | Request) =>
        String(input).endsWith("/media/170283")
          ? new Response(null, { status: 302, headers: { location: DATED_URL } })
          : csvResponse(FIXTURE_TEXT)) as unknown as typeof fetch,
    })({ stored: { lastModified: null, contentSha256: first.contentSha256, fileUrl: DATED_URL } });
    expect(second.contentUnchanged).toBe(true);
    expect(second.kind).toBe("not-modified");
    // The caller still sees the bytes (the sha comparison is reported, not hidden).
    expect(second.text).not.toBeNull();
  });
});

describe("gsa sweep: the connector row it resolves", () => {
  test("the source is the GSA find-opportunities page, an annual curated prime directory", () => {
    expect(GSA_PRIME_DIRECTORY_SOURCE.sourceKey).toBe("gsa-find-opportunities");
    expect(GSA_PRIME_DIRECTORY_SOURCE.agency).toBe("GSA");
    expect(GSA_PRIME_DIRECTORY_SOURCE.kind).toBe("prime_directory");
    expect(GSA_PRIME_DIRECTORY_SOURCE.coverageTier).toBe("curated");
    expect(GSA_PRIME_DIRECTORY_SOURCE.officialUrl).toBe(PAGE_URL);
    expect(GSA_PRIME_DIRECTORY_SOURCE.cadence).toContain("annual file");
    expect(GSA_PRIME_DIRECTORY_SOURCE.cadence).toContain("conditional-GET");
  });
});
