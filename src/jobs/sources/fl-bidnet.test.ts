/**
 * BidNet Direct — Florida Purchasing Group (`fl_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold verbatim public list pages
 * captured 2026-10-22 (gzipped; see fixtures/fl-bidnet/README.md for the URLs and
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
  FL_BIDNET_AGENCY,
  FL_BIDNET_ID_PREFIX,
  FL_BIDNET_LIST_URL,
  FL_BIDNET_MAX_PAGES,
  FL_BIDNET_SOURCE,
  fetchFlBidnetBids,
  flBidnetDetailId,
  flBidnetListShapeOk,
  flBidnetStatedOpenCount,
  parseFlBidnet,
  parseFlBidnetPageLinks,
  parseFlBidnetRows,
  type FlBidnetRow,
} from "./fl-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/fl-bidnet/${name}`, import.meta.url))).toString("utf8");

const PAGE1 = read("open-bids-2026-10-22.html.gz");
const PAGE2 = read("open-bids-page2-2026-10-22.html.gz");
const PAGES = [PAGE1, PAGE2];

/** Captured 2026-10-22T21:00Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-22T21:00:00Z");

const ROWS1 = parseFlBidnetRows(PAGE1);
const ROWS2 = parseFlBidnetRows(PAGE2);
const LISTED: FlBidnetRow[] = PAGES.flatMap((h) => parseFlBidnetRows(h));

describe("fl_bidnet — list pages (captured)", () => {
  test("the capture is the Florida group and its heading total", () => {
    for (const page of PAGES) {
      expect(flBidnetListShapeOk(page)).toBe(true);
      expect(flBidnetStatedOpenCount(page)).toBe(74);
    }
  });

  test("page 1 and page 2 are disjoint 25-row pages, every row Florida", () => {
    expect(ROWS1.length).toBe(25);
    expect(ROWS2.length).toBe(25);
    const ids = LISTED.map((r) => r.id);
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
    expect(ROWS1[0]!.id).toBe("0000441178");
    expect(ROWS1[0]!.title).toBe("Fire Station #2 - Fuel Dispenser");
    expect(ROWS2[0]!.id).toBe("0000439301");
    expect(ROWS2[0]!.title).toBe("SW 600, 700, & 800 BLOCKS OF WEST ATLANTIC AVENUE MIXED-USE DEVELOPMENT PROJECT");
    for (const r of LISTED) {
      expect(r.region).toBe("Florida");
      expect(r.closingState).toBe("open");
    }
  });

  test("pagination is the page's own 3 advertised links, inside the default cap", () => {
    const links = parseFlBidnetPageLinks(PAGE1);
    expect(links.length).toBe(3);
    for (const l of links) expect(l.href).toBe(`${FL_BIDNET_LIST_URL}/page${l.pageNumber}`);
    expect(FL_BIDNET_MAX_PAGES).toBe(BIDNET_MAX_PAGES);
    expect(links.length).toBeLessThanOrEqual(FL_BIDNET_MAX_PAGES);
  });
});

describe("fl_bidnet — rows (captured)", () => {
  test("all 50 captured rows are accepted, with the aggregator honesty on every row", () => {
    const { rows, skipped, skippedRows } = parseFlBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^flbidnet-\d+$/);
      expect(r.external_id.startsWith(`${FL_BIDNET_ID_PREFIX}-`)).toBe(true);
      expect(r.agency).toBe(FL_BIDNET_AGENCY);
      expect(r.location).toBe("Florida");
      expect(r.description).toContain("not the State of Florida's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.estimated_value).toBe("Not specified");
      expect(r.source_url.startsWith(`${FL_BIDNET_LIST_URL}/`)).toBe(true);
      // Contrax's own classification of the TITLE, never of the composed description.
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: FL_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe("FL");
      expect(cols.source_jurisdiction).toBe("FL");
    }
  });

  test("a date-only deadline is stored at 11:59 PM Eastern", () => {
    const { rows } = parseFlBidnet(LISTED, CAPTURED);
    const r = rows.find((x) => x.external_id === "flbidnet-0000441178")!;
    expect(r.due_date).toBe("2026-11-13T04:59:00.000Z"); // 11/12/2026 23:59 EST
  });
});

describe("fl_bidnet — detail ids", () => {
  test("the Empire State title-slug link shape is read, verbatim", () => {
    expect(
      flBidnetDetailId(
        "/florida/solicitations/open-bids/Fire-Station-2-Fuel-Dispenser/0000441178?purchasingGroupId=8408751&origin=1",
      ),
    ).toBe("0000441178");
    expect(flBidnetDetailId("https://www.bidnetdirect.com/florida/solicitations/open-bids/X/123")).toBe("123");
    // A buyer's own page (the shape seen on the live NY list, 2026-10-22).
    expect(
      flBidnetDetailId(
        "https://www.bidnetdirect.com/florida/city-of-delray-beach/solicitations/Some-Title/0000409056",
      ),
    ).toBe("0000409056");
    // The list's own page links are never read as a solicitation.
    expect(flBidnetDetailId("/florida/solicitations/open-bids/page2")).toBeNull();
    expect(flBidnetDetailId("/florida/solicitations/open-bids/Some-Title/abc")).toBeNull();
    // The SD/NH/VA/CA shape is unchanged.
    expect(bidNetDetailId("/public/supplier/solicitations/statewide/444205633248/abstract?x=1")).toBe("444205633248");
  });
});

describe("fl_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the page selector to 2 pages so the loop reads exactly the captures.
  const trim = (html: string) =>
    html.replace(new RegExp(`${FL_BIDNET_LIST_URL.replace(/[/.]/g, "\\$&")}/page(\\d+)`, "g"), (m, n) =>
      Number(n) <= 2 ? m : `${FL_BIDNET_LIST_URL}/page2`,
    ).replace(/\/florida\/solicitations\/open-bids\/page([3-9]|1\d)\b/g, "/florida/solicitations/open-bids/page2");
  const P1 = trim(PAGE1).replace(/74 Open Solicitations/g, "50 Open Solicitations");
  const P2 = trim(PAGE2).replace(/74 Open Solicitations/g, "50 Open Solicitations");

  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === FL_BIDNET_LIST_URL ? P1 : url === `${FL_BIDNET_LIST_URL}/page2` ? P2 : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const { rows } = await fetchFlBidnetBids(CAPTURED);
    expect(asked).toEqual([FL_BIDNET_LIST_URL, `${FL_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><script>window.awsWafCookieDomainList=[]</script></html>", { status: 202 })) as typeof fetch;
    await expect(fetchFlBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("fl_bidnet — registration", () => {
  test("tail source + the approved class map; MFMP untouched", () => {
    expect(FL_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/florida/solicitations/open-bids");
    expect(FL_BIDNET_AGENCY).toBe("Florida Purchasing Group (BidNet Direct)");
    expect(TAIL_SOURCES.some((s) => s.name === "fl_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.fl_bidnet).toEqual({
      class: "state",
      scopeState: "FL",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    expect(SOURCE_CLASSES.fl_mfmp!.scopeState).toBe("FL");
    expect(BIDNET_PASS_TIMEOUT_MS).toBe(120_000);
  });
});
