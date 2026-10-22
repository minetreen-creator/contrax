/**
 * BidNet Direct — Colorado Purchasing Group (`co_bidnet`) connector pins. Zero network, no
 * database: verbatim public list page(s) captured 2026-10-22 (see
 * fixtures/co-bidnet/README.md), `now` injected, `fetch` stubbed from the same bytes.
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
  CO_BIDNET_AGENCY,
  CO_BIDNET_LIST_URL,
  CO_BIDNET_MAX_PAGES,
  CO_BIDNET_SOURCE,
  fetchCoBidnetBids,
  coBidnetListShapeOk,
  coBidnetStatedOpenCount,
  parseCoBidnet,
  parseCoBidnetPageLinks,
  parseCoBidnetRows,
} from "./co-bidnet";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/co-bidnet/${name}`, import.meta.url))).toString("utf8");
const PAGES = [read("open-bids-2026-10-22.html.gz"), read("open-bids-page2-2026-10-22.html.gz")];
const LISTED = PAGES.flatMap((h) => parseCoBidnetRows(h));
/** Captured 2026-10-22T22:30Z. */
const CAPTURED = Date.parse("2026-10-22T22:30:00Z");
/** Each row keeps its own region; this group's captured rows read these. */
const STATE_OF: Record<string, string> = {"Colorado": "CO", "Wyoming": "WY"};

describe("co_bidnet — captured list", () => {
  test("the capture is the Colorado group: shape, heading total, pagination, rows", () => {
    for (const page of PAGES) {
      expect(coBidnetListShapeOk(page)).toBe(true);
      expect(coBidnetStatedOpenCount(page)).toBe(397);
    }
    expect(parseCoBidnetPageLinks(PAGES[0]!).length).toBe(16);
    expect(CO_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(parseCoBidnetPageLinks(PAGES[0]!).length);
    expect(LISTED.length).toBe(50);
    expect(new Set(LISTED.map((r) => r.id)).size).toBe(50);
    expect(LISTED[0]!.id).toBe("0000436598");
    expect(LISTED[0]!.title).toBe("Mariposa Park");
    for (const r of LISTED) {
      expect(r.id).toMatch(/^\d+$/);
      expect(Object.keys(STATE_OF)).toContain(r.region);
      expect(r.closingState).toBe("open");
    }
  });

  test("rows are accepted with the aggregator honesty and their own state", () => {
    const { rows, skipped } = parseCoBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^cobidnet-\d+$/);
      expect(r.agency).toBe(CO_BIDNET_AGENCY);
      expect(r.description).toContain("not the State of Colorado's procurement portal");
      expect(r.solicitation_number).toBeNull();
      expect(r.category).toBe(mapCategory("", r.title, ""));
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: CO_BIDNET_SOURCE,
      });
      expect(cols.normalized_state).toBe(STATE_OF[r.location]!);
    }
    expect(rows.find((r) => r.external_id === "cobidnet-0000436598")!.due_date).toBe("2026-12-19T04:59:00.000Z");
  });
});

describe("co_bidnet — fetch loop (stubbed, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Trim the selector to 2 pages and the heading to the captured rows, so the
  // loop reads exactly the captures.
  const trim = (html: string) =>
    html
      .replace(/(\/colorado\/solicitations\/open-bids\/page)(\d+)/g, (m, p, n) => (Number(n) <= 2 ? m : `${p}2`))
      .replace(/397 Open Solicitations/g, "50 Open Solicitations");
  test("the list and its advertised pages are read once each", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url === CO_BIDNET_LIST_URL ? trim(PAGES[0]!) : url === `${CO_BIDNET_LIST_URL}/page2` ? trim(PAGES[1]!) : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const { rows } = await fetchCoBidnetBids(CAPTURED);
    expect(asked).toEqual([CO_BIDNET_LIST_URL, `${CO_BIDNET_LIST_URL}/page2`]);
    expect(rows.length).toBe(50);
  });

  test("the bot wall's 202 challenge FAILS the pass (never an empty group)", async () => {
    globalThis.fetch = (async () => new Response("<html></html>", { status: 202 })) as typeof fetch;
    await expect(fetchCoBidnetBids(CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("co_bidnet — registration", () => {
  test("tail source + the approved class map", () => {
    expect(CO_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/colorado/solicitations/open-bids");
    expect(TAIL_SOURCES.some((s) => s.name === "co_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.co_bidnet).toEqual({
      class: "state",
      scopeState: "CO",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
