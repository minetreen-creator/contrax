/**
 * BidNet Direct — Alabama Purchasing Group (`al_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/al-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  AL_BIDNET_AGENCY,
  AL_BIDNET_LIST_URL,
  AL_BIDNET_MAX_PAGES,
  AL_BIDNET_SOURCE,
  fetchAlBidnetBids,
  alBidnetListShapeOk,
  alBidnetStatedOpenCount,
  parseAlBidnet,
  parseAlBidnetPageLinks,
  parseAlBidnetRows,
} from "./al-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/al-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseAlBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Alabama": "AL"};

describe("al_bidnet — captured list", () => {
  test("the capture is the Alabama group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(alBidnetListShapeOk(page)).toBe(true);
      expect(alBidnetStatedOpenCount(page)).toBe(15);
    }
    expect(parseAlBidnetPageLinks(PAGES[0]!).length).toBe(0);
    expect(AL_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseAlBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(15);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(15);
    expect(LISTED[0]!.id).toBe("0000441216");
    expect(LISTED[0]!.title).toBe("Pine and Wheat Straw Bales");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseAlBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(15);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^albidnet-\d+$/);
      expect(r.agency).toBe(AL_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Alabama's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: AL_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "albidnet-0000441216")!.due_date).toBe("2026-11-11T04:59:00.000Z");
  });
});

describe("al_bidnet — fetch loop (stubbed, zero network)", () => {
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
    const { rows } = await fetchAlBidnetBids(CAPTURED);
    expect(asked).toEqual([AL_BIDNET_LIST_URL]);
    expect(rows.length).toBe(15);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchAlBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("al_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(AL_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/alabama/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "al_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.al_bidnet).toEqual({
      class: "state",
      scopeState: "AL",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
