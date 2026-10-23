/**
 * BidNet Direct — New Hampshire Purchasing Group (`nh_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold the verbatim public list pages
 * captured 2026-10-12 (gzipped; see fixtures/nh-bidnet/README.md for the URLs and
 * sha256s) and `now` is injected. The ONE fetch the fetch-loop test exercises is
 * stubbed from those same bytes.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

// The fetch-loop tests run the real reader, which waits BIDNET_PAGE_DELAY_MS
// (3 s, owner 2026-10-23) between pages.
setDefaultTimeout(30_000);
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import { TAIL_SOURCES } from "../runner";
import {
  NH_BIDNET_AGENCY,
  NH_BIDNET_LIST_URL,
  NH_BIDNET_ORIGIN,
  NH_BIDNET_SOURCE,
  fetchNhBidnetBids,
  parseNhBidnet,
  parseNhBidnetPageLinks,
  parseNhBidnetRows,
  nhBidnetAbsoluteUrl,
  nhBidnetDateKey,
  nhBidnetDetailId,
  nhBidnetDueMs,
  nhBidnetListShapeOk,
  nhBidnetStatedOpenCount,
  type NhBidnetRow,
} from "./nh-bidnet";

const read = (name: string): string =>
  gunzipSync(
    readFileSync(new URL(`./fixtures/nh-bidnet/${name}`, import.meta.url)),
  ).toString("utf8");

const PAGE1 = read("open-bids-2026-10-12.html.gz");
const PAGE2 = read("open-bids-page2-2026-10-12.html.gz");
const PAGE3 = read("open-bids-page3-2026-10-12.html.gz");
const PAGE4 = read("open-bids-page4-2026-10-12.html.gz");
const PAGES = [PAGE1, PAGE2, PAGE3, PAGE4];

/** Captured 2026-10-12T04:00Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-12T04:00:00Z");

const ROWS1 = parseNhBidnetRows(PAGE1);
const ROWS4 = parseNhBidnetRows(PAGE4);
const LISTED: NhBidnetRow[] = PAGES.flatMap((h) => parseNhBidnetRows(h));

describe("nh_bidnet — list pages (captured)", () => {
  test("the capture holds the whole New Hampshire group across four pages", () => {
    for (const page of PAGES) {
      expect(nhBidnetListShapeOk(page)).toBe(true);
      expect(nhBidnetStatedOpenCount(page)).toBe(91);
    }
    expect(PAGES.map((h) => parseNhBidnetRows(h).length)).toEqual([
      25, 25, 25, 16,
    ]);
    expect(LISTED.length).toBe(91);
    // The heading's own total and the rows agree: 91 = 25 + 25 + 25 + 16.
    expect(LISTED.length).toBe(nhBidnetStatedOpenCount(PAGE1)!);
    // No page repeats another and no solicitation is read twice.
    const ids = LISTED.map((r) => r.id);
    expect(new Set(ids).size).toBe(91);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
  });

  test("every row reads exactly as the page prints it", () => {
    const first = ROWS1[0]!;
    expect(first).toEqual({
      id: "444191619235",
      title: "Contract: Coffee and Tea",
      region: "New Hampshire",
      published: "10/09/2026",
      closing: "10/23/2026",
      closingState: "open",
      url: `${NH_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/444191619235/abstract?purchasingGroupId=845229551&origin=1`,
    });
    const last = ROWS4[ROWS4.length - 1]!;
    expect(last.id).toBe("443537846826");
    expect(last.title).toBe("Curbside Pickup");
    expect(last.published).toBe("06/05/2025");
    expect(last.closing).toBe("01/04/2027");
    // Every row of this group carries the same region cell and the open state.
    for (const r of LISTED) {
      expect(r.region).toBe("New Hampshire");
      expect(r.closingState).toBe("open");
      expect(r.published).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
  });

  test("the shape guard separates a reshape from honest-empty", () => {
    // A page that lost the solicitations table or its own heading is a reshape…
    expect(
      nhBidnetListShapeOk("<html><body>Service Unavailable</body></html>"),
    ).toBe(false);
    expect(
      nhBidnetListShapeOk(
        '<table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(false);
    expect(nhBidnetListShapeOk("<h1>0 Open Solicitations</h1>")).toBe(false);
    // …but the table plus a heading with zero solicitations is still the shape.
    expect(
      nhBidnetListShapeOk(
        '<h1>0 Open Solicitations</h1><table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(true);
    expect(nhBidnetStatedOpenCount(PAGE1.replace(/<[^>]+>/g, " "))).toBe(91);
    expect(nhBidnetStatedOpenCount("<html></html>")).toBeNull();
    expect(parseNhBidnetRows("<html></html>")).toEqual([]);
  });

  test("pagination is the page's OWN advertised GET links (no POST needed)", () => {
    // The selector on every page advertises the four pages of this list.
    for (const page of PAGES) {
      expect(parseNhBidnetPageLinks(page)).toEqual(
        [1, 2, 3, 4].map((n) => ({
          pageNumber: n,
          href: `${NH_BIDNET_LIST_URL}/page${n}`,
        })),
      );
    }
    expect(parseNhBidnetPageLinks(PAGE1)[1]!.href).toBe(
      "https://www.bidnetdirect.com/new-hampshire/solicitations/open-bids/page2",
    );
    expect(parseNhBidnetPageLinks("<html></html>")).toEqual([]);
  });
});

describe("nh_bidnet — rows (captured)", () => {
  test("90 open solicitations accepted, 1 honestly skipped for a missing deadline", () => {
    const { rows, skipped, skippedRows } = parseNhBidnet(LISTED, CAPTURED);
    // 91 listed = 90 accepted + 1 row the source prints NO closing date for.
    expect(LISTED.length).toBe(91);
    expect(rows.length).toBe(90);
    expect(skipped).toEqual({ bad_date: 1 });
    expect(skippedRows).toEqual([
      { id: "nhbidnet-444149119063", reason: "bad_date" },
    ]);
    // That row is the one whose closing cell literally reads "Not Available":
    // Contrax never invents the deadline it would need to store it.
    const noDeadline = LISTED.find((r) => r.id === "444149119063")!;
    expect(noDeadline.title).toBe(
      "Enterprise Investment Analytics and Portfolio Monitoring Platform",
    );
    expect(noDeadline.closing).toBe("Not Available");
    expect(noDeadline.closingState).toBe("open");
    for (const r of rows) {
      expect(r.external_id).toMatch(/^nhbidnet-\d+$/);
      expect(r.agency).toBe(NH_BIDNET_AGENCY);
      expect(r.location).toBe("New Hampshire");
      expect(r.notice_type).toBe("Open solicitation");
      expect(r.estimated_value).toBe("Not specified");
      // Every row cites the public per-solicitation page the list linked to.
      const u = new URL(r.source_url);
      expect(u.protocol).toBe("https:");
      expect(u.host).toBe("www.bidnetdirect.com");
      expect(u.pathname).toMatch(
        /^\/public\/supplier\/solicitations\/[a-z-]+\/\d+\/abstract$/,
      );
      expect(u.searchParams.get("purchasingGroupId")).toBeTruthy();
      // Fields BidNet shows only to registered members are NEVER claimed.
      expect(r.solicitation_number).toBeNull();
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.set_aside).toBeNull();
      expect(r.due_date).not.toBeNull();
      expect(Number.isNaN(Date.parse(r.due_date!))).toBe(false);
      // The aggregator honesty is on the row itself, not only in the header.
      expect(r.description).toContain("third-party");
      expect(r.description).toContain(
        "not the State of New Hampshire's procurement portal",
      );
      expect(r.description).toContain("registered members only");
      // The state guard resolves each row to NH from its own text.
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: NH_BIDNET_SOURCE,
      });
      expect(cols.source_jurisdiction).toBe("NH");
      expect(cols.normalized_state).toBe("NH");
    }
  });

  test("a row reads as the list prints it (dates, identity, category)", () => {
    const { rows } = parseNhBidnet(LISTED, CAPTURED);
    const r = rows.find((x) => x.external_id === "nhbidnet-444191619235")!;
    expect(r.title).toBe("Contract: Coffee and Tea");
    expect(r.location).toBe("New Hampshire");
    // Closing 10/23/2026 (EDT) — the list prints no time, so 11:59 PM Eastern.
    expect(r.due_date).toBe("2026-10-24T03:59:00.000Z");
    expect(r.source_url).toBe(
      `${NH_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/444191619235/abstract?purchasingGroupId=845229551&origin=1`,
    );
    expect(r.description).toContain(
      "Published 10/09/2026; closing 10/23/2026.",
    );
    expect(r.description).toContain("stores the deadline at 11:59 PM Eastern");
    // `category` is Contrax's own classification of the TITLE via the shared
    // classifier (the list publishes no category of its own) — and never of our
    // composed description, which must not be able to steer a row's trade.
    for (const row of rows)
      expect(row.category).toBe(mapCategory("", row.title, ""));
    expect(rows.some((x) => x.category === "Construction")).toBe(true);
    expect(rows.some((x) => x.category === "Transportation")).toBe(true);
  });

  test("the deadline is stored in the source's own Eastern time (DST aware)", () => {
    const { rows } = parseNhBidnet(LISTED, CAPTURED);
    // 10/23/2026 is inside DST → 11:59 PM EDT = 03:59Z next day.
    const oct = rows.filter((x) => x.due_date.startsWith("2026-10-24"));
    expect(oct.length).toBeGreaterThan(0);
    for (const r of oct) expect(r.due_date).toBe("2026-10-24T03:59:00.000Z");
    // 01/04/2027 is after DST ends → 11:59 PM EST = 04:59Z next day.
    const jan = rows.filter((x) => x.external_id === "nhbidnet-443537846826");
    expect(jan[0]!.due_date).toBe("2027-01-05T04:59:00.000Z");
  });

  test("a passed close date is never accepted; a repeat is skipped; empty is honest", () => {
    const late = parseNhBidnet(LISTED, Date.parse("2027-11-01T00:00:00Z"));
    expect(late.rows.length).toBe(0);
    // Every dated row is closed, and the dateless row is still unreadable.
    expect(late.skipped).toEqual({ closed: 90, bad_date: 1 });
    const twice = parseNhBidnet([...LISTED, ...LISTED], CAPTURED);
    expect(twice.rows.length).toBe(90);
    expect(twice.skipped).toEqual({ bad_date: 2, duplicate: 90 });
    // The same solicitation on two different pages is written once.
    expect(parseNhBidnet([ROWS1[0]!, ROWS1[0]!], CAPTURED).skipped).toEqual({
      duplicate: 1,
    });
    // Zero open solicitations (a quiet purchasing group) is 0 rows, not an error.
    expect(parseNhBidnet([], CAPTURED)).toEqual({
      rows: [],
      skipped: {},
      skippedRows: [],
    });
  });

  test("a row the page does not mark open is skipped, not accepted", () => {
    const notOpen = parseNhBidnet(
      [{ ...ROWS1[0]!, closingState: "closed" }],
      CAPTURED,
    );
    expect(notOpen.rows.length).toBe(0);
    expect(notOpen.skipped).toEqual({ not_open: 1 });
    const unreadable = parseNhBidnet(
      [{ ...ROWS1[0]!, closing: "soon" }],
      CAPTURED,
    );
    expect(unreadable.skipped).toEqual({ bad_date: 1 });
    const noId = parseNhBidnet([{ ...ROWS1[0]!, id: "" }], CAPTURED);
    expect(noId.skipped).toEqual({ missing_id: 1 });
    const noTitle = parseNhBidnet([{ ...ROWS1[0]!, title: "" }], CAPTURED);
    expect(noTitle.skipped).toEqual({ missing_title: 1 });
  });

  test("the same bytes parsed twice give the same rows (no churn on re-run)", () => {
    const print = (rows: NhBidnetRow[]) =>
      parseNhBidnet(rows, CAPTURED).rows.map((r) =>
        [r.external_id, r.title, r.due_date, r.source_url].join(" | "),
      );
    expect(print(LISTED)).toEqual(print(LISTED));
  });
});

describe("nh_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Serve the captured pages for the URLs the connector asks for. */
  function stub(): string[] {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const m = /\/page(\d)$/.exec(url);
      const body = m
        ? [PAGE1, PAGE2, PAGE3, PAGE4][Number(m[1]) - 1]
        : url === NH_BIDNET_LIST_URL
          ? PAGE1
          : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    return asked;
  }

  test("the list plus its own pagination is read, and yields the 90 accepted rows", async () => {
    const asked = stub();
    const { rows, skipped } = await fetchNhBidnetBids(CAPTURED);
    expect(rows.length).toBe(90);
    expect(skipped).toEqual({ bad_date: 1 });
    // Exactly four GETs: the list and the three pages it advertises after it.
    expect(asked).toEqual([
      NH_BIDNET_LIST_URL,
      `${NH_BIDNET_LIST_URL}/page2`,
      `${NH_BIDNET_LIST_URL}/page3`,
      `${NH_BIDNET_LIST_URL}/page4`,
    ]);
  });

  test("a page that lost its shape FAILS the fetch (fail-closed, never honest-empty)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body>Service Unavailable</body></html>", {
        status: 200,
      })) as typeof fetch;
    await expect(fetchNhBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
    // A non-200 is a failure too, never an empty read.
    globalThis.fetch = (async () =>
      new Response("nope", { status: 503 })) as typeof fetch;
    await expect(fetchNhBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
  });

  test("a heading that claims solicitations the rows did not deliver FAILS", async () => {
    // The table/heading survive, but every row lost its open state → the reader
    // must not report an empty purchasing group.
    globalThis.fetch = (async () =>
      new Response(
        PAGE1.replace(/sol-closing-date open/g, "sol-closing-date timedout"),
        {
          status: 200,
        },
      )) as typeof fetch;
    await expect(fetchNhBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
  });
});

