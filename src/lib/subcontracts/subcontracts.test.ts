/**
 * SUBCONTRACTING preview, data layer — the deterministic unit suites
 * (owner directive 2026-09-25, BUILD-PLAN.md §6.5). ZERO network, ZERO database:
 * every byte comes from a committed fixture captured from the live SBA SUBNet board
 * on 2026-09-25 (src/lib/subcontracts/fixtures/), and the crawler's fetcher is
 * INJECTED. Listed explicitly in .github/workflows/build-check.yml because a new
 * deterministic suite that no workflow names runs nowhere.
 *
 * FIXTURE PROVENANCE (re-verified, do not guess): both fixtures were re-fetched from
 * the live board on 2026-09-25T16:22:17Z — the detail page came back 36,605 bytes,
 * BYTE-IDENTICAL to the committed snapshot, and the live index page 0's
 * `<table class="usa-table cols-6">…</table>` region is BYTE-IDENTICAL to the committed
 * index fixture (10 rows). So the three expectations that were red were stale
 * EXPECTATIONS, not fixture drift, except the point of contact, which was a real
 * parser gap (the POC lives in its own `…__section__contact` sibling, not inside the
 * `…__details` region) — fixed in subnet.ts and pinned below.
 *
 * What it pins, in the order the honesty contract cares about:
 *   1. PARSER — the index page (10 real rows), the single-digit-date form the recon
 *      probe's two-digit regex silently dropped (the "91 notices have no closing
 *      date" error), the source's own `no-results` end-of-pager marker, and the
 *      detail page's real fields (division, website, certifications solicited, NAICS
 *      code+title, attachments, POC, description).
 *   2. FAIL-CLOSED — a page with neither the notice table nor the empty marker is a
 *      parse ERROR (never an empty board); a crawl that parses no notice at all is an
 *      error too.
 *   3. DEDUPE + PAGER — one record per (source, external_id) with collisions reported,
 *      and the two real end-of-pager shapes: the `no-results` page and the pager
 *      REDISPLAYING an earlier page (which an "empty page" stop signal would never
 *      catch), plus the page cap.
 *   4. EXPIRY — the US Eastern day boundary with the closing day itself INCLUSIVE
 *      (frozen clocks either side of 00:00 ET), no closing date ⇒ unverified, and the
 *      stale sweep's split (passed date ⇒ closed, otherwise unverified).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  crawlShouldStop,
  classifySubcontractNotice,
  dedupeNotices,
  listedScopes,
  splitNaics,
  stateCodeForPlace,
  sweptStatusFor,
  toNoticeRow,
  SUBNET_SOURCE,
  type SubcontractNotice,
} from "~/lib/subcontracts/connector";
import {
  SubnetParseError,
  crawlSubnet,
  noticesFromCrawl,
  parseSubnetDetailPage,
  parseSubnetIndexPage,
  subnetIndexUrl,
} from "~/lib/subcontracts/subnet";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const INDEX_PAGE = fixture("subnet-index-page0.html");
const EMPTY_PAGE = fixture("subnet-index-empty-page.html");
const DETAIL_PAGE = fixture("subnet-detail-dorm-common-area-landscaping.html");

/** An unclassified notice, built from literals (no fixture involved). */
function notice(overrides: Partial<SubcontractNotice> = {}): SubcontractNotice {
  return {
    sourceKey: SUBNET_SOURCE.sourceKey,
    externalId: "sample",
    title: "Sample notice",
    prime: "Sample Prime LLC",
    primeDivision: null,
    website: null,
    scope: null,
    summary: null,
    trades: [],
    certsSolicited: [],
    naics: "561730: Landscaping Services",
    naicsCode: "561730",
    naicsTitle: "Landscaping Services",
    placeOfPerformance: "Indiana",
    stateCode: "IN",
    closingDate: "2026-10-12",
    performanceStartDate: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    sourceUrl: SUBNET_SOURCE.officialUrl,
    detailUrl: "https://legacy.sba.gov/opportunity/sample",
    attachments: [],
    detailFetched: true,
    sourceUpdatedAt: null,
    raw: {},
    ...overrides,
  };
}

