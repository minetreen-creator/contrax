/**
 * SAM.gov national / state-scoped pass (`sam-gov.ts`).
 *
 * DETERMINISTIC, ZERO NETWORK: every SAM.gov byte is served by a stubbed
 * `globalThis.fetch`, so this suite pins the EXACT query the pass sends without
 * touching the real API. Live-source validation is a separate, explicitly
 * invoked check (see `sam-gov.source-validation.test.ts`, opt-in via
 * `BIDS_RUN_LIVE_SOURCE_TESTS=1`).
 *
 * WHY THIS FILE EXISTS — the state-filter bug (owner queue #3, 2026-10-16)
 * -----------------------------------------------------------------------
 * The "regional" pass sent `placeOfPerformance.state=<codes>`. That is the
 * RESPONSE field path, not a query parameter, and SAM's v1 search silently
 * ignores it — so the state-scoped pass returned the unfiltered national pool.
 * Live gate 2026-10-16: `placeOfPerformance.state=VA` → `totalElements` 228,710
 * (byte-identical to the no-parameter baseline; 0/25 rows with a VA
 * place-of-performance), while the honoured spelling `state=VA` → 539 with
 * 25/25 rows Virginia. These tests pin the corrected parameter (and that the
 * ignored spelling never comes back) so the regression cannot be reintroduced.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { buildSamSearchUrl, fetchBids, type RawBid } from "./sam-gov";

const SAM_API = "https://sam.gov/api/prod/sgs/v1/search/";
const PAGE_SIZE = 25;

/** The one result item the stub serves (a real VA place-of-performance row shape). */
const VA_ITEM = {
  _id: "12345",
  parentNoticeId: "abcdef0123456789abcdef0123456789",
  title: "Janitorial services, Richmond VA",
  type: { code: "o", value: "Solicitation" },
  organizationHierarchy: [{ name: "DEPT OF VETERANS AFFAIRS", level: 1 }],
  descriptions: [{ content: "<p>Janitorial services.</p>" }],
  responseDate: "2026-12-01T15:00:00+00:00",
  modifiedDate: "2026-10-15T12:00:00+00:00",
  isActive: true,
  location: { states: [{ code: "VA", name: "Virginia" }] },
};

function searchEnvelope(items: any[], totalElements: number) {
  return {
    page: { size: PAGE_SIZE, totalElements, totalPages: 1, number: 0 },
    _embedded: { results: items },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("sam_gov — the search URL (the state filter is `state=`, never the ignored field path)", () => {
  test("the national pass sends no state filter and keeps every pre-existing param", () => {
    const url = buildSamSearchUrl(undefined, 0);
    expect(url).toBe(
      `${SAM_API}?page=0&size=25&sort=-modifiedDate&mode=opportunities&q=&is_active=true`,
    );
    expect(url).not.toContain("state=");
    expect(url).not.toContain("placeOfPerformance");
  });

  test("a state-scoped page uses `state=<codes>` and nothing else new", () => {
    const url = buildSamSearchUrl("VA,NY", 2);
    expect(url).toBe(
      `${SAM_API}?page=2&size=25&sort=-modifiedDate&mode=opportunities&q=&is_active=true&state=VA,NY`,
    );
  });

  test("the silently-ignored `placeOfPerformance.state=` spelling never comes back", () => {
    for (const states of [undefined, "VA", "VA,NY", "DC,AL,AK,AZ,AR,CA"]) {
      const url = buildSamSearchUrl(states, 0);
      expect(url).not.toContain("placeOfPerformance");
      // Exactly one `state=` occurrence at most (the structured filter).
      expect(url.split("state=").length - 1).toBe(states ? 1 : 0);
    }
  });

  test("the 51-code regional value is passed through unchanged (comma list)", () => {
    const codes = ["DC", "AL", "AK", "AZ", "VA"];
    const url = buildSamSearchUrl(codes.join(","), 0);
    expect(url).toContain(`&state=${codes.join(",")}`);
  });
});

describe("sam_gov — fetchBids issues the corrected state filter (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Serve the search envelope for the search URL; an empty detail for the rest. */
  function stub(): string[] {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith(SAM_API)) return jsonResponse(searchEnvelope([VA_ITEM], 539));
      // The per-notice v2 detail call — best-effort, so an empty shape is fine.
      return jsonResponse({});
    }) as typeof fetch;
    return asked;
  }

  test("the regional pass asks SAM for the requested state (and only then)", async () => {
    const asked = stub();
    const rows: RawBid[] = await fetchBids({ states: ["VA"] });

    const searchUrls = asked.filter((u) => u.startsWith(SAM_API));
    expect(searchUrls.length).toBe(1);
    expect(searchUrls[0]).toBe(buildSamSearchUrl("VA", 0));
    expect(searchUrls[0]).toContain("&state=VA");
    expect(searchUrls[0]).not.toContain("placeOfPerformance");

    expect(rows.length).toBe(1);
    expect(rows[0].source_label).toBe("sam_gov_regional");
    expect(rows[0].external_id).toBe("sam-12345");
  });

  test("the state-value logic is unchanged: only bare uppercase USPS codes survive", async () => {
    const asked = stub();
    await fetchBids({ states: ["va", "VA", "Virginia", "", "NY"] });
    const searchUrls = asked.filter((u) => u.startsWith(SAM_API));
    // "va" (lowercase), "Virginia" and "" are dropped exactly as before.
    expect(searchUrls[0]).toContain("&state=VA,NY");
  });

  test("no states ⇒ the national URL, with no state filter at all", async () => {
    const asked = stub();
    const rows = await fetchBids();
    const searchUrls = asked.filter((u) => u.startsWith(SAM_API));
    expect(searchUrls[0]).toBe(buildSamSearchUrl(undefined, 0));
    expect(searchUrls[0]).not.toContain("state=");
    expect(rows[0].source_label).toBe("sam_gov");
  });
});
