/**
 * BidNet Direct — California Purchasing Group (`ca_bidnet`) connector pins.
 * Zero network, no database: the fixtures hold verbatim public list pages
 * captured 2026-10-21 (gzipped; see fixtures/ca-bidnet/README.md for the URLs and
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
  BIDNET_MAX_PAGES,
  BIDNET_PASS_TIMEOUT_MS,
  createBidNetGroup,
} from "./bidnet-direct";
import {
  CA_BIDNET_AGENCY,
  CA_BIDNET_ID_PREFIX,
  CA_BIDNET_LIST_URL,
  CA_BIDNET_MAX_PAGES,
  CA_BIDNET_ORIGIN,
  CA_BIDNET_PASS_TIMEOUT_MS,
  CA_BIDNET_SOURCE,
  caBidnetAbsoluteUrl,
  caBidnetDateKey,
  caBidnetDetailId,
  caBidnetDueMs,
  caBidnetListShapeOk,
  caBidnetStatedOpenCount,
  fetchCaBidnetBids,
  parseCaBidnet,
  parseCaBidnetPageLinks,
  parseCaBidnetRows,
  type CaBidnetRow,
} from "./ca-bidnet";

const read = (name: string): string =>
  gunzipSync(
    readFileSync(new URL(`./fixtures/ca-bidnet/${name}`, import.meta.url)),
  ).toString("utf8");

const PAGE1 = read("open-bids-2026-10-21.html.gz");
const PAGE2 = read("open-bids-page2-2026-10-21.html.gz");
const PAGES = [PAGE1, PAGE2];

/** Captured 2026-10-21T22:00Z — every solicitation in the capture is still open. */
const CAPTURED = Date.parse("2026-10-21T22:00:00Z");

const ROWS1 = parseCaBidnetRows(PAGE1);
const ROWS2 = parseCaBidnetRows(PAGE2);
const LISTED: CaBidnetRow[] = PAGES.flatMap((h) => parseCaBidnetRows(h));