describe("SUBNet index parser", () => {
  test("parses the ten real rows of index page 0 field by field", () => {
    const page = parseSubnetIndexPage(INDEX_PAGE);
    expect(page.rows).toHaveLength(10);
    expect(page.emptyMarker).toBe(false);
    const first = page.rows[0]!;
    expect(first.externalId).toBe("rfi-243824-safety-compliance-training-courses-provider");
    expect(first.detailUrl).toBe(
      "https://legacy.sba.gov/opportunity/rfi-243824-safety-compliance-training-courses-provider",
    );
    expect(first.title).toBe("RFI 243824 Safety and Compliance Training Courses Provider");
    expect(first.prime).toBe("Pacific Gas and Electric Company");
    expect(first.closingRaw).toBe("11/4/2026");
    expect(first.performanceStartRaw).toBe("10/15/2027");
    expect(first.placeRaw).toBe("California");
    expect(first.naicsRaw).toBe("611430: Professional and Management Development Training");
    // Every row carries the six cells the board publishes.
    for (const row of page.rows) {
      expect(row.externalId.length).toBeGreaterThan(0);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.prime.length).toBeGreaterThan(0);
    }
  });

  test("reads the contact block from the POC cell (mailto name + tel number)", () => {
    const page = parseSubnetIndexPage(INDEX_PAGE);
    const withContact = page.rows.find((r) => r.contactEmail !== null)!;
    expect(withContact.contactEmail).toMatch(/@/);
    expect(withContact.contactName).not.toBeNull();
    expect(withContact.contactPhone).toMatch(/^[0-9-]+$/);
    // Exactly one row on this page publishes no point of contact at all.
    expect(page.rows.filter((r) => r.contactEmail === null)).toHaveLength(1);
  });

  test("single-digit closing dates parse (the trap that produced the plan's '91 unverified')", () => {
    const page = parseSubnetIndexPage(INDEX_PAGE);
    // "10/5/2026" is a real row on this page; a (\d{2})/(\d{2})/(\d{4}) pattern
    // reads it as "no closing date", which is how the recon reported 65 % of the
    // board as undated. All 141 live rows publish a date.
    const row = page.rows.find((r) => r.closingRaw === "10/5/2026")!;
    expect(row).toBeDefined();
    const noticeRow = toNoticeRow(
      notice({ externalId: row.externalId, closingDate: "2026-10-05" }),
      new Date("2026-09-25T20:00:00Z"),
    );
    expect(noticeRow.closingDate).toBe("2026-10-05");
    expect(noticeRow.status).toBe("open");
  });

  test("an out-of-range page (the source's own no-results marker) is an EMPTY page, not an error", () => {
    const page = parseSubnetIndexPage(EMPTY_PAGE);
    expect(page.rows).toEqual([]);
    expect(page.emptyMarker).toBe(true);
  });

  test("a page with neither the notice table nor the marker THROWS — never an empty board", () => {
    expect(() => parseSubnetIndexPage("<html><body><p>Hello</p></body></html>")).toThrow(
      SubnetParseError,
    );
  });

  test("query form is the full exposed-query form the pager actually honours", () => {
    expect(subnetIndexUrl(3)).toBe(`${SUBNET_SOURCE.officialUrl}?keyword=&state=All&op=contains&page=3`);
  });
});

