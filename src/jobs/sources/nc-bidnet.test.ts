/**
 * BidNet Direct — North Carolina Purchasing Group (`nc_bidnet`) connector pins.
 * Zero network, no database: the fixture is the verbatim public list page
 * captured 2026-10-22 (gzipped; see fixtures/nc-bidnet/README.md for the URL and
 * sha256) and `now` is injected. The fetch-loop tests stub `fetch` from those
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
import { BIDNET_MAX_PAGES } from "./bidnet-direct";
import {
  NC_BIDNET_AGENCY,
  NC_BIDNET_ID_PREFIX,
  NC_BIDNET_LIST_URL,
  NC_BIDNET_MAX_PAGES,
  NC_BIDNET_SOURCE,
  fetchNcBidnetBids,
  ncBidnetListShapeOk,
  ncBidnetStatedOpenCount,
  parseNcBidnet,
  parseNcBidnetPageLinks,
  parseNcBidnetRows,
} from "./nc-bidnet";

const PAGE = gunzipSync(
  readFileSync(new URL("./fixtures/nc-bidnet/open-bids-2026-10-22.html.gz", import.meta.url)),
).toString("utf8");

/** Captured 2026-10-22T21:00Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-22T21:00:00Z");

const LISTED = parseNcBidnetRows(PAGE);

describe("nc_bidnet — list page (captured)", () => {
  test("the capture is the whole North Carolina group on one page", () => {
    expect(ncBidnetListShapeOk(PAGE)).toBe(true);
    expect(ncBidnetStatedOpenCount(PAGE)).toBe(14);
    expect(LISTED.length).toBe(14);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(14);
    // One page: no page selector, so the reader asks for nothing more.
    expect(parseNcBidnetPageLinks(PAGE)).toEqual([]);
    expect(NC_BIDNET_MAX_PAGES).toBe(BIDNET_MAX_PAGES);
    expect(LISTED[0]!.id).toBe("0000441005");
    expect(LISTED[0]!.title).toBe("Durham Transit Plan");
    for (const r of LISTED) {
      expect(r.region).toBe("North Carolina");
      expect(r.closingState).toBe("open");
    }
  });
});

describe("nc_bidnet — rows (captured)", () => {
  test("all 14 rows are accepted, with the aggregator honesty on every row", () => {
    const { rows, skipped } = parseNcBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(14);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^ncbidnet-\d+$/);
      expect(r.external_id.startsWith(`${NC_BIDNET_ID_PREFIX}-`)).toBe(true);
      expect(r.agency).toBe(NC_BIDNET_AGENCY);
      expect(r.location).toBe("North Carolina");
      expect(r.description).toContain("not the State of North Carolina's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.source_url.startsWith(`${NC_BIDNET_LIST_URL}/`)).toBe(true);
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: NC_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe("NC");
      expect(cols.source_jurisdiction).toBe("NC");
    }
    // 11/24/2026, date only → 11:59 PM Eastern (EST).
    expect(rows.find((r) => r.external_id === "ncbidnet-0000441005")!.due_date).toBe("2026-11-25T04:59:00.000Z");
  });
});

describe("nc_bidnet — fetch loop (stubbed from the fixture, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a one-page group is read with exactly one GET", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const { rows } = await fetchNcBidnetBids(CAPTURED);
    expect(asked).toEqual([NC_BIDNET_LIST_URL]);
    expect(rows.length).toBe(14);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchNcBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("nc_bidnet — registration", () => {
  test("tail source + the approved class map; eVP untouched", () => {
    expect(NC_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/north-carolina/solicitations/open-bids");
    expect(NC_BIDNET_AGENCY).toBe("North Carolina Purchasing Group (BidNet Direct)");
    expect(TAIL_SOURCES.some((s) => s.name === "nc_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.nc_bidnet).toEqual({
      class: "state",
      scopeState: "NC",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    expect(SOURCE_CLASSES.nc_evp!.scopeState).toBe("NC");
  });
});
