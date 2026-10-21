/**
 * BidNet Direct — Virginia & DC Purchasing Group (`va_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold verbatim public list pages
 * captured 2026-10-21 (gzipped; see fixtures/va-bidnet/README.md for the URLs and
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
import { createBidNetGroup } from "./bidnet-direct";
import {
  VA_BIDNET_AGENCY,
  VA_BIDNET_ID_PREFIX,
  VA_BIDNET_LIST_URL,
  VA_BIDNET_MAX_PAGES,
  VA_BIDNET_ORIGIN,
  VA_BIDNET_SOURCE,
  fetchVaBidnetBids,
  parseVaBidnet,
  parseVaBidnetPageLinks,
  parseVaBidnetRows,
  vaBidnetAbsoluteUrl,
  vaBidnetDateKey,
  vaBidnetDetailId,
  vaBidnetDueMs,
  vaBidnetListShapeOk,
  vaBidnetStatedOpenCount,
  type VaBidnetRow,
} from "./va-bidnet";

const read = (name: string): string =>
  gunzipSync(
    readFileSync(new URL(`./fixtures/va-bidnet/${name}`, import.meta.url)),
  ).toString("utf8");

const PAGE1 = read("open-bids-2026-10-21.html.gz");
const PAGE9 = read("open-bids-page9-2026-10-21.html.gz");
const PAGES = [PAGE1, PAGE9];

/** Captured 2026-10-21T21:00Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-21T21:00:00Z");

const ROWS1 = parseVaBidnetRows(PAGE1);
const ROWS9 = parseVaBidnetRows(PAGE9);
const LISTED: VaBidnetRow[] = PAGES.flatMap((h) => parseVaBidnetRows(h));

describe("va_bidnet — list pages (captured)", () => {
  test("the capture is the Virginia & DC group, and the heading's comma total is read whole", () => {
    for (const page of PAGES) expect(vaBidnetListShapeOk(page)).toBe(true);
    // The results header reads "1,176 Open Solicitations" — thousands-comma form.
    // Read as 176 it would under-count by an order of magnitude, so the shared
    // helper must take the comma form as one number (pinned here, and unchanged
    // for the SD/NH groups whose totals print no comma).
    for (const page of PAGES) expect(vaBidnetStatedOpenCount(page)).toBe(1176);
    expect(
      vaBidnetStatedOpenCount('<span class="simpleResultsNumResults"> 44 Open Solicitations</span>'),
    ).toBe(44);
    expect(vaBidnetStatedOpenCount("<html></html>")).toBeNull();
  });

  test("page 1 and page 9 are disjoint 25-row pages of the same list", () => {
    expect(ROWS1.length).toBe(25);
    expect(ROWS9.length).toBe(25);
    expect(LISTED.length).toBe(50);
    const ids = LISTED.map((r) => r.id);
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
    // `data-index` restarts at 0 on every page, so identity can never be positional.
    expect(parseVaBidnetRows(PAGE1)[0]!.id).toBe("444205866429");
    expect(parseVaBidnetRows(PAGE9)[0]!.id).toBe("2720185007");
  });

  test("every row reads exactly as the page prints it, region per row", () => {
    const first = ROWS1[0]!;
    expect(first).toEqual({
      id: "444205866429",
      title: "DEICER/ICE MELT 50 LB BAG",
      region: "Virginia",
      published: "10/21/2026",
      closing: "11/30/2026",
      closingState: "open",
      url: `${VA_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/444205866429/abstract?purchasingGroupId=182878751&origin=1`,
    });
    // This group is NOT single-region: Virginia rows and District of Columbia rows
    // share one list, and each row keeps its own region text.
    const regions1 = ROWS1.map((r) => r.region);
    expect(regions1.filter((r) => r === "District of Columbia").length).toBe(2);
    expect(regions1.filter((r) => r === "Virginia").length).toBe(23);
    const regions9 = ROWS9.map((r) => r.region);
    expect(regions9.filter((r) => r === "District of Columbia").length).toBe(3);
    for (const r of LISTED) {
      expect(["Virginia", "District of Columbia"]).toContain(r.region);
      expect(r.closingState).toBe("open");
      expect(r.published).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(r.closing).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
    const dcRow = LISTED.find((r) => r.id === "444205418944")!;
    expect(dcRow.region).toBe("District of Columbia");
    expect(dcRow.title).toBe(
      "Terrazzo Flooring Diamond Polishing, Restoration, and Maintenance Services, DCA",
    );
    expect(dcRow.closing).toBe("11/09/2026");
  });

  test("the shape guard separates a reshape from honest-empty", () => {
    expect(
      vaBidnetListShapeOk("<html><body>Service Unavailable</body></html>"),
    ).toBe(false);
    expect(
      vaBidnetListShapeOk(
        '<table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(false);
    expect(vaBidnetListShapeOk("<h1>0 Open Solicitations</h1>")).toBe(false);
    // …but the table plus a heading with zero solicitations is still the shape.
    expect(
      vaBidnetListShapeOk(
        '<h1>0 Open Solicitations</h1><table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(true);
    expect(parseVaBidnetRows("<html></html>")).toEqual([]);
  });

  test("pagination is the page's OWN advertised GET links — 48 pages, far past the engine default", () => {
    const links = parseVaBidnetPageLinks(PAGE1);
    expect(links.length).toBe(48);
    expect(links.map((l) => l.pageNumber)).toEqual(
      Array.from({ length: 48 }, (_, i) => i + 1),
    );
    for (const l of links)
      expect(l.href).toBe(`${VA_BIDNET_LIST_URL}/page${l.pageNumber}`);
    expect(parseVaBidnetPageLinks(PAGE9)).toEqual(links);
    expect(parseVaBidnetPageLinks("<html></html>")).toEqual([]);
    // The engine's default cap (20) would truncate this group to its first 500
    // rows, which is why this config raises it: the cap must cover the 48 pages
    // the group advertises today, with headroom for growth.
    expect(VA_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(links.length);
    expect(VA_BIDNET_MAX_PAGES).toBeGreaterThan(20);
  });
});

describe("va_bidnet — rows (captured)", () => {
  test("all 50 captured rows are accepted, with the aggregator honesty on every row", () => {
    const { rows, skipped, skippedRows } = parseVaBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^vabidnet-\d+$/);
      expect(r.external_id.startsWith(`${VA_BIDNET_ID_PREFIX}-`)).toBe(true);
      expect(r.agency).toBe(VA_BIDNET_AGENCY);
      // The row's own region text, never the group's name and never the state scope.
      expect(["Virginia", "District of Columbia"]).toContain(r.location!);
      expect(r.notice_type).toBe("Open solicitation");
      expect(r.estimated_value).toBe("Not specified");
      // Every row cites the public per-solicitation page the list linked to.
      const u = new URL(r.source_url);
      expect(u.protocol).toBe("https:");
      expect(u.host).toBe("www.bidnetdirect.com");
      expect(u.pathname).toMatch(
        /^\/public\/supplier\/solicitations\/[a-z-]+\/\d+\/abstract$/,
      );
      expect(u.searchParams.get("purchasingGroupId")).toBe("182878751");
      // Fields BidNet shows only to registered members are NEVER claimed.
      expect(r.solicitation_number).toBeNull();
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.set_aside).toBeNull();
      expect(r.due_date).not.toBeNull();
      expect(Number.isNaN(Date.parse(r.due_date!))).toBe(false);
      // The aggregator honesty travels on the row itself, not only in the header,
      // and it names Virginia's own portal as the thing BidNet is not.
      expect(r.description).toContain("third-party");
      expect(r.description).toContain(
        "not the State of Virginia's procurement portal",
      );
      expect(r.description).toContain("registered members only");
      expect(r.description).toContain("Virginia & DC Purchasing Group");
    }
  });

  test("a DC-located row stays DC; a Virginia row stays Virginia (per-row geography)", () => {
    const { rows } = parseVaBidnet(LISTED, CAPTURED);
    const cols = (r: (typeof rows)[number]) =>
      deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: VA_BIDNET_SOURCE,
      });
    const dc = rows.filter((r) => r.location === "District of Columbia");
    const va = rows.filter((r) => r.location === "Virginia");
    expect(dc.length).toBe(5); // 2 on page 1 + 3 on page 9
    expect(va.length).toBe(45);
    for (const r of dc) {
      expect(cols(r).raw_location).toBe("District of Columbia");
      expect(cols(r).normalized_state).toBe("DC");
      expect(cols(r).source_jurisdiction).toBe("DC");
    }
    for (const r of va) {
      expect(cols(r).normalized_state).toBe("VA");
      expect(cols(r).source_jurisdiction).toBe("VA");
    }
  });

  test("a row reads as the list prints it (dates, identity, category)", () => {
    const { rows } = parseVaBidnet(LISTED, CAPTURED);
    const r = rows.find((x) => x.external_id === "vabidnet-444205866429")!;
    expect(r.title).toBe("DEICER/ICE MELT 50 LB BAG");
    expect(r.location).toBe("Virginia");
    // Closing 11/30/2026 — after DST ends, so 11:59 PM EST = 04:59Z next day.
    expect(r.due_date).toBe("2026-12-01T04:59:00.000Z");
    expect(r.source_url).toBe(
      `${VA_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/444205866429/abstract?purchasingGroupId=182878751&origin=1`,
    );
    expect(r.description).toContain("Published 10/21/2026; closing 11/30/2026.");
    expect(r.description).toContain("stores the deadline at 11:59 PM Eastern");
    // `category` is Contrax's own classification of the TITLE via the shared
    // classifier (the list publishes no category of its own) — never of our
    // composed description, which must not be able to steer a row's trade.
    for (const row of rows) expect(row.category).toBe(mapCategory("", row.title, ""));
  });

  test("the deadline is stored in the source's own Eastern time (DST aware)", () => {
    const { rows } = parseVaBidnet(LISTED, CAPTURED);
    // 10/26/2026 is still inside DST → 11:59 PM EDT = 03:59Z next day.
    expect(vaBidnetDueMs("10/26/2026")).toBe(Date.parse("2026-10-27T03:59:00Z"));
    // 11/09/2026 (the DC terrazzo row) is after DST ends → EST = 04:59Z next day.
    expect(vaBidnetDueMs("11/09/2026")).toBe(Date.parse("2026-11-10T04:59:00Z"));
    const dc = rows.find((x) => x.external_id === "vabidnet-444205418944")!;
    expect(dc.due_date).toBe("2026-11-10T04:59:00.000Z");
    // Every stored deadline is the row's own closing date at 11:59 PM Eastern:
    // the clock reads 03:59Z (EDT) or 04:59Z (EST) on the day after the date.
    for (const listed of LISTED) {
      const stored = rows.find((x) => x.external_id === `vabidnet-${listed.id}`)!;
      expect(stored.due_date).toBe(
        new Date(vaBidnetDueMs(listed.closing)).toISOString(),
      );
      expect(["03:59", "04:59"]).toContain(stored.due_date!.slice(11, 16));
    }
  });

  test("a passed close date is never accepted; a repeat is skipped; empty is honest", () => {
    const late = parseVaBidnet(LISTED, Date.parse("2027-11-01T00:00:00Z"));
    expect(late.rows.length).toBe(0);
    expect(late.skipped).toEqual({ closed: 50 });
    const twice = parseVaBidnet([...LISTED, ...LISTED], CAPTURED);
    expect(twice.rows.length).toBe(50);
    expect(twice.skipped).toEqual({ duplicate: 50 });
    expect(parseVaBidnet([ROWS1[0]!, ROWS1[0]!], CAPTURED).skipped).toEqual({
      duplicate: 1,
    });
    // Zero open solicitations (a quiet purchasing group) is 0 rows, not an error.
    expect(parseVaBidnet([], CAPTURED)).toEqual({
      rows: [],
      skipped: {},
      skippedRows: [],
    });
  });

  test("a row the page does not mark open is skipped, not accepted", () => {
    expect(
      parseVaBidnet([{ ...ROWS1[0]!, closingState: "closed" }], CAPTURED).skipped,
    ).toEqual({ not_open: 1 });
    expect(
      parseVaBidnet([{ ...ROWS1[0]!, closing: "Not Available" }], CAPTURED)
        .skipped,
    ).toEqual({ bad_date: 1 });
    expect(parseVaBidnet([{ ...ROWS1[0]!, id: "" }], CAPTURED).skipped).toEqual({
      missing_id: 1,
    });
    expect(
      parseVaBidnet([{ ...ROWS1[0]!, title: "" }], CAPTURED).skipped,
    ).toEqual({ missing_title: 1 });
  });

  test("the same bytes parsed twice give the same rows (no churn on re-run)", () => {
    const print = (rows: VaBidnetRow[]) =>
      parseVaBidnet(rows, CAPTURED).rows.map((r) =>
        [r.external_id, r.title, r.due_date, r.location, r.source_url].join(" | "),
      );
    expect(print(LISTED)).toEqual(print(LISTED));
  });
});

describe("va_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * The real page 1 advertises 48 pages; serving all 48 here would cost 47 × the
   * engine's politeness delay, and the cap itself is pinned above. So this stub
   * trims each captured page's own pagination down to pages 1–3 and serves three
   * pages: the captured page 1, the captured page 9, and an empty-shaped page
   * (page 1 minus its rows). That exercises the loop's real wiring — the list,
   * then each page it advertises, in order, exactly once — on real bytes.
   *
   * The trim must cover EVERY page number a served page prints, or the engine
   * will walk off the stub: the reader takes its queue from the page selector's
   * `data-page-number` options AND from the `<link rel="next">` control, and the
   * captured page 9 carries `rel="next" href="…/page10"` (it really is page 9 of
   * a 48-page group). Trimming the options alone left that link pointing at a
   * page this stub never serves. So the next control is clamped to the last
   * served page too — every URL discoverable in the bytes handed out here is one
   * of the three pages mapped below.
   */
  const SERVED_PAGES = 3;
  const threePages = (html: string): string =>
    html
      .replace(
        /(<option\b[^>]*?)data-page-number="(\d+)"/g,
        (all, head: string, n: string) =>
          Number(n) <= SERVED_PAGES
            ? all
            : `${head}data-page-number-trimmed="${n}"`,
      )
      .replace(
        /(<link\b[^>]*rel="next"[^>]*href="[^"]*\/page)(\d+)"/g,
        (all, head: string, n: string) =>
          Number(n) <= SERVED_PAGES ? all : `${head}${SERVED_PAGES}"`,
      );
  const EMPTY_PAGE = threePages(
    PAGE1.replace(/<tr\s+data-index="\d+"[\s\S]*?<\/tr>/g, ""),
  );
  const P1_3 = threePages(PAGE1);
  const P9_3 = threePages(PAGE9);

  function stub(): string[] {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body =
        url === VA_BIDNET_LIST_URL
          ? P1_3
          : url === `${VA_BIDNET_LIST_URL}/page2`
            ? P9_3
            : url === `${VA_BIDNET_LIST_URL}/page3`
              ? EMPTY_PAGE
              : undefined;
      if (body === undefined) throw new Error(`unexpected URL in test: ${url}`);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    return asked;
  }

  test("the list plus the pages it advertises are read, in order, once each", async () => {
    const asked = stub();
    const { rows, skipped } = await fetchVaBidnetBids(CAPTURED);
    expect(asked).toEqual([
      VA_BIDNET_LIST_URL,
      `${VA_BIDNET_LIST_URL}/page2`,
      `${VA_BIDNET_LIST_URL}/page3`,
    ]);
    // 25 rows from page 1 + 25 from page 2; the empty-shaped page 3 is honest-empty.
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) expect(r.external_id).toMatch(/^vabidnet-\d+$/);
  });

  test("a page that lost its shape FAILS the fetch (fail-closed, never honest-empty)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body>Service Unavailable</body></html>", {
        status: 200,
      })) as typeof fetch;
    await expect(fetchVaBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
    // A non-200 (BidNet's bot wall answers 403 to a plain UA) is a failure too,
    // never an empty read.
    globalThis.fetch = (async () =>
      new Response("nope", { status: 403 })) as typeof fetch;
    await expect(fetchVaBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
  });

  test("a heading that claims solicitations the rows did not deliver FAILS", async () => {
    // The table/heading survive, but every row lost its open state → the reader
    // must not report an empty purchasing group. (Selector trimmed to 3 pages so
    // the check does not wait out 48 politeness delays.)
    const timedOut = P1_3.replace(
      /sol-closing-date open/g,
      "sol-closing-date timedout",
    );
    globalThis.fetch = (async () =>
      new Response(timedOut, { status: 200 })) as typeof fetch;
    await expect(fetchVaBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
  });

  test("the configured page cap covers the list the group actually advertises", () => {
    // A guard against a future config edit: a cap below the advertised page count
    // would silently truncate the group (the engine stops reading at the cap).
    const group = createBidNetGroup({
      source: VA_BIDNET_SOURCE,
      idPrefix: VA_BIDNET_ID_PREFIX,
      slug: "virginia",
      stateName: "Virginia",
      groupName: "Virginia & DC Purchasing Group",
      maxPages: VA_BIDNET_MAX_PAGES,
    });
    expect(group.maxPages).toBe(VA_BIDNET_MAX_PAGES);
    expect(group.listUrl).toBe(VA_BIDNET_LIST_URL);
    expect(group.agency).toBe(VA_BIDNET_AGENCY);
    expect(parseVaBidnetPageLinks(PAGE1).length).toBeLessThanOrEqual(group.maxPages);
  });
});