describe("ca_bidnet — list pages (captured)", () => {
  test("the capture is the California group, and the heading's comma total is read whole", () => {
    for (const page of PAGES) expect(caBidnetListShapeOk(page)).toBe(true);
    // The results header reads "2,468 Open Solicitations" — thousands-comma form.
    // Read as 468 it would under-count by more than five times, so the shared
    // helper must take the comma form as one number (pinned here, and unchanged
    // for the SD/NH groups whose totals print no comma).
    for (const page of PAGES) expect(caBidnetStatedOpenCount(page)).toBe(2468);
    expect(
      caBidnetStatedOpenCount('<span class="simpleResultsNumResults"> 44 Open Solicitations</span>'),
    ).toBe(44);
    expect(caBidnetStatedOpenCount("<html></html>")).toBeNull();
  });

  test("page 1 and page 2 are disjoint 25-row pages of the same list", () => {
    expect(ROWS1.length).toBe(25);
    expect(ROWS2.length).toBe(25);
    expect(LISTED.length).toBe(50);
    const ids = LISTED.map((r) => r.id);
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
    // `data-index` restarts at 0 on every page, so identity can never be positional.
    expect(ROWS1[0]!.id).toBe("444205633248");
    expect(ROWS2[0]!.id).toBe("444205558031");
    // …and the same id is on exactly one of the two captured pages.
    expect(ROWS2.some((r) => r.id === ROWS1[0]!.id)).toBe(false);
  });

  test("every row reads exactly as the page prints it, region per row", () => {
    const first = ROWS1[0]!;
    expect(first).toEqual({
      id: "444205633248",
      title: "Shafter Community Emissions Reduction Program: Vegetative Barriers",
      region: "California",
      published: "10/21/2026",
      closing: "12/04/2026",
      closingState: "open",
      url: `${CA_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/444205633248/abstract?purchasingGroupId=88020151&origin=1`,
    });
    // Unlike the Virginia & DC group, this one's rows are single-region: every row
    // on both captured pages reads `California`, and the reader stores that text
    // verbatim (it never substitutes the group name or the state scope for it).
    for (const r of LISTED) {
      expect(r.region).toBe("California");
      expect(r.closingState).toBe("open");
      expect(r.published).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(r.closing).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
    // Every captured row was still open at the capture time.
    expect(LISTED.map((r) => r.closing).sort()[0]!).toBe("10/26/2026");
    expect(ROWS2[ROWS2.length - 1]!.id).toBe("444205517322");
  });

  test("the shape guard separates a reshape from honest-empty", () => {
    expect(
      caBidnetListShapeOk("<html><body>Service Unavailable</body></html>"),
    ).toBe(false);
    expect(
      caBidnetListShapeOk(
        '<table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(false);
    expect(caBidnetListShapeOk("<h1>0 Open Solicitations</h1>")).toBe(false);
    // …but the table plus a heading with zero solicitations is still the shape.
    expect(
      caBidnetListShapeOk(
        '<h1>0 Open Solicitations</h1><table class="sol-table mets-table"><tbody></tbody></table>',
      ),
    ).toBe(true);
    expect(parseCaBidnetRows("<html></html>")).toEqual([]);
  });

  test("pagination is the page's OWN advertised GET links — 99 pages, far past the engine default", () => {
    const links = parseCaBidnetPageLinks(PAGE1);
    // 2,468 open solicitations at 25 rows/page = 98 pages of 25 + a last page of 18.
    expect(links.length).toBe(99);
    expect(links.map((l) => l.pageNumber)).toEqual(
      Array.from({ length: 99 }, (_, i) => i + 1),
    );
    for (const l of links)
      expect(l.href).toBe(`${CA_BIDNET_LIST_URL}/page${l.pageNumber}`);
    expect(parseCaBidnetPageLinks(PAGE2)).toEqual(links);
    expect(parseCaBidnetPageLinks("<html></html>")).toEqual([]);
    // The engine's default cap (20) would truncate this group to its first 500
    // rows, which is why this config raises it: the cap must cover the 99 pages
    // the group advertises today, with headroom for growth.
    expect(links.length).toBeGreaterThan(BIDNET_MAX_PAGES);
    expect(CA_BIDNET_MAX_PAGES).toBeGreaterThanOrEqual(links.length);
    expect(CA_BIDNET_MAX_PAGES).toBeGreaterThan(BIDNET_MAX_PAGES);
  });
});

describe("ca_bidnet — rows (captured)", () => {
  test("all 50 captured rows are accepted, with the aggregator honesty on every row", () => {
    const { rows, skipped, skippedRows } = parseCaBidnet(LISTED, CAPTURED);
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    expect(skippedRows).toEqual([]);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^cabidnet-\d+$/);
      expect(r.external_id.startsWith(`${CA_BIDNET_ID_PREFIX}-`)).toBe(true);
      expect(r.agency).toBe(CA_BIDNET_AGENCY);
      expect(r.location).toBe("California");
      expect(r.notice_type).toBe("Open solicitation");
      expect(r.estimated_value).toBe("Not specified");
      // Every row cites the public per-solicitation page the list linked to.
      const u = new URL(r.source_url);
      expect(u.protocol).toBe("https:");
      expect(u.host).toBe("www.bidnetdirect.com");
      expect(u.pathname).toMatch(
        /^\/public\/supplier\/solicitations\/[a-z-]+\/\d+\/abstract$/,
      );
      expect(u.searchParams.get("purchasingGroupId")).toBe("88020151");
      // Fields BidNet shows only to registered members are NEVER claimed.
      expect(r.solicitation_number).toBeNull();
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.set_aside).toBeNull();
      expect(r.due_date).not.toBeNull();
      expect(Number.isNaN(Date.parse(r.due_date!))).toBe(false);
      // The aggregator honesty travels on the row itself, not only in the header,
      // and it names California's own portal as the thing BidNet is not.
      expect(r.description).toContain("third-party");
      expect(r.description).toContain(
        "not the State of California's procurement portal",
      );
      expect(r.description).toContain("registered members only");
      expect(r.description).toContain("California Purchasing Group");
    }
  });

  test("a California row stays California (per-row geography)", () => {
    const { rows } = parseCaBidnet(LISTED, CAPTURED);
    for (const r of rows) {
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: CA_BIDNET_SOURCE,
      });
      expect(cols.raw_location).toBe("California");
      expect(cols.normalized_state).toBe("CA");
      expect(cols.source_jurisdiction).toBe("CA");
    }
  });

  test("a row reads as the list prints it (dates, identity, category)", () => {
    const { rows } = parseCaBidnet(LISTED, CAPTURED);
    const r = rows.find((x) => x.external_id === "cabidnet-444205633248")!;
    expect(r.title).toBe(
      "Shafter Community Emissions Reduction Program: Vegetative Barriers",
    );
    expect(r.location).toBe("California");
    // Closing 12/04/2026 — after DST ends, so 11:59 PM EST = 04:59Z next day.
    expect(r.due_date).toBe("2026-12-05T04:59:00.000Z");
    expect(r.source_url).toBe(
      `${CA_BIDNET_ORIGIN}/public/supplier/solicitations/statewide/444205633248/abstract?purchasingGroupId=88020151&origin=1`,
    );
    expect(r.description).toContain("Published 10/21/2026; closing 12/04/2026.");
    expect(r.description).toContain("stores the deadline at 11:59 PM Eastern");
    // `category` is Contrax's own classification of the TITLE via the shared
    // classifier (the list publishes no category of its own) — never of our
    // composed description, which must not be able to steer a row's trade.
    for (const row of rows) expect(row.category).toBe(mapCategory("", row.title, ""));
  });

  test("the deadline is stored in the source's own Eastern time (DST aware)", () => {
    const { rows } = parseCaBidnet(LISTED, CAPTURED);
    // 10/26/2026 is still inside DST → 11:59 PM EDT = 03:59Z next day.
    expect(caBidnetDueMs("10/26/2026")).toBe(Date.parse("2026-10-27T03:59:00Z"));
    // 11/09/2026 is after DST ends → EST = 04:59Z next day.
    expect(caBidnetDueMs("11/09/2026")).toBe(Date.parse("2026-11-10T04:59:00Z"));
    // Every stored deadline is the row's own closing date at 11:59 PM Eastern:
    // the clock reads 03:59Z (EDT) or 04:59Z (EST) on the day after the date.
    for (const listed of LISTED) {
      const stored = rows.find((x) => x.external_id === `cabidnet-${listed.id}`)!;
      expect(stored.due_date).toBe(
        new Date(caBidnetDueMs(listed.closing)).toISOString(),
      );
      expect(["03:59", "04:59"]).toContain(stored.due_date!.slice(11, 16));
    }
  });

  test("a passed close date is never accepted; a repeat is skipped; empty is honest", () => {
    const late = parseCaBidnet(LISTED, Date.parse("2027-11-01T00:00:00Z"));
    expect(late.rows.length).toBe(0);
    expect(late.skipped).toEqual({ closed: 50 });
    const twice = parseCaBidnet([...LISTED, ...LISTED], CAPTURED);
    expect(twice.rows.length).toBe(50);
    expect(twice.skipped).toEqual({ duplicate: 50 });
    expect(parseCaBidnet([ROWS1[0]!, ROWS1[0]!], CAPTURED).skipped).toEqual({
      duplicate: 1,
    });
    // Zero open solicitations (a quiet purchasing group) is 0 rows, not an error.
    expect(parseCaBidnet([], CAPTURED)).toEqual({
      rows: [],
      skipped: {},
      skippedRows: [],
    });
  });

  test("a row the page does not mark open is skipped, not accepted", () => {
    expect(
      parseCaBidnet([{ ...ROWS1[0]!, closingState: "closed" }], CAPTURED).skipped,
    ).toEqual({ not_open: 1 });
    expect(
      parseCaBidnet([{ ...ROWS1[0]!, closing: "Not Available" }], CAPTURED)
        .skipped,
    ).toEqual({ bad_date: 1 });
    expect(parseCaBidnet([{ ...ROWS1[0]!, id: "" }], CAPTURED).skipped).toEqual({
      missing_id: 1,
    });
    expect(
      parseCaBidnet([{ ...ROWS1[0]!, title: "" }], CAPTURED).skipped,
    ).toEqual({ missing_title: 1 });
  });

  test("the same bytes parsed twice give the same rows (no churn on re-run)", () => {
    const print = (rows: CaBidnetRow[]) =>
      parseCaBidnet(rows, CAPTURED).rows.map((r) =>
        [r.external_id, r.title, r.due_date, r.location, r.source_url].join(" | "),
      );
    expect(print(LISTED)).toEqual(print(LISTED));
  });
});

