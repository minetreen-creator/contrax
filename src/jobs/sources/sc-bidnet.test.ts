/**
 * BidNet Direct — South Carolina Purchasing Group (`sc_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/sc-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import { TAIL_SOURCES } from "../runner";
import {
  SC_BIDNET_AGENCY,
  SC_BIDNET_LIST_URL,
  SC_BIDNET_MAX_PAGES,
  SC_BIDNET_SOURCE,
  fetchScBidnetBids,
  scBidnetListShapeOk,
  scBidnetStatedOpenCount,
  parseScBidnet,
  parseScBidnetPageLinks,
  parseScBidnetRows,
} from "./sc-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/sc-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz"), read("open-bids-page2-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseScBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"South Carolina": "SC"};

describe("sc_bidnet — captured list", () => {
  test("the capture is the South Carolina group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(scBidnetListShapeOk(page)).toBe(true);
      expect(scBidnetStatedOpenCount(page)).toBe(577);
    }
    expect(parseScBidnetPageLinks(PAGES[0]!).length).toBe(24);
    expect(SC_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseScBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(50);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(LISTED[0]!.id).toBe("444206065318");
    expect(LISTED[0]!.title).toBe("SCDOT STRATEGIC PLAN");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseScBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(49);
    expect(skipped).toEqual({"bad_date": 1});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^scbidnet-\d+$/);
      expect(r.agency).toBe(SC_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of South Carolina's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: SC_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "scbidnet-444206065318")!.due_date).toBe("2026-12-03T04:59:00.000Z");
  });
});

describe("sc_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the selector to 2 pages and the heading to the captured rows, so the
  // loop reads exactly the captures.
  const trim = (html: string) =>
    html
      .replace(/(\/south-carolina\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/577 Open Solicitations/g, "50 Open Solicitations");
  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === SC_BIDNET_LIST_URL ? trim(PAGES[0]!) : url === `${SC_BIDNET_LIST_URL}/page2` ? trim(PAGES[1]!) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchScBidnetBids(CAPTURED);
    expect(asked).toEqual([SC_BIDNET_LIST_URL, `${SC_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(49);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchScBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("sc_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(SC_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/south-carolina/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "sc_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.sc_bidnet).toEqual({
      class: "state",
      scopeState: "SC",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
