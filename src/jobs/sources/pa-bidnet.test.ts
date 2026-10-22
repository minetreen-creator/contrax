/**
 * BidNet Direct — Pennsylvania Purchasing Group (`pa_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold verbatim public list pages
 * captured 2026-10-22 (gzipped; see fixtures/pa-bidnet/README.md for the URLs and
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
  PA_BIDNET_AGENCY,
  PA_BIDNET_ID_PREFIX,
  PA_BIDNET_LIST_URL,
  PA_BIDNET_MAX_PAGES,
  PA_BIDNET_PASS_TIMEOUT_MS,
  PA_BIDNET_SOURCE,
  fetchPaBidnetBids,
  paBidnetListShapeOk,
  paBidnetStatedOpenCount,
  parsePaBidnet,
  parsePaBidnetPageLinks,
  parsePaBidnetRows,
  type PaBidnetRow,
} from "./pa-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/pa-bidnet/${name}`, import.meta.url))).toString("utf8");

const PAGE1 = read("open-bids-2026-10-22.html.gz");
const PAGE2 = read("open-bids-page2-2026-10-22.html.gz");
const PAGES = [PAGE1, PAGE2];

/** Captured 2026-10-22T21:30Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-22T21:30:00Z");

const ROWS1 = parsePaBidnetRows(PAGE1);
const ROWS2 = parsePaBidnetRows(PAGE2);
const LISTED: PaBidnetRow[] = PAGES.flatMap((h) => parsePaBidnetRows(h));

describe("pa_bidnet — list pages (captured)", () => {
  test("the capture is the Pennsylvania group and its comma heading total", () => {
    for (const page of PAGES) {
      expect(paBidnetListShapeOk(page)).toBe(true);
      expect(paBidnetStatedOpenCount(page)).toBe(1263);
    }
  });

  test("page 1 and page 2 are disjoint 25-row pages, every row Pennsylvania", () => {
    expect(ROWS1.length).toBe(25);
    expect(ROWS2.length).toBe(25);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(ROWS1[0]!.id).toBe("444206881599");
    expect(ROWS1[0]!.title).toBe('Fertilization and Weed Control Services');
    expect(ROWS2[0]!.id).toBe("444205633218");
    expect(ROWS2[0]!.title).toBe('Engineering Services for the Earles Lane Culvert Replacement Project');
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(r.region).toBe("Pennsylvania");
      expect(r.closingState).toBe("open");
    }
  });

  test("pagination: 51 advertised pages, past the default cap and inside this group's own", () => {
    const links = parsePaBidnetPageLinks(PAGE1);
    expect(links.length).toBe(51);
    for (const l of links) expect(l.href).toBe(`${PA_BIDNET_LIST_URL}/page${l.pageNumber}`);
    expect(links.length).toBeGreaterThan(BIDNET_MAX_PAGES);
    expect(PA_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(links.length);
    expect(PA_BIDNET_PASS_TIMEOUT_MS).toBe(240_000);
    expect(PA_BIDNET_PASS_TIMEOUT_MS).toBeGreaterThan(BIDNET_PASS_TIMEOUT_MS);
  });
});

describe("pa_bidnet — rows (captured)", () => {
  test("all 50 captured rows are accepted, with the aggregator honesty on every row", () => {
    const { rows, skipped } = parsePaBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^pabidnet-\d+$/);
      expect(r.external_id.startsWith(`${PA_BIDNET_ID_PREFIX}-`)).toBe(true);
      expect(r.agency).toBe(PA_BIDNET_AGENCY);
      expect(r.location).toBe("Pennsylvania");
      expect(r.description).toContain("not the State of Pennsylvania's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: PA_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe("PA");
      expect(cols.source_jurisdiction).toBe("PA");
    }
    // Date only → 11:59 PM Eastern (12/02/2026 23:59 EST).
    expect(rows.find((r) => r.external_id === "pabidnet-444206881599")!.due_date).toBe("2026-12-03T04:59:00.000Z");
  });
});

describe("pa_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the page selector to 2 pages (and the heading to 50) so the loop reads
  // exactly the captures instead of waiting out 51 politeness delays.
  const trim = (html: string) =>
    html
      .replace(/(\/pennsylvania\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/1,263 Open Solicitations/g, "50 Open Solicitations");

  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body =
        url === PA_BIDNET_LIST_URL ? trim(PAGE1) : url === `${PA_BIDNET_LIST_URL}/page2` ? trim(PAGE2) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const { rows } = await fetchPaBidnetBids(CAPTURED);
    expect(asked).toEqual([PA_BIDNET_LIST_URL, `${PA_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchPaBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("pa_bidnet — registration", () => {
  test("tail source + the approved class map; pa_dgs_emarketplace untouched", () => {
    expect(PA_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/pennsylvania/solicitations/open-bids");
    expect(PA_BIDNET_AGENCY).toBe("Pennsylvania Purchasing Group (BidNet Direct)");
    expect(TAIL_SOURCES.some((s) => s.name === "pa_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.pa_bidnet).toEqual({
      class: "state",
      scopeState: "PA",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    expect(SOURCE_CLASSES.pa_dgs_emarketplace!.scopeState).toBe("PA");
  });
});
