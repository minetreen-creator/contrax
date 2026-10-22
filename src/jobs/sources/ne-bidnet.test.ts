/**
 * BidNet Direct — Nebraska Purchasing Group (`ne_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/ne-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  NE_BIDNET_AGENCY,
  NE_BIDNET_LIST_URL,
  NE_BIDNET_MAX_PAGES,
  NE_BIDNET_SOURCE,
  fetchNeBidnetBids,
  neBidnetListShapeOk,
  neBidnetStatedOpenCount,
  parseNeBidnet,
  parseNeBidnetPageLinks,
  parseNeBidnetRows,
} from "./ne-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/ne-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz"), read("open-bids-page2-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseNeBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Nebraska": "NE"};

describe("ne_bidnet — captured list", () => {
  test("the capture is the Nebraska group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(neBidnetListShapeOk(page)).toBe(true);
      expect(neBidnetStatedOpenCount(page)).toBe(106);
    }
    expect(parseNeBidnetPageLinks(PAGES[0]!).length).toBe(5);
    expect(NE_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseNeBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(50);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(LISTED[0]!.id).toBe("444206630390");
    expect(LISTED[0]!.title).toBe("Canopy Yard Cottonwood Commons Prequalified Caterers");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseNeBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^nebidnet-\d+$/);
      expect(r.agency).toBe(NE_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Nebraska's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: NE_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "nebidnet-444206630390")!.due_date).toBe("2026-11-21T04:59:00.000Z");
  });
});

describe("ne_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the selector to 2 pages and the heading to the captured rows, so the
  // loop reads exactly the captures.
  const trim = (html: string) =>
    html
      .replace(/(\/nebraska\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/106 Open Solicitations/g, "50 Open Solicitations");
  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === NE_BIDNET_LIST_URL ? trim(PAGES[0]!) : url === `${NE_BIDNET_LIST_URL}/page2` ? trim(PAGES[1]!) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchNeBidnetBids(CAPTURED);
    expect(asked).toEqual([NE_BIDNET_LIST_URL, `${NE_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchNeBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("ne_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(NE_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/nebraska/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "ne_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.ne_bidnet).toEqual({
      class: "state",
      scopeState: "NE",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