describe("nh_bidnet — helpers", () => {
  test("detail ids, absolute URLs, date-only deadlines and date keys", () => {
    expect(
      nhBidnetDetailId(
        "/public/supplier/solicitations/statewide/444191619235/abstract?x=1",
      ),
    ).toBe("444191619235");
    expect(
      nhBidnetDetailId("/public/supplier/solicitations/other/abc/abstract"),
    ).toBeNull();
    expect(
      nhBidnetAbsoluteUrl("/new-hampshire/solicitations/open-bids/page2"),
    ).toBe(
      "https://www.bidnetdirect.com/new-hampshire/solicitations/open-bids/page2",
    );
    expect(nhBidnetDueMs("10/23/2026")).toBe(
      Date.parse("2026-10-24T03:59:00Z"),
    ); // EDT
    expect(nhBidnetDueMs("01/04/2027")).toBe(
      Date.parse("2027-01-05T04:59:00Z"),
    ); // EST
    expect(nhBidnetDueMs("Not Available")).toBeNaN();
    expect(nhBidnetDueMs("13/40/2026")).toBeNaN();
    expect(nhBidnetDateKey("10/23/2026")).toBe("2026-10-23");
    expect(nhBidnetDateKey("Not Available")).toBeNull();
  });

  test("registration (tail source + the approved class map)", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "nh_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.nh_bidnet).toEqual({
      class: "state",
      scopeState: "NH",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
