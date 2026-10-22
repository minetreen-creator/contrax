/**
 * BidNet Direct — Kansas Purchasing Group (`ks_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/ks-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  KS_BIDNET_AGENCY,
  KS_BIDNET_LIST_URL,
  KS_BIDNET_MAX_PAGES,
  KS_BIDNET_SOURCE,
  fetchKsBidnetBids,
  ksBidnetListShapeOk,
  ksBidnetStatedOpenCount,
  parseKsBidnet,
  parseKsBidnetPageLinks,
  parseKsBidnetRows,
} from "./ks-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/ks-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz"), read("open-bids-page2-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseKsBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Kansas": "KS"};

describe("ks_bidnet — captured list", () => {
  test("the capture is the Kansas group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(ksBidnetListShapeOk(page)).toBe(true);
      expect(ksBidnetStatedOpenCount(page)).toBe(160);
    }
    expect(parseKsBidnetPageLinks(PAGES[0]!).length).toBe(7);
    expect(KS_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseKsBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(50);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(LISTED[0]!.id).toBe("444206533344");
    expect(LISTED[0]!.title).toBe("Shade Structure Installation Project");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseKsBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^ksbidnet-\d+$/);
      expect(r.agency).toBe(KS_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Kansas's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: KS_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "ksbidnet-444206533344")!.due_date).toBe("2026-11-19T04:59:00.000Z");
  });
});

describe("ks_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the selector to 2 pages and the heading to the captured rows, so the
  // loop reads exactly the captures.
  const trim = (html: string) =>
    html
      .replace(/(\/kansas\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/160 Open Solicitations/g, "50 Open Solicitations");
  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === KS_BIDNET_LIST_URL ? trim(PAGES[0]!) : url === `${KS_BIDNET_LIST_URL}/page2` ? trim(PAGES[1]!) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchKsBidnetBids(CAPTURED);
    expect(asked).toEqual([KS_BIDNET_LIST_URL, `${KS_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchKsBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("ks_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(KS_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/kansas/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "ks_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.ks_bidnet).toEqual({
      class: "state",
      scopeState: "KS",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