describe("ca_bidnet — fetch loop (stubbed from the fixtures, zero network)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * The real page 1 advertises 99 pages; serving all 99 here would cost 98 × the
   * engine's politeness delay, and the cap itself is pinned above. So this stub
   * trims each captured page's own pagination down to pages 1–3 and serves three
   * pages: the captured page 1, the captured page 2, and an empty-shaped page
   * (page 1 minus its rows). That exercises the loop's real wiring — the list,
   * then each page it advertises, in order, exactly once — on real bytes.
   *
   * The trim must cover EVERY page number a served page prints, or the engine
   * will walk off the stub: the reader takes its queue from the page selector's
   * `data-page-number` options AND from the `<link rel="next">` control, and the
   * captured page 2 carries `rel="next" href="…/page3"` of a 99-page group. Both
   * are clamped to the last served page, so every URL discoverable in the bytes
   * handed out here is one of the three pages mapped below.
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
  const P2_3 = threePages(PAGE2);

  function stub(): string[] {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body =
        url === CA_BIDNET_LIST_URL
          ? P1_3
          : url === `${CA_BIDNET_LIST_URL}/page2`
            ? P2_3
            : url === `${CA_BIDNET_LIST_URL}/page3`
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
    const { rows, skipped } = await fetchCaBidnetBids(CAPTURED);
    expect(asked).toEqual([
      CA_BIDNET_LIST_URL,
      `${CA_BIDNET_LIST_URL}/page2`,
      `${CA_BIDNET_LIST_URL}/page3`,
    ]);
    // 25 rows from page 1 + 25 from page 2; the empty-shaped page 3 is honest-empty.
    expect(rows.length).toBe(50);
    expect(skipped).toEqual({});
    for (const r of rows) expect(r.external_id).toMatch(/^cabidnet-\d+$/);
  });

  test("a page that lost its shape FAILS the fetch (fail-closed, never honest-empty)", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body>Service Unavailable</body></html>", {
        status: 200,
      })) as typeof fetch;
    await expect(fetchCaBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
    // A non-200 (BidNet's bot wall answers 403 to a plain UA) is a failure too,
    // never an empty read.
    globalThis.fetch = (async () =>
      new Response("nope", { status: 403 })) as typeof fetch;
    await expect(fetchCaBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
  });

  test("a heading that claims solicitations the rows did not deliver FAILS", async () => {
    // The table/heading survive, but every row lost its open state → the reader
    // must not report an empty purchasing group. (Selector trimmed to 3 pages so
    // the check does not wait out 99 politeness delays.)
    const timedOut = P1_3.replace(
      /sol-closing-date open/g,
      "sol-closing-date timedout",
    );
    globalThis.fetch = (async () =>
      new Response(timedOut, { status: 200 })) as typeof fetch;
    await expect(fetchCaBidnetBids(CAPTURED)).rejects.toBeInstanceOf(
      SourceUnreachableError,
    );
  });

  test("the configured page cap and pass budget cover the list the group actually advertises", () => {
    // A guard against a future config edit: a cap below the advertised page count
    // would silently truncate the group (the engine stops reading at the cap).
    const group = createBidNetGroup({
      source: CA_BIDNET_SOURCE,
      idPrefix: CA_BIDNET_ID_PREFIX,
      slug: "california",
      stateName: "California",
      groupName: "California Purchasing Group",
      maxPages: CA_BIDNET_MAX_PAGES,
      passTimeoutMs: CA_BIDNET_PASS_TIMEOUT_MS,
    });
    expect(group.maxPages).toBe(CA_BIDNET_MAX_PAGES);
    expect(group.passTimeoutMs).toBe(CA_BIDNET_PASS_TIMEOUT_MS);
    expect(group.listUrl).toBe(CA_BIDNET_LIST_URL);
    expect(group.agency).toBe(CA_BIDNET_AGENCY);
    expect(parseCaBidnetPageLinks(PAGE1).length).toBeLessThanOrEqual(group.maxPages);
    // This group is the largest the engine reads (99 pages), so its own per-pass
    // abort is raised above the engine default — and the engine default stays put
    // for SD/NH/VA, whose groups finish well inside it.
    expect(CA_BIDNET_PASS_TIMEOUT_MS).toBe(240_000);
    expect(CA_BIDNET_PASS_TIMEOUT_MS).toBeGreaterThan(BIDNET_PASS_TIMEOUT_MS);
    expect(BIDNET_PASS_TIMEOUT_MS).toBe(120_000);
    // A group that does not set `passTimeoutMs` keeps the engine default.
    expect(
      createBidNetGroup({
        source: "x",
        idPrefix: "x",
        slug: "x",
        stateName: "X",
        groupName: "X",
      }).passTimeoutMs,
    ).toBe(BIDNET_PASS_TIMEOUT_MS);
  });
});

