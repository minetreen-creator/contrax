/**
 * BidNet Direct — New Mexico Purchasing Group (`nm_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/nm-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  NM_BIDNET_AGENCY,
  NM_BIDNET_LIST_URL,
  NM_BIDNET_MAX_PAGES,
  NM_BIDNET_SOURCE,
  fetchNmBidnetBids,
  nmBidnetListShapeOk,
  nmBidnetStatedOpenCount,
  parseNmBidnet,
  parseNmBidnetPageLinks,
  parseNmBidnetRows,
} from "./nm-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/nm-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseNmBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"New Mexico": "NM"};

describe("nm_bidnet — captured list", () => {
  test("the capture is the New Mexico group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(nmBidnetListShapeOk(page)).toBe(true);
      expect(nmBidnetStatedOpenCount(page)).toBe(17);
    }
    expect(parseNmBidnetPageLinks(PAGES[0]!).length).toBe(0);
    expect(NM_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseNmBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(17);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(17);
    expect(LISTED[0]!.id).toBe("0000439997");
    expect(LISTED[0]!.title).toBe("Music Equipment and Installation");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseNmBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(17);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^nmbidnet-\d+$/);
      expect(r.agency).toBe(NM_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of New Mexico's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: NM_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "nmbidnet-0000439997")!.due_date).toBe("2026-10-28T03:59:00.000Z");
  });
});

describe("nm_bidnet — fetch loop (stubbed, zero network)", () => {
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
    const { rows } = await fetchNmBidnetBids(CAPTURED);
    expect(asked).toEqual([NM_BIDNET_LIST_URL]);
    expect(rows.length).toBe(17);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchNmBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("nm_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(NM_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/new-mexico/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "nm_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.nm_bidnet).toEqual({
      class: "state",
      scopeState: "NM",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
