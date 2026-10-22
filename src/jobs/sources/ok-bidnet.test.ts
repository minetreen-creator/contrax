/**
 * BidNet Direct — Oklahoma Purchasing Group (`ok_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/ok-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  OK_BIDNET_AGENCY,
  OK_BIDNET_LIST_URL,
  OK_BIDNET_MAX_PAGES,
  OK_BIDNET_SOURCE,
  fetchOkBidnetBids,
  okBidnetListShapeOk,
  okBidnetStatedOpenCount,
  parseOkBidnet,
  parseOkBidnetPageLinks,
  parseOkBidnetRows,
} from "./ok-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/ok-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseOkBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Oklahoma": "OK"};

describe("ok_bidnet — captured list", () => {
  test("the capture is the Oklahoma group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(okBidnetListShapeOk(page)).toBe(true);
      expect(okBidnetStatedOpenCount(page)).toBe(22);
    }
    expect(parseOkBidnetPageLinks(PAGES[0]!).length).toBe(0);
    expect(OK_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseOkBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(22);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(22);
    expect(LISTED[0]!.id).toBe("0000440438");
    expect(LISTED[0]!.title).toBe("600 South 2nd Sinkhole Repair");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseOkBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(22);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^okbidnet-\d+$/);
      expect(r.agency).toBe(OK_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Oklahoma's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: OK_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "okbidnet-0000440438")!.due_date).toBe("2026-10-24T03:59:00.000Z");
  });
});

describe("ok_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  test("a one-page group is read with exactly one GET", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(PAGES[0]!, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchOkBidnetBids(CAPTURED);
    expect(asked).toEqual([OK_BIDNET_LIST_URL]);
    expect(rows.length).toBe(22);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchOkBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("ok_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(OK_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/oklahoma/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "ok_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.ok_bidnet).toEqual({
      class: "state",
      scopeState: "OK",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