describe("ca_bidnet — helpers", () => {
  test("detail ids, absolute URLs, date-only deadlines and date keys", () => {
    expect(
      caBidnetDetailId(
        "/public/supplier/solicitations/statewide/444205633248/abstract?x=1",
      ),
    ).toBe("444205633248");
    expect(
      caBidnetDetailId("/public/supplier/solicitations/other/abc/abstract"),
    ).toBeNull();
    expect(caBidnetAbsoluteUrl("/california/solicitations/open-bids/page2")).toBe(
      "https://www.bidnetdirect.com/california/solicitations/open-bids/page2",
    );
    expect(caBidnetDueMs("Not Available")).toBeNaN();
    expect(caBidnetDueMs("13/40/2026")).toBeNaN();
    expect(caBidnetDateKey("12/04/2026")).toBe("2026-12-04");
    expect(caBidnetDateKey("Not Available")).toBeNull();
  });

  test("registration (tail source + the approved class map)", () => {
    expect(CA_BIDNET_LIST_URL).toBe(
      "https://www.bidnetdirect.com/california/solicitations/open-bids",
    );
    expect(CA_BIDNET_AGENCY).toBe("California Purchasing Group (BidNet Direct)");
    // Registered as a tail source, so the 4-hourly sync runs it. Presence is all
    // that is asserted: `runner.ts` registers `fetchFn: () => fetchCaBidnetBids()`
    // (a wrapping arrow, so that the job can pass its own clock), so the entry is
    // never the exported function by identity — same as sd/nh/va_bidnet.
    expect(TAIL_SOURCES.some((s) => s.name === "ca_bidnet")).toBe(true);
    expect(SOURCE_CLASSES.ca_bidnet).toEqual({
      class: "state",
      scopeState: "CA",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    // California's OWN portal source is untouched: `ca_eprocure` is Cal eProcure,
    // the state's own board; this BidNet group is a different publisher's surface.
    expect(SOURCE_CLASSES.ca_eprocure).toEqual({
      class: "state",
      scopeState: "CA",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    // The three BidNet configs that came before are untouched too.
    for (const name of ["sd_bidnet", "nh_bidnet", "va_bidnet"])
      expect(`${name}=${SOURCE_CLASSES[name]!.class}`).toBe(`${name}=state`);
  });
});
