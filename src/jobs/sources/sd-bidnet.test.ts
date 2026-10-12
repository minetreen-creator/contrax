/**
 * BidNet Direct — South Dakota Purchasing Group (`sd_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold the verbatim public list pages
 * captured 2026-10-12 (gzipped; see fixtures/sd-bidnet/README.md for the URLs and
 * sha256s) and `now` is injected. The ONE fetch the fetch-loop test exercises is
 * stubbed from those same bytes.
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
  SD_BIDNET_AGENCY,
  SD_BIDNET_LIST_URL,
  SD_BIDNET_ORIGIN,
  SD_BIDNET_SOURCE,
  fetchSdBidnetBids,
  parseSdBidnet,
  parseSdBidnetPageLinks,
  parseSdBidnetRows,
  sdBidnetAbsoluteUrl,
  sdBidnetDateKey,
  sdBidnetDetailId,
  sdBidnetDueMs,
  sdBidnetListShapeOk,
  sdBidnetStatedOpenCount,
  type SdBidnetRow,
} from "./sd-bidnet";

const read = (name: string): string =>
  gunzipSync(
    readFileSync(new URL(`./fixtures/sd-bidnet/${name}`, import.meta.url)),
  ).toString("utf8");

const PAGE1 = read("open-bids-2026-10-12.html.gz");
const PAGE2 = read("open-bids-page2-2026-10-12.html.gz");

/** Captured 2026-10-12T03:21Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-12T03:21:00Z");

const ROWS1 = parseSdBidnetRows(PAGE1);
const ROWS2 = parseSdBidnetRows(PAGE2);
const LISTED: SdBidnetRow[] = [...ROWS1, ...ROWS2];

describe("sd_bidnet — list pages (captured)", () => {
  test("the capture holds the whole South Dakota group across two pages", () => {
    expect(sdBidnetListShapeOk(PAGE1)).toBe(true);
    expect(sdBidnetListShapeOk(PAGE2)).toBe(true);
    expect(sdBidnetStatedOpenCount(PAGE1)).toBe(44);
    expect(sdBidnetStatedOpenCount(PAGE2)).toBe(44);
    expect(ROWS1.length).toBe(25);
    expect(ROWS2.length).toBe(19);
    expect(LISTED.length).toBe(44);
    // The heading's own total, the page-size claim and the rows agree.
    expect(LISTED.length).toBe(sdBidnetStatedOpenCount(PAGE1)!);
    // Page 2 is not a repeat of page 1 and no solicitation is read twice.
    const ids = LISTED.map((r) => r.id);
    expect(new Set(ids).size).toBe(44);
    expect(new Set(ROWS1.map((r) => r.id)).size).toBe(25);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
  });

  test("every row reads exactly as the page prints it", () => {
    const first = ROWS1[0]!;
    expect(first).toEqual({
      id: "2719424597",
      title:
        "Sources Sought: IEE Capability for FFP Non-Personal Healthcare Services \u2013 Up to Two (2) OB/GYN Physician Full-Time Equivalent Positions, Pine Ridge Service Unit, Pine Ridge IHS Hospital, Pine Ridge, SD",
      region: "South Dakota",
      published: "10/09/2026",
      closing: "10/26/2026",
      closingState: "open",
      url: `${SD_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/2719424597/abstract?purchasingGroupId=845232051&origin=1`,
    });
    const last = ROWS2[ROWS2.length - 1]!;
    expect(last.id).toBe("444098431892");
    expect(last.title).toBe("Dining Service Operations for SDBOR Institutions");
    expect(last.published).toBe("07/16/2026");
    expect(last.closing).toBe("10/16/2026");
    // Every row of this group carries the same region cell and the open state.
    for (const r of LISTED) {
      expect(r.region).toBe("South Dakota");
      expect(r.closingState).toBe("open");
      expect(r.published).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(r.closing).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
  });

  test("the shape guard separates a reshape from honest-empty", () => {
    // A page that lost the solicitations table or its own heading is a reshape…
    expect(
      sdBidnetListShapeOk("<html><body>Service Unavailable</body></html>"),
    ).toBe(false);
    expect(
      sdBidnetListShapeOk(
        '<table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(false);
    expect(sdBidnetListShapeOk("<h1>0 Open Solicitations</h1>")).toBe(false);
    // …but the table plus a heading with zero solicitations is still the shape.
    expect(
      sdBidnetListShapeOk(
        '<h1>0 Open Solicitations</h1><table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(true);
    expect(sdBidnetStatedOpenCount(PAGE1.replace(/<[^>]+>/g, " "))).toBe(44);
    expect(sdBidnetStatedOpenCount("<html></html>")).toBeNull();
    expect(parseSdBidnetRows("<html></html>")).toEqual([]);
  });

  test("pagination is the page's OWN advertised GET links (no POST needed)", () => {
    // The selector on both pages advertises the two pages of this list.
    for (const page of [PAGE1, PAGE2]) {
      expect(parseSdBidnetPageLinks(page)).toEqual([
        { pageNumber: 1, href: `${SD_BIDNET_LIST_URL}/page1` },
        { pageNumber: 2, href: `${SD_BIDNET_LIST_URL}/page2` },
      ]);
    }
    // The fixture's page-2 URL really is the one the capture came from.
    expect(parseSdBidnetPageLinks(PAGE1)[1]!.href).toBe(
      "https://www.bidnetdirect.com/south-dakota/solicitations/open-bids/page2",
    );
    expect(parseSdBidnetPageLinks("<html></html>")).toEqual([]);
  });
});

describe("sd_bidnet — rows (captured)", () => {
  test("44 open solicitations, all accepted, none invented", () => {
    const { rows, skipped, skippedRows } = parseSdBidnet(LISTED, CAPTURED);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    expect(rows.length).toBe(44);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^sdbidnet-\d+$/);
      expect(r.agency).toBe(SD_BIDNET_AGENCY);
      expect(r.location).toBe("South Dakota");
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
        "not the State of South Dakota's procurement portal",
      );
      expect(r.description).toContain("registered members only");
      // The state guard resolves each row to SD from its own text.
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: SD_BIDNET_SOURCE,
      });
      expect(cols.source_jurisdiction).toBe("SD");
      expect(cols.normalized_state).toBe("SD");
    }
  });

  test("a row reads as the list prints it (dates, identity, category)", () => {
    const { rows } = parseSdBidnet(LISTED, CAPTURED);
    const r = rows.find((x) => x.external_id === "sdbidnet-444188363535")!;
    expect(r.title).toBe("Coyote Village Environmental Services FY27");
    expect(r.location).toBe("South Dakota");
    // Closing 11/10/2026 (EDT) — the list prints no time, so 11:59 PM Eastern.
    expect(r.due_date).toBe("2026-11-11T04:59:00.000Z");
    expect(r.source_url).toBe(
      `${SD_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/444188363535/abstract?purchasingGroupId=845232051&origin=1`,
    );
    expect(r.description).toContain(
      "Published 10/08/2026; closing 11/10/2026.",
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
    const { rows } = parseSdBidnet(LISTED, CAPTURED);
    // 10/26/2026 is inside DST → 11:59 PM EDT = 03:59Z next day.
    expect(
      rows.find((x) => x.external_id === "sdbidnet-2719424597")!.due_date,
    ).toBe("2026-10-27T03:59:00.000Z");
    // 11/30/2026 is after DST ends → 11:59 PM EST = 04:59Z next day.
    const late = rows.filter((x) => x.due_date.startsWith("2026-12-01"));
    expect(late.length).toBe(3);
    for (const r of late) expect(r.due_date).toBe("2026-12-01T04:59:00.000Z");
  });

  test("a passed close date is never accepted; a repeat is skipped; empty is honest", () => {
    const late = parseSdBidnet(LISTED, Date.parse("2027-11-01T00:00:00Z"));
    expect(late.rows.length).toBe(0);
    expect(late.skipped).toEqual({ closed: 44 });
    const twice = parseSdBidnet([...LISTED, ...LISTED], CAPTURED);
    expect(twice.rows.length).toBe(44);
    expect(twice.skipped).toEqual({ duplicate: 44 });
    // The same solicitation on two different pages is written once.
    expect(parseSdBidnet([ROWS1[0]!, ROWS1[0]!], CAPTURED).skipped).toEqual({
      duplicate: 1,
    });
    // Zero open solicitations (a quiet purchasing group) is 0 rows, not an error.
    expect(parseSdBidnet([], CAPTURED)).toEqual({
      rows: [],
      skipped: {},
      skippedRows: [],
    });
  });

  test("a row the page does not mark open is skipped, not accepted", () => {
    const notOpen = parseSdBidnet(
      [{ ...ROWS1[0]!, closingState: "closed" }],
      CAPTURED,
    );
    expect(notOpen.rows.length).toBe(0);
    expect(notOpen.skipped).toEqual({ not_open: 1 });
    const unreadable = parseSdBidnet(
      [{ ...ROWS1[0]!, closing: "soon" }],
      CAPTURED,
    );
    expect(unreadable.skipped).toEqual({ bad_date: 1 });
    const noId = parseSdBidnet([{ ...ROWS1[0]!, id: "" }], CAPTURED);
    expect(noId.skipped).toEqual({ missing_id: 1 });
    const noTitle = parseSdBidnet([{ ...ROWS1[0]!, title: "" }], CAPTURED);
    expect(noTitle.skipped).toEqual({ missing_title: 1 });
  });

  test("the same bytes parsed twice give the same rows (no churn on re-run)", () => {
    const print = (rows: SdBidnetRow[]) =>
      parseSdBidnet(rows, CAPTURED).rows.map((r) =>
        [r.external_id, r.title, r.due_date, r.source_url].join(" | "),
      );
    expect(print(LISTED)).toEqual(print(LISTED));
  });
});

describe("sd_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
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
      const body = url.endsWith("/page2")
        ? PAGE2
        : url === SD_BIDNET_LIST_URL
          ? PAGE1
          : null;
      if (body === null) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    return asked;
  }

  test("the list plus its own pagination is read, and yields the 44 open rows", async () => {
    const asked = stub();
    const { rows, skipped } = await fetchSdBidnetBids(CAPTURED);
    expect(rows.length).toBe(44);
    expect(skipped).toEqual({});
    // Exactly two GETs: the list and the one page it advertises after it.
    expect(asked).toEqual([SD_BIDNET_LIST_URL, `${SD_BIDNET_LIST_URL}/page2`]);
  });

  test("a page that lost its shape FAILS the fetch (fail-closed, never honest-empty)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body>Service Unavailable</body></html>", {
        status: 200,
      })) as typeof fetch;
    await expect(fetchSdBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
    // A non-200 is a failure too, never an empty read.
    globalThis.fetch = (async () =>
      new Response("nope", { status: 503 })) as typeof fetch;
    await expect(fetchSdBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
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
    await expect(fetchSdBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
  });
});

describe("sd_bidnet — helpers", () => {
  test("detail ids, absolute URLs, date-only deadlines and date keys", () => {
    expect(
      sdBidnetDetailId(
        "/public/supplier/solicitations/statewide/2719424597/abstract?x=1",
      ),
    ).toBe("2719424597");
    expect(
      sdBidnetDetailId("/public/supplier/solicitations/other/abc/abstract"),
    ).toBeNull();
    expect(
      sdBidnetAbsoluteUrl("/south-dakota/solicitations/open-bids/page2"),
    ).toBe(
      "https://www.bidnetdirect.com/south-dakota/solicitations/open-bids/page2",
    );
    expect(sdBidnetDueMs("10/26/2026")).toBe(
      Date.parse("2026-10-27T03:59:00Z"),
    ); // EDT
    expect(sdBidnetDueMs("11/30/2026")).toBe(
      Date.parse("2026-12-01T04:59:00Z"),
    ); // EST
    expect(sdBidnetDueMs("03/08/2026")).toBe(
      Date.parse("2026-03-09T03:59:00Z"),
    ); // DST starts 03/08
    expect(sdBidnetDueMs("03/07/2026")).toBe(
      Date.parse("2026-03-08T04:59:00Z"),
    ); // still EST
    expect(sdBidnetDueMs("13/40/2026")).toBeNaN();
    expect(sdBidnetDueMs("soon")).toBeNaN();
    expect(sdBidnetDateKey("10/26/2026")).toBe("2026-10-26");
    expect(sdBidnetDateKey("soon")).toBeNull();
  });

  test("registration (tail source + the approved class map)", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "sd_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.sd_bidnet).toEqual({
      class: "state",
      scopeState: "SD",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