describe("va_bidnet — helpers", () => {
  test("detail ids, absolute URLs, date-only deadlines and date keys", () => {
    expect(
      vaBidnetDetailId(
        "/public/supplier/solicitations/statewide/444205866429/abstract?x=1",
      ),
    ).toBe("444205866429");
    expect(
      vaBidnetDetailId("/public/supplier/solicitations/other/abc/abstract"),
    ).toBeNull();
    expect(vaBidnetAbsoluteUrl("/virginia/solicitations/open-bids/page2")).toBe(
      "https://www.bidnetdirect.com/virginia/solicitations/open-bids/page2",
    );
    expect(vaBidnetDueMs("Not Available")).toBeNaN();
    expect(vaBidnetDueMs("13/40/2026")).toBeNaN();
    expect(vaBidnetDateKey("11/30/2026")).toBe("2026-11-30");
    expect(vaBidnetDateKey("Not Available")).toBeNull();
  });

  test("registration (tail source + the approved class map)", () => {
    expect(VA_BIDNET_LIST_URL).toBe(
      "https://www.bidnetdirect.com/virginia/solicitations/open-bids",
    );
    expect(VA_BIDNET_AGENCY).toBe(
      "Virginia & DC Purchasing Group (BidNet Direct)",
    );
    // Registered as a tail source, so the daily sync runs it. Presence is all
    // that is asserted: `runner.ts` registers `fetchFn: () => fetchVaBidnetBids()`
    // (a wrapping arrow, so that the job can pass its own clock), so the entry is
    // never the exported function by identity — same as sd_bidnet / nh_bidnet.
    expect(TAIL_SOURCES.some((s) => s.name === "va_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.va_bidnet).toEqual({
      class: "state",
      scopeState: "VA",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    // The two Virginia sources this one sits NEXT TO are untouched: eVA is the
    // Commonwealth's own state/local portal and `va_evirginia` is the FEDERAL SAM
    // pass scoped to Virginia place of performance. Neither is a BidNet surface.
    expect(SOURCE_CLASSES.va_eva).toEqual({
      class: "state",
      scopeState: "VA",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    expect(SOURCE_CLASSES.va_evirginia).toEqual({
      class: "federal",
      searchScope: "state-pop",
      scopeState: "VA",
      recordType: "opportunity",
    });
  });
});
