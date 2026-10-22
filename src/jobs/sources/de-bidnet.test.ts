/**
 * BidNet Direct — Delaware Purchasing Group (`de_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/de-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  DE_BIDNET_AGENCY,
  DE_BIDNET_LIST_URL,
  DE_BIDNET_MAX_PAGES,
  DE_BIDNET_SOURCE,
  fetchDeBidnetBids,
  deBidnetListShapeOk,
  deBidnetStatedOpenCount,
  parseDeBidnet,
  parseDeBidnetPageLinks,
  parseDeBidnetRows,
} from "./de-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/de-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz"), read("open-bids-page2-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseDeBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Delaware": "DE"};

describe("de_bidnet — captured list", () => {
  test("the capture is the Delaware group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(deBidnetListShapeOk(page)).toBe(true);
      expect(deBidnetStatedOpenCount(page)).toBe(73);
    }
    expect(parseDeBidnetPageLinks(PAGES[0]!).length).toBe(3);
    expect(DE_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseDeBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(50);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(LISTED[0]!.id).toBe("444204460844");
    expect(LISTED[0]!.title).toBe("ADAMS STREET PATHWAY PHASE II");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseDeBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^debidnet-\d+$/);
      expect(r.agency).toBe(DE_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Delaware's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: DE_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "debidnet-444204460844")!.due_date).toBe("2026-11-18T04:59:00.000Z");
  });
});

describe("de_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the selector to 2 pages and the heading to the captured rows, so the
  // loop reads exactly the captures.
  const trim = (html: string) =>
    html
      .replace(/(\/delaware\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/73 Open Solicitations/g, "50 Open Solicitations");
  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === DE_BIDNET_LIST_URL ? trim(PAGES[0]!) : url === `${DE_BIDNET_LIST_URL}/page2` ? trim(PAGES[1]!) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchDeBidnetBids(CAPTURED);
    expect(asked).toEqual([DE_BIDNET_LIST_URL, `${DE_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchDeBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("de_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(DE_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/delaware/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "de_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.de_bidnet).toEqual({
      class: "state",
      scopeState: "DE",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
