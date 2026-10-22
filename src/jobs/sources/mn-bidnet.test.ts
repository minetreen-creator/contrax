/**
 * BidNet Direct — Minnesota Purchasing Group (`mn_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/mn-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  MN_BIDNET_AGENCY,
  MN_BIDNET_LIST_URL,
  MN_BIDNET_MAX_PAGES,
  MN_BIDNET_SOURCE,
  fetchMnBidnetBids,
  mnBidnetListShapeOk,
  mnBidnetStatedOpenCount,
  parseMnBidnet,
  parseMnBidnetPageLinks,
  parseMnBidnetRows,
} from "./mn-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/mn-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz"), read("open-bids-page2-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseMnBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Minnesota": "MN"};

describe("mn_bidnet — captured list", () => {
  test("the capture is the Minnesota group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(mnBidnetListShapeOk(page)).toBe(true);
      expect(mnBidnetStatedOpenCount(page)).toBe(355);
    }
    expect(parseMnBidnetPageLinks(PAGES[0]!).length).toBe(15);
    expect(MN_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseMnBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(50);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(LISTED[0]!.id).toBe("444206555045");
    expect(LISTED[0]!.title).toBe("DCT/Revenue Cycle Mgmnt Performance Consultant");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseMnBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^mnbidnet-\d+$/);
      expect(r.agency).toBe(MN_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Minnesota's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: MN_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "mnbidnet-444206555045")!.due_date).toBe("2026-11-18T04:59:00.000Z");
  });
});

describe("mn_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the selector to 2 pages and the heading to the captured rows, so the
  // loop reads exactly the captures.
  const trim = (html: string) =>
    html
      .replace(/(\/minnesota\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/355 Open Solicitations/g, "50 Open Solicitations");
  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === MN_BIDNET_LIST_URL ? trim(PAGES[0]!) : url === `${MN_BIDNET_LIST_URL}/page2` ? trim(PAGES[1]!) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchMnBidnetBids(CAPTURED);
    expect(asked).toEqual([MN_BIDNET_LIST_URL, `${MN_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchMnBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("mn_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(MN_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/minnesota/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "mn_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.mn_bidnet).toEqual({
      class: "state",
      scopeState: "MN",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