describe("SUBNet detail parser", () => {
  const detail = parseSubnetDetailPage(DETAIL_PAGE);

  test("reads the business fields the index cannot publish", () => {
    expect(detail.division).toBe("Atterbury Job Corps");
    expect(detail.identifier).toBe("Dorm and Common Area Landscaping");
    // VERBATIM, and deliberately NOT normalized: the live page's `sba-subnet__website`
    // anchor is exactly `href="https://adamsaai.com"` (re-fetched 2026-09-25T16:22:17Z,
    // byte-identical to this fixture). The earlier expectation of
    // "https://www.adamsaai.com" was WRONG — it invented a `www.` the source never
    // published, which is exactly what the honesty contract forbids. We never add,
    // strip or rewrite a host: whatever the notice published is what we store and show.
    expect(detail.website).toBe("https://adamsaai.com");
    expect(detail.placeOfPerformance).toBe("Indiana");
    expect(detail.performanceStartRaw).toBe("10/15/2026");
    expect(detail.closingRaw).toBe("10/12/2026");
  });

  test("reads the certifications the notice itself solicits", () => {
    // The live page's "Type of Businesses Being Solicited" list has SIX entries and
    // includes VOSB (a SEPARATE line from the SDVOSB one) — re-fetched
    // 2026-09-25T16:22:17Z, byte-identical to this fixture, and the source is the
    // ground truth for what a notice solicits. The earlier five-item expectation was
    // stale; the parser was right.
    expect(detail.certsSolicited).toEqual([
      "Small Business (SB)",
      "Small Disadvantaged Business (SDB)",
      "Women-Owned Small Business (WOSB)",
      "SBA-certified HUBZone Small Business (HUBZone SB)",
      "Veteran-Owned Small Business (VOSB)",
      "SBA-certified Service-Disabled Veteran-Owned Small Business (SDVOSB)",
    ]);
  });

  test("reads NAICS code + title separately, the point of contact, and the attachments", () => {
    expect(detail.naicsCode).toBe("561730");
    expect(detail.naicsTitle).toBe("Landscaping Services");
    expect(detail.contactName).toBe("Tammy Swallows");
    expect(detail.contactPhone).toBe("tel:8123146020");
    expect(detail.contactEmail).toBe("mailto:swallows.tammy@jobcorps.org");
    expect(detail.attachments).toEqual([
      { name: "CRA - SOW LandscapingAT26-137.docx", size: "57.76 KB" },
    ]);
    // Attachments are recorded by name and size ONLY — their files live under the
    // robots-disallowed /sites/default/files/* path, so nothing links to them.
    expect(JSON.stringify(detail.attachments)).not.toContain("/sites/default/files");

    // REGRESSION (the POC parser gap found 2026-09-25, fixed in subnet.ts). The contact
    // block is its own `sba-subnet__section__contact` SIBLING of the details region, and
    // its three field classes nest (`__poc`, `__poc-phone`, `__poc-email`). Pin both
    // halves of the fix here so neither can silently regress:
    //   * the three values are three DIFFERENT fields (a `\b` class boundary would let
    //     `__poc` read the phone div, which is how a "fixed" POC could come back wrong);
    //   * with the contact section renamed away the fields are NULL — the POC is never
    //     inferred from somewhere else on the page (the details region still parses).
    expect(new Set([detail.contactName, detail.contactPhone, detail.contactEmail]).size).toBe(3);
    const withoutContact = DETAIL_PAGE.replace(
      /sba-subnet__section__contact/g,
      "sba-subnet__section__contact-gone",
    );
    expect(withoutContact).not.toBe(DETAIL_PAGE);
    const stripped = parseSubnetDetailPage(withoutContact);
    expect(stripped.division).toBe("Atterbury Job Corps");
    expect(stripped.contactName).toBeNull();
    expect(stripped.contactPhone).toBeNull();
    expect(stripped.contactEmail).toBeNull();
  });

  test("keeps the description and the notice's own Project Summary separate", () => {
    expect(detail.description).toContain("Landscaping, Tree Trimming");
    expect(detail.description).not.toContain("Project Summary");
    expect(detail.projectSummary).toContain("Site Visit: October 02, 2026 @ 10:30AM");
  });

  test("a detail page without the details region THROWS", () => {
    expect(() => parseSubnetDetailPage("<html><body>nope</body></html>")).toThrow(SubnetParseError);
  });
});

describe("normalization is the source's own words", () => {
  test("place of performance maps ONLY when unambiguous", () => {
    expect(stateCodeForPlace("Indiana")).toBe("IN");
    expect(stateCodeForPlace("  new  york ")).toBe("NY");
    expect(stateCodeForPlace("Not applicable")).toBeNull();
    expect(stateCodeForPlace("Central California")).toBeNull();
    expect(stateCodeForPlace(null)).toBeNull();
  });

  test("listed scopes come from the source's NAICS description, and NAICS splits", () => {
    expect(listedScopes("Landscaping Services")).toEqual(["Landscaping Services"]);
    expect(listedScopes("JANITORIAL SERVICES")).toEqual(["Janitorial Services"]);
    expect(listedScopes(null)).toEqual([]);
    expect(splitNaics("561730: Landscaping Services")).toEqual({
      code: "561730",
      title: "Landscaping Services",
    });
  });
});

