/**
 * Contrax Grants V1 — pure-logic unit tests (bun test).
 *
 * Covers the acceptance-critical rules that must never depend on the network:
 * parameter validation + closed lists, upstream body construction, result mapping
 * incl. the "Not specified" funding/eligibility fallbacks, the anonymous
 * 3-preview cap, the closed-by-default status filter, and the isolation of the
 * six grants_* analytics events from every funnel definition.
 *
 * The one fixture marked LIVE_VERIFIED is a trimmed, verbatim excerpt of a real
 * 2026-09-16 Grants.gov response (search2 hit + fetchOpportunity synopsis), so the
 * mapper is proven against the source's ACTUAL field shape without a network call.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENCIES,
  APPLICANT_TYPES,
  FUNDING_CATEGORIES,
  GRANTS_OFFICIAL_URL_BASE,
  GRANTS_PRICE_LABEL,
  GRANTS_SOURCE_LABEL,
  GRANTS_UPGRADE_FLAG_ENV,
  MAX_KEYWORD_LENGTH,
  MAX_PAGE,
  NOT_SPECIFIED,
  OPP_STATUSES_BY_FILTER,
  PAGE_SIZE,
  PREVIEW_LIMIT,
  applyPreviewCap,
  buildUpstreamSearchBody,
  decodeSourceText,
  eligibleApplicants,
  formatFundingValue,
  fundingDisplay,
  isUpgradePromptEnabled,
  mapGrantResult,
  officialOpportunityUrl,
  parseGrantsSearchParams,
  sanitizeKeyword,
  startRecordForPage,
  toPlainText,
  type GrantsSearchParams,
} from "./grants";
import { GRANTS_EVENT_NAMES } from "./grants-analytics";

const params = (over: Partial<GrantsSearchParams> = {}): GrantsSearchParams => ({
  keyword: "",
  applicantType: null,
  fundingCategory: null,
  agency: null,
  status: "open",
  page: 1,
  ...over,
});

function parse(query: Record<string, string>) {
  const sp = new URLSearchParams(query);
  return parseGrantsSearchParams(sp);
}

describe("grants: parameter validation (closed lists + bounds)", () => {
  test("empty query → open status, page 1, no filters", () => {
    const r = parseGrantsSearchParams(new URLSearchParams());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params).toEqual({
      keyword: "",
      applicantType: null,
      fundingCategory: null,
      agency: null,
      status: "open",
      page: 1,
    });
  });

  test("status defaults to the OPEN filter, and closed is an explicit opt-in", () => {
    const open = parse({});
    const closed = parse({ status: "closed" });
    expect(open.ok && open.params.status).toBe("open");
    expect(closed.ok && closed.params.status).toBe("closed");
    const bad = parse({ status: "archived" });
    expect(bad.ok).toBe(false);
  });

  test("closed-by-default: the open filter never includes closed/archived upstream", () => {
    const value = OPP_STATUSES_BY_FILTER.open;
    expect(value).toContain("posted");
    expect(value).toContain("forecasted");
    expect(value).not.toContain("closed");
    expect(value).not.toContain("archived");
    // The closed filter is closed-only (no leakage of the archived bucket).
    expect(OPP_STATUSES_BY_FILTER.closed).toBe("closed");
  });

  test("escapes/normalises the keyword and rejects an over-long one", () => {
    const ok = parse({ keyword: "  water   infrastructure\n " });
    expect(ok.ok && ok.params.keyword).toBe("water infrastructure");
    expect(sanitizeKeyword("a\u0000b\tc")).toBe("a b c");
    const tooLong = parse({ keyword: "x".repeat(MAX_KEYWORD_LENGTH + 1) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toContain(String(MAX_KEYWORD_LENGTH));
    const atLimit = parse({ keyword: "y".repeat(MAX_KEYWORD_LENGTH) });
    expect(atLimit.ok).toBe(true);
  });

  test("rejects values outside every closed enum (hard 400, never coerced)", () => {
    expect(parse({ applicantType: "03" }).ok).toBe(false); // not a Grants.gov code
    expect(parse({ fundingCategory: "ZZ" }).ok).toBe(false);
    expect(parse({ agency: "FAKE-AGENCY" }).ok).toBe(false);
    expect(parse({ agency: "<script>" }).ok).toBe(false);
    expect(parse({ page: "0" }).ok).toBe(false);
    expect(parse({ page: "-1" }).ok).toBe(false);
    expect(parse({ page: "abc" }).ok).toBe(false);
    expect(parse({ page: String(MAX_PAGE + 1) }).ok).toBe(false);
  });

  test("accepts every documented enum value and the last allowed page", () => {
    for (const o of APPLICANT_TYPES) expect(parse({ applicantType: o.value }).ok).toBe(true);
    for (const o of FUNDING_CATEGORIES) expect(parse({ fundingCategory: o.value }).ok).toBe(true);
    for (const o of AGENCIES) expect(parse({ agency: o.value }).ok).toBe(true);
    const last = parse({ page: String(MAX_PAGE) });
    expect(last.ok && last.params.page).toBe(MAX_PAGE);
    expect(parse({ page: "" }).ok).toBe(true); // blank → default page 1
  });

  test("closed lists have no duplicate codes and are non-trivial", () => {
    for (const list of [APPLICANT_TYPES, FUNDING_CATEGORIES, AGENCIES]) {
      const values = list.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      expect(list.length).toBeGreaterThan(10);
      for (const o of list) expect(o.label.length).toBeGreaterThan(0);
    }
  });
});

describe("grants: upstream request construction", () => {
  test("page N maps to the right startRecordNum with a fixed page size", () => {
    expect(startRecordForPage(1)).toBe(0);
    expect(startRecordForPage(2)).toBe(PAGE_SIZE);
    expect(startRecordForPage(MAX_PAGE)).toBe((MAX_PAGE - 1) * PAGE_SIZE);
    expect(buildUpstreamSearchBody(params({ page: 3 })).rows).toBe(PAGE_SIZE);
    expect(buildUpstreamSearchBody(params({ page: 3 })).startRecordNum).toBe(2 * PAGE_SIZE);
  });

  test("only chosen filters are sent (an empty enum would mean 'no restriction')", () => {
    const bare = buildUpstreamSearchBody(params());
    expect(Object.keys(bare).sort()).toEqual(["keyword", "oppStatuses", "rows", "startRecordNum"]);
    const full = buildUpstreamSearchBody(
      params({
        keyword: "workforce",
        applicantType: "23",
        fundingCategory: "HL",
        agency: "EPA",
        status: "closed",
      }),
    );
    expect(full).toEqual({
      keyword: "workforce",
      oppStatuses: "closed",
      rows: PAGE_SIZE,
      startRecordNum: 0,
      eligibilities: "23",
      fundingCategories: "HL",
      agencies: "EPA",
    });
  });
});

describe("grants: 'Not specified' honesty rules", () => {
  test("missing/placeholder funding maps to null (→ Not specified), never 0", () => {
    expect(formatFundingValue(undefined)).toBeNull();
    expect(formatFundingValue(null)).toBeNull();
    expect(formatFundingValue("")).toBeNull();
    expect(formatFundingValue("none")).toBeNull(); // real Grants.gov value
    expect(formatFundingValue("N/A")).toBeNull();
    expect(formatFundingValue("0")).toBeNull();
    expect(formatFundingValue(0)).toBeNull();
    expect(formatFundingValue("abc")).toBeNull();
    expect(formatFundingValue("7800000")).toBe("$7,800,000");
    expect(formatFundingValue(10800000)).toBe("$10,800,000");
  });

  test("fundingDisplay prefers a published estimate, else a published range", () => {
    expect(fundingDisplay(null)).toBeNull();
    expect(fundingDisplay({})).toBeNull();
    expect(fundingDisplay({ estimatedFunding: "10800000" })).toBe("Est. $10,800,000");
    expect(fundingDisplay({ awardCeiling: "7800000", awardFloor: "none" })).toBe("Up to $7,800,000");
    expect(fundingDisplay({ awardCeiling: "500000", awardFloor: "100000" })).toBe(
      "$100,000 – $500,000",
    );
    expect(fundingDisplay({ awardCeiling: "none", awardFloor: "none" })).toBeNull();
  });

  test("eligible applicants: only source-supplied descriptions, [] otherwise", () => {
    expect(eligibleApplicants(null)).toEqual([]);
    expect(eligibleApplicants({})).toEqual([]);
    expect(eligibleApplicants({ applicantTypes: "nope" })).toEqual([]);
    expect(
      eligibleApplicants({
        applicantTypes: [
          { id: "25", description: "Others (see text field)" },
          { id: "23", description: "Small businesses" },
          { id: "23", description: "Small businesses" }, // de-duped
          { id: "99", description: "   " }, // blank dropped
        ],
      }),
    ).toEqual(["Others (see text field)", "Small businesses"]);
  });

  test("source HTML is reduced to plain text (no markup can reach the DOM)", () => {
    expect(toPlainText("<p>Hello &ndash; world</p>")).toBe("Hello – world");
    expect(toPlainText("A &amp; B")).toBe("A & B");
    // Entity-decoded tag-like text is stripped too (tags are removed BOTH before
    // and after decoding, so nothing that looks like markup survives).
    expect(toPlainText("A &amp; B &lt;c&gt;")).toBe("A & B");
    expect(toPlainText("<script>alert(1)</script>Real")).toBe("Real");
    expect(toPlainText("&#x41;&#66;")).toBe("AB");
    expect(toPlainText(undefined)).toBe("");
    const long = toPlainText("word ".repeat(200));
    expect(long.length).toBeLessThanOrEqual(401);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("grants: result mapping (LIVE_VERIFIED fixture)", () => {
  // Verbatim excerpt of the real 2026-09-16 Grants.gov responses.
  const hit = {
    id: "363657",
    number: "EPA-OW-OWM-26-03",
    title: "Innovative Water Infrastructure Workforce Development Grant",
    agencyCode: "EPA",
    agency: "Environmental Protection Agency",
    openDate: "08/19/2026",
    closeDate: "10/15/2026",
    oppStatus: "posted",
    docType: "synopsis",
  };
  const detail = {
    awardFloor: "none",
    awardCeiling: "7800000",
    estimatedFunding: "10800000",
    applicantTypes: [{ id: "25", description: "Others (see text field)" }],
    synopsisDesc: "<p>The U.S. Environmental Protection Agency (EPA) is soliciting applications…</p>",
  };

  test("maps a real source hit into a labelled card", () => {
    const r = mapGrantResult(hit, detail);
    expect(r.title).toBe("Innovative Water Infrastructure Workforce Development Grant");
    expect(r.agency).toBe("Environmental Protection Agency");
    expect(r.opportunityNumber).toBe("EPA-OW-OWM-26-03");
    expect(r.postedDate).toBe("08/19/2026");
    expect(r.closingDate).toBe("10/15/2026");
    expect(r.status).toBe("posted");
    expect(r.estimatedFunding).toBe("Est. $10,800,000");
    expect(r.eligibleApplicants).toEqual(["Others (see text field)"]);
    expect(r.description?.startsWith("The U.S. Environmental Protection Agency")).toBe(true);
    expect(r.source).toBe(GRANTS_SOURCE_LABEL);
    expect(r.source).toBe("Grants.gov");
  });

  test("official link is built from the real numeric opportunity id", () => {
    expect(mapGrantResult(hit, detail).officialUrl).toBe(
      "https://www.grants.gov/search-results-detail/363657",
    );
    expect(officialOpportunityUrl("363657")).toBe(`${GRANTS_OFFICIAL_URL_BASE}363657`);
    expect(officialOpportunityUrl(363657)).toBe(`${GRANTS_OFFICIAL_URL_BASE}363657`);
  });

  test("never fabricates a link for an unusable id (no guessed URLs)", () => {
    expect(officialOpportunityUrl("EPA-OW-OWM-26-03")).toBeNull(); // number, not id
    expect(officialOpportunityUrl(undefined)).toBeNull();
    expect(officialOpportunityUrl("abc/def")).toBeNull();
    const r = mapGrantResult({ id: "not-an-id", title: "T" }, null);
    expect(r.officialUrl).toBeNull();
  });

  test("an unfetchable/unavailable detail renders Not specified everywhere, not invented data", () => {
    const r = mapGrantResult(hit, null);
    expect(r.estimatedFunding).toBeNull();
    expect(r.eligibleApplicants).toEqual([]);
    expect(r.description).toBeNull();
    // The hit's own fields still render (they came from the source).
    expect(r.title).toBe(hit.title);
    expect(r.postedDate).toBe("08/19/2026");
  });

  test("a hit with no fields at all degrades to Not specified rather than blanks/undefined", () => {
    const r = mapGrantResult({}, null);
    expect(r.title).toBe(NOT_SPECIFIED);
    expect(r.opportunityNumber).toBe(NOT_SPECIFIED);
    expect(r.agency).toBe(NOT_SPECIFIED);
    expect(r.postedDate).toBeNull();
    expect(r.closingDate).toBeNull();
    expect(r.description).toBeNull();
    expect(r.officialUrl).toBeNull();
  });

  test("REGRESSION (live 2026-09-16): HTML entities in titles/agency are decoded, not shown raw", () => {
    // Real oppHits.title from the live search2 response.
    const r = mapGrantResult(
      {
        id: "334905",
        number: "RANDENDEPSTEMFY22RFI",
        title:
          "National Defense Education Program (NDEP) STEM Consortia RFI for the Office of the Under Secretary of Defense (Research &amp; Engineering)",
        agency: "Department of Defense",
      },
      null,
    );
    expect(r.title).toContain("(Research & Engineering)");
    expect(r.title).not.toContain("&amp;");
    expect(decodeSourceText("Q&A &ndash; R&amp;D")).toBe("Q&A – R&D");
  });
});

describe("grants: anonymous preview cap (1 search / 3 previews)", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  test(`anonymous is capped at ${PREVIEW_LIMIT} cards`, () => {
    expect(applyPreviewCap(rows, false).length).toBe(PREVIEW_LIMIT);
    expect(applyPreviewCap(rows, false)).toEqual([1, 2, 3]);
    expect(applyPreviewCap([1, 2], false)).toEqual([1, 2]); // fewer than the cap is fine
    expect(applyPreviewCap([], false)).toEqual([]);
  });

  test("an authenticated visitor gets the full page", () => {
    expect(applyPreviewCap(rows, true).length).toBe(rows.length);
    expect(PREVIEW_LIMIT).toBeLessThan(PAGE_SIZE);
  });
});

describe("grants: $19 upgrade flag is DISABLED by default", () => {
  test("absent/falsey/unknown env values keep the prompt OFF", () => {
    expect(isUpgradePromptEnabled({})).toBe(false);
    expect(isUpgradePromptEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "" })).toBe(false);
    expect(isUpgradePromptEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "false" })).toBe(false);
    expect(isUpgradePromptEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "no" })).toBe(false);
    expect(isUpgradePromptEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "0" })).toBe(false);
    expect(isUpgradePromptEnabled({ GRANTS_UPGRADE_PROMPT_ENABLED_EXTRA: "true" })).toBe(false);
  });

  test("an explicit true/1 turns it on", () => {
    expect(isUpgradePromptEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "true" })).toBe(true);
    expect(isUpgradePromptEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: "TRUE" })).toBe(true);
    expect(isUpgradePromptEnabled({ [GRANTS_UPGRADE_FLAG_ENV]: " 1 " })).toBe(true);
  });

  test("the displayed price copy is the owner's exact string", () => {
    expect(GRANTS_PRICE_LABEL).toBe("$19/month");
  });
});

describe("grants: ISOLATION — the six events never enter a funnel", () => {
  const repoSrc = join(import.meta.dir, "..");
  const funnelFiles = [
    "lib/tracking-intake.ts",
    "lib/radar-conversion-funnel.ts",
    "lib/radar-leads-funnel.ts",
    "lib/bid-scout-funnel.ts",
    "lib/autopsy-funnel.ts",
    "routes/api/admin/unified-funnel.ts",
    "routes/api/admin/journeys.ts",
  ];

  test("exactly the six owner-named grants events exist, all grants_-prefixed", () => {
    expect(GRANTS_EVENT_NAMES).toEqual([
      "grants_page_viewed",
      "grants_search_started",
      "grants_search_completed",
      "grants_search_failed",
      "grants_result_opened",
      "grants_upgrade_clicked",
    ]);
    for (const name of GRANTS_EVENT_NAMES) expect(name.startsWith("grants_")).toBe(true);
    expect(new Set(GRANTS_EVENT_NAMES).size).toBe(6);
  });

  test("no funnel source file references a grants event (source-text proof)", () => {
    let checked = 0;
    for (const rel of funnelFiles) {
      const path = join(repoSrc, rel);
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      for (const name of GRANTS_EVENT_NAMES) {
        expect(text.includes(name)).toBe(false);
      }
      checked += 1;
    }
    // The guard is non-vacuous: it must actually have read the funnel sources.
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});
