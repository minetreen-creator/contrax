/**
 * BidNet Direct — Ohio Purchasing Group (`oh_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold verbatim public list pages
 * captured 2026-10-22 (gzipped; see fixtures/oh-bidnet/README.md for the URLs and
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
import { BIDNET_MAX_PAGES, BIDNET_PASS_TIMEOUT_MS } from "./bidnet-direct";
import {
  OH_BIDNET_AGENCY,
  OH_BIDNET_ID_PREFIX,
  OH_BIDNET_LIST_URL,
  OH_BIDNET_MAX_PAGES,
  OH_BIDNET_PASS_TIMEOUT_MS,
  OH_BIDNET_SOURCE,
  fetchOhBidnetBids,
  ohBidnetListShapeOk,
  ohBidnetStatedOpenCount,
  parseOhBidnet,
  parseOhBidnetPageLinks,
  parseOhBidnetRows,
  type OhBidnetRow,
} from "./oh-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/oh-bidnet/${name}`, import.meta.url))).toString("utf8");

const PAGE1 = read("open-bids-2026-10-22.html.gz");
const PAGE2 = read("open-bids-page2-2026-10-22.html.gz");
const PAGES = [PAGE1, PAGE2];

/** Captured 2026-10-22T21:30Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-22T21:30:00Z");

const ROWS1 = parseOhBidnetRows(PAGE1);
const ROWS2 = parseOhBidnetRows(PAGE2);
const LISTED: OhBidnetRow[] = PAGES.flatMap((h) => parseOhBidnetRows(h));

describe("oh_bidnet — list pages (captured)", () => {
  test("the capture is the Ohio group and its comma heading total", () => {
    for (const page of PAGES) {
      expect(ohBidnetListShapeOk(page)).toBe(true);
      expect(ohBidnetStatedOpenCount(page)).toBe(1452);
    }
  });

  test("page 1 and page 2 are disjoint 25-row pages, every row Ohio", () => {
    expect(ROWS1.length).toBe(25);
    expect(ROWS2.length).toBe(25);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(ROWS1[0]!.id).toBe("444206684368");
    expect(ROWS1[0]!.title).toBe('Remote Communications and Service Delivery System - DRC270070 - OSC');
    expect(ROWS2[0]!.id).toBe("444206533327");
    expect(ROWS2[0]!.title).toBe('FRONT END LOADER TRAINING');
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(r.region).toBe("Ohio");
      expect(r.closingState).toBe("open");
    }
  });

  test("pagination: 59 advertised pages, past the default cap and inside this group's own", () => {
    const links = parseOhBidnetPageLinks(PAGE1);
    expect(links.length).toBe(59);
    for (const l of links) expect(l.href).toBe(`${OH_BIDNET_LIST_URL}/page${l.pageNumber}`);
    expect(links.length).toBeGreaterThan(BIDNET_MAX_PAGES);
    expect(OH_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(links.length);
    expect(OH_BIDNET_PASS_TIMEOUT_MS).toBe(240_000);
    expect(OH_BIDNET_PASS_TIMEOUT_MS).toBeGreaterThan(BIDNET_PASS_TIMEOUT_MS);
  });
});

describe("oh_bidnet — rows (captured)", () => {
  test("all 50 captured rows are accepted, with the aggregator honesty on every row", () => {
    const { rows, skipped } = parseOhBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^ohbidnet-\d+$/);
      expect(r.external_id.startsWith(`${OH_BIDNET_ID_PREFIX}-`)).toBe(true);
      expect(r.agency).toBe(OH_BIDNET_AGENCY);
      expect(r.location).toBe("Ohio");
      expect(r.description).toContain("not the State of Ohio's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: OH_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe("OH");
      expect(cols.source_jurisdiction).toBe("OH");
    }
    // Date only → 11:59 PM Eastern (11/25/2026 23:59 EST).
    expect(rows.find((r) => r.external_id === "ohbidnet-444206684368")!.due_date).toBe("2026-11-26T04:59:00.000Z");
  });
});

describe("oh_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the page selector to 2 pages (and the heading to 50) so the loop reads
  // exactly the captures instead of waiting out 59 politeness delays.
  const trim = (html: string) =>
    html
      .replace(/(\/ohio\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/1,452 Open Solicitations/g, "50 Open Solicitations");

  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body =
        url === OH_BIDNET_LIST_URL ? trim(PAGE1) : url === `${OH_BIDNET_LIST_URL}/page2` ? trim(PAGE2) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const { rows } = await fetchOhBidnetBids(CAPTURED);
    expect(asked).toEqual([OH_BIDNET_LIST_URL, `${OH_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchOhBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("oh_bidnet — registration", () => {
  test("tail source + the approved class map; oh_odot untouched", () => {
    expect(OH_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/ohio/solicitations/open-bids");
    expect(OH_BIDNET_AGENCY).toBe("Ohio Purchasing Group (BidNet Direct)");
    expect(TAIL_SOURCES.some((s) => s.name === "oh_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.oh_bidnet).toEqual({
      class: "state",
      scopeState: "OH",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    expect(SOURCE_CLASSES.oh_odot!.scopeState).toBe("OH");
  });
});