describe("dedupe + the crawl stop rules", () => {
  test("one record per (source, external_id), every collision reported", () => {
    const result = dedupeNotices([
      { sourceKey: "sba-subnet", externalId: "a" },
      { sourceKey: "sba-subnet", externalId: "b" },
      { sourceKey: "sba-subnet", externalId: "a" },
      { sourceKey: "other", externalId: "a" },
    ]);
    expect(result.records.map((r) => `${r.sourceKey}:${r.externalId}`)).toEqual([
      "sba-subnet:a",
      "sba-subnet:b",
      "other:a",
    ]);
    expect(result.collisions).toEqual(["sba-subnet:a"]);
  });

  test("the pager's no-results page stops the crawl", () => {
    expect(
      crawlShouldStop({
        newRecords: 0,
        repeatedSlug: false,
        emptyMarker: true,
        pagesFetched: 15,
        pageCap: 40,
      }).stop,
    ).toBe(true);
  });

  test("a page that redisplays earlier rows stops the crawl (an empty page never would)", () => {
    const decision = crawlShouldStop({
      newRecords: 0,
      repeatedSlug: true,
      emptyMarker: false,
      pagesFetched: 16,
      pageCap: 40,
    });
    expect(decision.stop).toBe(true);
    expect(decision.reason).toContain("repeated an already-seen slug");
  });

  test("a page with new rows never stops the crawl, and the page cap always does", () => {
    expect(
      crawlShouldStop({
        newRecords: 10,
        repeatedSlug: false,
        emptyMarker: false,
        pagesFetched: 3,
        pageCap: 40,
      }).stop,
    ).toBe(false);
    expect(
      crawlShouldStop({
        newRecords: 4,
        repeatedSlug: false,
        emptyMarker: false,
        pagesFetched: 40,
        pageCap: 40,
      }).stop,
    ).toBe(true);
  });

  test("the crawler skips a detail fetch only for an index row that matches the stored snapshot", async () => {
    const requested: string[] = [];
    const fetchText = async (url: string) => {
      requested.push(url);
      if (url.includes("/opportunity/")) return DETAIL_PAGE;
      return INDEX_PAGE;
    };
    const crawl = await crawlSubnet({ fetchText, storedIndex: new Map(), pageCap: 40 });
    // page 0 contributes rows; page 1+ of the real fixture keeps re-yielding the same
    // slugs, so the crawl must stop on the repeated-slug rule rather than the cap.
    expect(crawl.stats.pagesFetched).toBeLessThan(40);
    expect(crawl.stats.stoppedBecause).toContain("repeated an already-seen slug");
    expect(crawl.rows).toHaveLength(10);
    expect(requested.filter((u) => u.includes("/opportunity/"))).toHaveLength(10);
    expect(crawl.stats.detailsFetched).toBe(10);
    expect(crawl.unchangedIndexIds.size).toBe(0);

    // Second pass: every slug is stored WITH the index snapshot this crawl just parsed,
    // so ZERO detail requests are spent.
    const again: string[] = [];
    const storedIndex = new Map(
      crawl.rows.map((r) => [r.externalId, JSON.parse(JSON.stringify(r)) as unknown]),
    );
    const crawl2 = await crawlSubnet({
      fetchText: async (url) => {
        again.push(url);
        if (url.includes("/opportunity/")) throw new Error("detail fetch must not happen");
        return INDEX_PAGE;
      },
      storedIndex,
    });
    expect(crawl2.stats.detailsFetched).toBe(0);
    expect(crawl2.stats.detailsSkipped).toBe(10);
    expect(crawl2.unchangedIndexIds.size).toBe(10);
    expect(again.filter((u) => u.includes("/opportunity/"))).toHaveLength(0);
  });

  test("noticesFromCrawl merges index + detail, prefers the detail page, and keeps both in raw", () => {
    const page = parseSubnetIndexPage(INDEX_PAGE);
    const row = page.rows.find((r) => r.externalId === "dorm-common-area-landscaping")!;
    const detail = parseSubnetDetailPage(DETAIL_PAGE);
    const { notices, collisions } = noticesFromCrawl([row], new Map([[row.externalId, detail]]));
    expect(collisions).toEqual([]);
    const merged = notices[0]!;
    expect(merged.sourceKey).toBe("sba-subnet");
    expect(merged.primeDivision).toBe("Atterbury Job Corps");
    // Six: the notice's own list includes the separate VOSB line (see the detail-parser
    // test above). The merge carries the DETAIL page's list verbatim.
    expect(merged.certsSolicited).toHaveLength(6);
    expect(merged.certsSolicited).toContain("Veteran-Owned Small Business (VOSB)");
    expect(merged.contactName).toBe("Tammy Swallows");
    expect(merged.trades).toEqual(["Landscaping Services"]);
    expect(merged.naics).toBe("561730: Landscaping Services");
    expect(merged.stateCode).toBe("IN");
    expect(merged.closingDate).toBe("2026-10-12");
    expect(merged.performanceStartDate).toBe("2026-10-15");
    expect(merged.sourceUpdatedAt).toBeNull();
    const raw = merged.raw as { indexClosingDate: string; detailClosingDate: string };
    expect(raw.indexClosingDate).toBe("10/12/2026");
    expect(raw.detailClosingDate).toBe("10/12/2026");
  });

  test("a crawl that parses no notice at all fails closed", async () => {
    await expect(
      crawlSubnet({ fetchText: async () => "<html><body>changed</body></html>" }),
    ).rejects.toThrow(SubnetParseError);
  });
});

