/**
 * BidNet Direct — Empire State Purchasing Group (`ny_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold verbatim public list pages
 * captured 2026-10-22 (gzipped; see fixtures/ny-bidnet/README.md for the URLs and
 * sha256s) and `now` is injected. The fetch-loop tests stub `fetch` from those
 * same bytes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import { TAIL_SOURCES } from "../runner";
import { BIDNET_MAX_PAGES, BIDNET_PASS_TIMEOUT_MS, bidNetDetailId } from "./bidnet-direct";
import {
  NY_BIDNET_AGENCY,
  NY_BIDNET_ID_PREFIX,
  NY_BIDNET_LIST_URL,
  NY_BIDNET_MAX_PAGES,
  NY_BIDNET_SOURCE,
  fetchNyBidnetBids,
  nyBidnetDetailId,
  nyBidnetListShapeOk,
  nyBidnetStatedOpenCount,
  parseNyBidnet,
  parseNyBidnetPageLinks,
  parseNyBidnetRows,
  type NyBidnetRow,
} from "./ny-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/ny-bidnet/${name}`, import.meta.url))).toString("utf8");

const PAGE1 = read("open-bids-2026-10-22.html.gz");
const PAGE2 = read("open-bids-page2-2026-10-22.html.gz");
const PAGES = [PAGE1, PAGE2];

/** Captured 2026-10-22T21:00Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-22T21:00:00Z");

const ROWS1 = parseNyBidnetRows(PAGE1);
const ROWS2 = parseNyBidnetRows(PAGE2);
const LISTED: NyBidnetRow[] = PAGES.flatMap((h) => parseNyBidnetRows(h));

describe("ny_bidnet — list pages (captured)", () => {
  test("the capture is the Empire State group and its heading total", () => {
    for (const page of PAGES) {
      expect(nyBidnetListShapeOk(page)).toBe(true);
      expect(nyBidnetStatedOpenCount(page)).toBe(436);
    }
  });

  test("page 1 and page 2 are disjoint 25-row pages, every row New York", () => {
    expect(ROWS1.length).toBe(25);
    expect(ROWS2.length).toBe(25);
    const ids = LISTED.map((r) => r.id);
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
    expect(ROWS1[0]!.id).toBe("0000441198");
    expect(ROWS1[0]!.title).toBe("Water Conservation Model Ordinance & Municipal Toolkit");
    expect(ROWS2[0]!.id).toBe("0000441109");
    expect(ROWS2[0]!.title).toBe("Demolition of 790 Dodge Road");
    for (const r of LISTED) {
      expect(r.region).toBe("New York");
      expect(r.closingState).toBe("open");
    }
  });

  test("pagination is the page's own 18 advertised links, inside the default cap", () => {
    const links = parseNyBidnetPageLinks(PAGE1);
    expect(links.length).toBe(18);
    for (const l of links) expect(l.href).toBe(`${NY_BIDNET_LIST_URL}/page${l.pageNumber}`);
    expect(NY_BIDNET_MAX_PAGES).toBe(BIDNET_MAX_PAGES);
    expect(links.length).toBeLessThanOrEqual(NY_BIDNET_MAX_PAGES);
  });
});

describe("ny_bidnet — rows (captured)", () => {
  test("all 50 captured rows are accepted, with the aggregator honesty on every row", () => {
    const { rows, skipped, skippedRows } = parseNyBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^nybidnet-\d+$/);
      expect(r.external_id.startsWith(`${NY_BIDNET_ID_PREFIX}-`)).toBe(true);
      expect(r.agency).toBe(NY_BIDNET_AGENCY);
      expect(r.location).toBe("New York");
      expect(r.description).toContain("not the State of New York's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.estimated_value).toBe("Not specified");
      expect(r.source_url.startsWith(`${NY_BIDNET_LIST_URL}/`)).toBe(true);
      // Contrax's own classification of the TITLE, never of the composed description.
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: NY_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe("NY");
      expect(cols.source_jurisdiction).toBe("NY");
    }
  });

  test("a date-only deadline is stored at 11:59 PM Eastern", () => {
    const { rows } = parseNyBidnet(LISTED, CAPTURED);
    const r = rows.find((x) => x.external_id === "nybidnet-0000441198")!;
    expect(r.due_date).toBe("2026-11-07T04:59:00.000Z"); // 11/06/2026 23:59 EST
  });
});

describe("ny_bidnet — detail ids", () => {
  test("the Empire State title-slug link shape is read, verbatim", () => {
    expect(
      nyBidnetDetailId(
        "/new-york/solicitations/open-bids/Fuel-Generator-and-Off-Road/0000441194?purchasingGroupId=8411151&origin=1",
      ),
    ).toBe("0000441194");
    expect(nyBidnetDetailId("https://www.bidnetdirect.com/new-york/solicitations/open-bids/X/123")).toBe("123");
    // A buyer's own page (live page 18, 2026-10-22).
    expect(
      nyBidnetDetailId(
        "https://www.bidnetdirect.com/new-york/onondaga-county/solicitations/Furnishing-Spider-Control/0000409056?purchasingGroupId=8411151&origin=1",
      ),
    ).toBe("0000409056");
    // The list's own page links are never read as a solicitation.
    expect(nyBidnetDetailId("/new-york/solicitations/open-bids/page2")).toBeNull();
    expect(nyBidnetDetailId("/new-york/solicitations/open-bids/Some-Title/abc")).toBeNull();
    // The SD/NH/VA/CA shape is unchanged.
    expect(bidNetDetailId("/public/supplier/solicitations/statewide/444205633248/abstract?x=1")).toBe("444205633248");
  });
});

describe("ny_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the page selector to 2 pages so the loop reads exactly the captures.
  const trim = (html: string) =>
    html.replace(new RegExp(`${NY_BIDNET_LIST_URL.replace(/[/.]/g, "\\$&")}/page(\\d+)`, "g"), (m, n) =>
      Number(n) <= 2 ? m : `${NY_BIDNET_LIST_URL}/page2`,
    ).replace(/\/new-york\/solicitations\/open-bids\/page([3-9]|1\d)\b/g, "/new-york/solicitations/open-bids/page2");
  const P1 = trim(PAGE1).replace(/436 Open Solicitations/g, "50 Open Solicitations");
  const P2 = trim(PAGE2).replace(/436 Open Solicitations/g, "50 Open Solicitations");

  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === NY_BIDNET_LIST_URL ? P1 : url === `${NY_BIDNET_LIST_URL}/page2` ? P2 : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const { rows } = await fetchNyBidnetBids(CAPTURED);
    expect(asked).toEqual([NY_BIDNET_LIST_URL, `${NY_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><script>window.awsWafCookieDomainList=[]</script></html>", { status: 202 })) as typeof fetch;
    await expect(fetchNyBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("ny_bidnet — registration", () => {
  test("tail source + the approved class map; NYSCR untouched", () => {
    expect(NY_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/new-york/solicitations/open-bids");
    expect(NY_BIDNET_AGENCY).toBe("Empire State Purchasing Group (BidNet Direct)");
    expect(TAIL_SOURCES.some((s) => s.name === "ny_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.ny_bidnet).toEqual({
      class: "state",
      scopeState: "NY",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    expect(SOURCE_CLASSES.ny_nyscr!.scopeState).toBe("NY");
    expect(BIDNET_PASS_TIMEOUT_MS).toBe(120_000);
  });
});
