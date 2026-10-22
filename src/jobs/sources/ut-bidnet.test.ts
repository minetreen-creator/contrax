/**
 * BidNet Direct — Utah Purchasing Group (`ut_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/ut-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  UT_BIDNET_AGENCY,
  UT_BIDNET_LIST_URL,
  UT_BIDNET_MAX_PAGES,
  UT_BIDNET_SOURCE,
  fetchUtBidnetBids,
  utBidnetListShapeOk,
  utBidnetStatedOpenCount,
  parseUtBidnet,
  parseUtBidnetPageLinks,
  parseUtBidnetRows,
} from "./ut-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/ut-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz"), read("open-bids-page2-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseUtBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Utah": "UT"};

describe("ut_bidnet — captured list", () => {
  test("the capture is the Utah group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(utBidnetListShapeOk(page)).toBe(true);
      expect(utBidnetStatedOpenCount(page)).toBe(294);
    }
    expect(parseUtBidnetPageLinks(PAGES[0]!).length).toBe(12);
    expect(UT_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseUtBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(50);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(LISTED[0]!.id).toBe("444206990089");
    expect(LISTED[0]!.title).toBe("2027 Sandy City Utility Projects");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseUtBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(49);
    expect(skipped).toEqual({"bad_date": 1});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^utbidnet-\d+$/);
      expect(r.agency).toBe(UT_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Utah's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: UT_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "utbidnet-444206990089")!.due_date).toBe("2026-11-19T04:59:00.000Z");
  });
});

describe("ut_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the selector to 2 pages and the heading to the captured rows, so the
  // loop reads exactly the captures.
  const trim = (html: string) =>
    html
      .replace(/(\/utah\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/294 Open Solicitations/g, "50 Open Solicitations");
  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === UT_BIDNET_LIST_URL ? trim(PAGES[0]!) : url === `${UT_BIDNET_LIST_URL}/page2` ? trim(PAGES[1]!) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchUtBidnetBids(CAPTURED);
    expect(asked).toEqual([UT_BIDNET_LIST_URL, `${UT_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(49);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchUtBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("ut_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(UT_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/utah/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "ut_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.ut_bidnet).toEqual({
      class: "state",
      scopeState: "UT",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