describe("expiry: the US Eastern day, closing day INCLUSIVE", () => {
  const at = (iso: string) => new Date(iso);

  test("a notice closing TODAY (ET) stays open; the next ET day it is closed", () => {
    const closing = { closingDate: "2026-09-25" };
    // 2026-09-25 16:00 ET
    expect(classifySubcontractNotice(closing, at("2026-09-25T20:00:00Z")).status).toBe("open");
    // 2026-09-25 21:00 ET — still the same ET day
    expect(classifySubcontractNotice(closing, at("2026-09-26T01:00:00Z")).status).toBe("open");
    // 2026-09-26 00:30 ET — the 00:00 ET rollover
    expect(classifySubcontractNotice(closing, at("2026-09-26T04:30:00Z")).status).toBe("closed");
  });

  test("a notice closing YESTERDAY (ET) is hidden", () => {
    const result = classifySubcontractNotice(
      { closingDate: "2026-09-24" },
      at("2026-09-25T20:00:00Z"),
    );
    expect(result.status).toBe("closed");
    expect(result.reason).toContain("has passed");
  });

  test("no closing date at all lands in the unverified bucket and is never open", () => {
    const result = classifySubcontractNotice({ closingDate: null }, at("2026-09-25T20:00:00Z"));
    expect(result.status).toBe("unverified");
    expect(result.reason).toContain("no closing date");
  });

  test("a future closing date is open", () => {
    expect(
      classifySubcontractNotice({ closingDate: "2026-10-12" }, at("2026-09-25T20:00:00Z")).status,
    ).toBe("open");
  });

  test("the stale sweep: a passed date is closed, anything else is unverified (never open)", () => {
    const now = at("2026-09-25T20:00:00Z");
    expect(sweptStatusFor("2026-09-20", now).status).toBe("closed");
    // Vanished while its closing date is still in the future: we cannot confirm it is
    // open, so it is hidden as unverified — NOT silently left in the open set.
    expect(sweptStatusFor("2026-12-01", now).status).toBe("unverified");
    expect(sweptStatusFor(null, now).status).toBe("unverified");
  });

  test("the fingerprint is content-only: same content ⇒ same value, a date change ⇒ different", () => {
    const base = toNoticeRow(notice(), at("2026-09-25T20:00:00Z"));
    const same = toNoticeRow(notice(), at("2026-09-26T20:00:00Z"));
    const amended = toNoticeRow(notice({ closingDate: "2026-10-19" }), at("2026-09-25T20:00:00Z"));
    expect(same.fingerprint).toBe(base.fingerprint);
    expect(amended.fingerprint).not.toBe(base.fingerprint);
    // `last_seen_at` is NOT part of the fingerprint (it is the timestamp refresh).
    expect(base.naturalKey).toBe(toNoticeRow(notice(), at("2026-09-27T20:00:00Z")).naturalKey);
  });
});
