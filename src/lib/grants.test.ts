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
  COUNT_SCAN_ROWS,
  FUNDING_CATEGORIES,
  GRANTS_OFFICIAL_URL_BASE,
  GRANTS_PRICE_LABEL,
  GRANTS_SOURCE_LABEL,
  GRANTS_STATUSES,
  GRANTS_UPGRADE_FLAG_ENV,
  GRANT_DERIVED_LABELS,
  MAX_KEYWORD_LENGTH,
  MAX_PAGE,
  NOT_SPECIFIED,
  OPP_STATUSES_BY_FILTER,
  PAGE_SIZE,
  PREVIEW_LIMIT,
  SOURCE_LAST_UPDATED_NOT_CHECKED,
  SOURCE_LAST_UPDATED_NOT_PUBLISHED,
  applyPreviewCap,
  buildUpstreamSearchBody,
  classifyGrantStatus,
  decodeSourceText,
  describeGrantCount,
  easternDayStart,
  eligibleApplicants,
  filterResultsForStatus,
  formatFundingValue,
  formatSourceDayText,
  fundingDisplay,
  grantDeadlineDisplay,
  grantsCheckoutToastVisible,
  isUpgradePromptEnabled,
  mapGrantResult,
  officialOpportunityUrl,
  parseGrantsSearchParams,
  parseSourceDay,
  parseSourceLongDay,
  sanitizeKeyword,
  startRecordForPage,
  tallyGrantStatuses,
  toPlainText,
  type GrantResult,
  type GrantsSearchParams,
  type GrantsUpstreamHit,
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

  test("status defaults to the OPEN filter, and closed/forecast are explicit opt-ins", () => {
    const open = parse({});
    const closed = parse({ status: "closed" });
    const forecast = parse({ status: "forecast" });
    expect(open.ok && open.params.status).toBe("open");
    expect(closed.ok && closed.params.status).toBe("closed");
    expect(forecast.ok && forecast.params.status).toBe("forecast");
    const bad = parse({ status: "archived" });
    expect(bad.ok).toBe(false);
    const bad2 = parse({ status: "posted" });
    expect(bad2.ok).toBe(false);
  });

  test("REGRESSION (owner fix 2026-09-18): the open filter is `posted` ALONE — never forecasted", () => {
    const value = OPP_STATUSES_BY_FILTER.open;
    expect(value).toBe("posted");
    // This assertion INVERTED on 2026-09-18. "posted|forecasted" is the
    // Grants.gov search UI's own default and is what put MP-CPI-25-001/003
    // (FY2025 forecasts, estimated response dates Jun 23 / Jul 1 2025) into the
    // Open results. Forecasts are not open for applications.
    expect(value).not.toContain("forecasted");
    expect(value).not.toContain("forecast");
    expect(value).not.toContain("closed");
    expect(value).not.toContain("archived");
    // Forecasts get their own filter; closed stays closed-only (no archived leak).
    expect(OPP_STATUSES_BY_FILTER.forecast).toBe("forecasted");
    expect(OPP_STATUSES_BY_FILTER.closed).toBe("closed");
    // Every filter maps to exactly ONE upstream status, so upstream's hitCount is
    // an exact count for that status (the Open count still needs local filtering
    // for the deadline rule — see the freshness tests below).
    for (const s of GRANTS_STATUSES) {
      expect(OPP_STATUSES_BY_FILTER[s]).not.toContain("|");
    }
    expect([...GRANTS_STATUSES]).toEqual(["open", "forecast", "closed"]);
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

  test("the count scan can widen the window without changing the visitor body", () => {
    const visitor = buildUpstreamSearchBody(params());
    // No overrides ⇒ byte-identical to the pre-2026-09-18 body.
    expect(buildUpstreamSearchBody(params(), {})).toEqual(visitor);
    const scan = buildUpstreamSearchBody(params(), { rows: COUNT_SCAN_ROWS, startRecordNum: 0 });
    expect(scan.rows).toBe(COUNT_SCAN_ROWS);
    expect(scan.startRecordNum).toBe(0);
    // Everything else (filters, status, keyword) is exactly the visitor's.
    expect({ ...scan, rows: visitor.rows, startRecordNum: visitor.startRecordNum }).toEqual(visitor);
    expect(buildUpstreamSearchBody(params({ status: "forecast" })).oppStatuses).toBe("forecasted");
    expect(buildUpstreamSearchBody(params({ status: "closed" })).oppStatuses).toBe("closed");
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

describe("grants: FRESHNESS — Open excludes forecasts, expired and deadline-less rows (owner fix 2026-09-18)", () => {
  // Fixed clock so the suite can never pass/fail because of *when* it ran.
  const NOW = Date.UTC(2026, 8, 18, 12, 0, 0); // 2026-09-18T12:00:00Z

  // ── LIVE_VERIFIED rows (verbatim search2 hits, probed 2026-09-18 17:39 UTC) ──
  /** The owner's report: an FY2025 forecast with estimated deadline Jun 23, 2025. */
  const mpCpi1 = {
    id: "355824",
    number: "MP-CPI-25-001",
    title: "Demonstrations Reducing Dementia Disparities",
    agencyCode: "HHS-OPHS",
    agency: "Office of the Assistant Secretary for Health",
    openDate: "08/01/2024",
    closeDate: "",
    oppStatus: "forecasted",
    docType: "forecast",
  };
  /** The owner's second example (same batch, same shape). */
  const mpCpi3 = {
    id: "355829",
    number: "MP-CPI-25-003",
    title: "Coordinating Center for Language Access Services",
    agencyCode: "HHS-OPHS",
    agency: "Office of the Assistant Secretary for Health",
    openDate: "08/01/2024",
    closeDate: "",
    oppStatus: "forecasted",
    docType: "forecast",
  };
  /** Real forecast detail (fetchOpportunity, id 355824) — note: no synopsis. */
  const mpCpi1Detail = {
    estimatedDeadline: "Jun 23, 2025 12:00:00 AM EDT",
    lastUpdated: "Mar 20, 2025 10:28:30 AM EDT",
    estimatedFunding: "5000000",
    awardCeiling: "600000",
    awardFloor: "450000",
    synopsisDesc: "<p>The Office of Minority Health announces the anticipated availability of funds…</p>",
    applicantTypes: [{ id: "00", description: "State governments" }],
  };
  /** A genuinely open posted opportunity, with a future closeDate. */
  const openPosted = {
    id: "356559",
    number: "GR-RCE-25-001",
    title: "RESTORE Act Centers of Excellence Research Grants Program",
    agencyCode: "USDOT-GCR",
    agency: "U.S. Dept. of Treasury RESTORE Act Program",
    openDate: "09/26/2024",
    closeDate: "10/31/2026",
    oppStatus: "posted",
    docType: "synopsis",
  };
  /** Posted whose closeDate equals the ET "today" — the deadline day is inclusive. */
  const closesToday = {
    id: "363229",
    number: "NOAA-NOS-OCM-2026-33239",
    title: "Coastal resilience",
    openDate: "07/01/2026",
    closeDate: "09/18/2026",
    oppStatus: "posted",
  };
  const expiredPosted = {
    id: "900001",
    number: "OLD-EXPIRED-1",
    title: "Expired posted opportunity",
    openDate: "01/02/2025",
    closeDate: "03/15/2025",
    oppStatus: "posted",
  };
  /** Posted with NO published deadline (real shape: GVA-SGP-2023-002, id 344437). */
  const noDeadline = {
    id: "344437",
    number: "GVA-SGP-2023-002",
    title: "State Grants Program",
    openDate: "11/10/2022",
    closeDate: "",
    oppStatus: "posted",
    docType: "synopsis",
  };

  test("the owner's two examples are forecasts and are NEVER classified open", () => {
    expect(classifyGrantStatus(mpCpi1.oppStatus, mpCpi1.closeDate, NOW)).toBe("forecast");
    expect(classifyGrantStatus(mpCpi3.oppStatus, mpCpi3.closeDate, NOW)).toBe("forecast");
    for (const hit of [mpCpi1, mpCpi3]) {
      const r = mapGrantResult(hit, null, NOW);
      expect(r.derivedStatus).toBe("forecast");
      expect(r.derivedStatus).not.toBe("open");
      // A forecast carries no source closing date at all.
      expect(r.closingDate).toBeNull();
      expect(grantDeadlineDisplay(r)).toBeNull(); // …and we invent none
      expect(filterResultsForStatus([r], "open")).toEqual([]); // never in Open
      expect(filterResultsForStatus([r], "forecast")).toHaveLength(1);
    }
  });

  test("a past ESTIMATE is reported as past but never reclassifies the forecast", () => {
    const r = mapGrantResult(mpCpi1, mpCpi1Detail, NOW);
    expect(r.estimatedDeadline).toBe("Jun 23, 2025");
    expect(r.estimatedDeadlinePassed).toBe(true);
    // The status is still whatever the SOURCE says — an estimate is not evidence.
    expect(r.derivedStatus).toBe("forecast");
    const display = grantDeadlineDisplay(r);
    expect(display?.label).toBe("Estimated application deadline");
    expect(display?.value).toContain("Jun 23, 2025");
    expect(display?.value).toContain("source estimate");
    // The word "Closing" must never label an estimate.
    expect(display?.label).not.toContain("Closing");
    // …and it is still excluded from Open.
    expect(filterResultsForStatus([r], "open")).toEqual([]);
  });

  test("a FUTURE estimate is still not open — it waits in Forecast", () => {
    const future = mapGrantResult(
      { ...mpCpi3, id: "360000", number: "FUTURE-26-001" },
      { estimatedDeadline: "Dec 01, 2027 12:00:00 AM EST" },
      NOW,
    );
    expect(future.derivedStatus).toBe("forecast");
    expect(future.estimatedDeadlinePassed).toBe(false);
    expect(filterResultsForStatus([future], "open")).toEqual([]);
    expect(filterResultsForStatus([future], "forecast")).toHaveLength(1);
  });

  test("expired posted grant: past closeDate is never Open, and is labelled 'Deadline passed'", () => {
    const r = mapGrantResult(expiredPosted, null, NOW);
    expect(r.derivedStatus).toBe("expired");
    expect(filterResultsForStatus([r], "open")).toEqual([]);
    const display = grantDeadlineDisplay(r);
    expect(display).toEqual({ label: "Deadline passed", value: "03/15/2025" });
  });

  test("missing deadline: posted with no closeDate is conservatively NOT open", () => {
    const r = mapGrantResult(noDeadline, null, NOW);
    expect(r.derivedStatus).toBe("unconfirmed");
    expect(filterResultsForStatus([r], "open")).toEqual([]);
    // …and it is reported as an exclusion instead of vanishing.
    expect(tallyGrantStatuses([noDeadline], NOW).missingDeadline).toBe(1);
    expect(tallyGrantStatuses([noDeadline], NOW).open).toBe(0);
  });

  test("the ET day boundary is INCLUSIVE of the deadline day", () => {
    // 2026-09-18T12:00Z → still 2026-09-18 in ET.
    expect(classifyGrantStatus("posted", "09/18/2026", NOW)).toBe("open");
    expect(classifyGrantStatus("posted", "09/17/2026", NOW)).toBe("expired");
    // 2026-09-19T02:00Z is 2026-09-18 22:00 ET — the 09/18 deadline has NOT passed.
    const lateEveningET = Date.UTC(2026, 8, 19, 2, 0, 0);
    expect(classifyGrantStatus("posted", "09/18/2026", lateEveningET)).toBe("open");
    // 2026-09-19T05:00Z is 2026-09-19 01:00 ET — now it has.
    expect(classifyGrantStatus("posted", "09/18/2026", Date.UTC(2026, 8, 19, 5, 0, 0))).toBe(
      "expired",
    );
    // easternDayStart returns the ET calendar day at UTC midnight (documented).
    expect(easternDayStart(NOW)).toBe(Date.UTC(2026, 8, 18));
    expect(easternDayStart(lateEveningET)).toBe(Date.UTC(2026, 8, 18));
    expect(easternDayStart(Date.UTC(2026, 8, 19, 5, 0, 0))).toBe(Date.UTC(2026, 8, 19));
  });

  test("AMENDED deadline: the source's CURRENT closeDate is the one we use", () => {
    // Live 2026-09-18: id 363657 was amended from 10/05/2026 to 10/15/2026 — the
    // search2 hit carries the amended date, and the detail carries the amendment
    // trail (originalDueDate 10/05/2026 + synopsis.lastUpdatedDate "Sep 09,
    // 2026"; the comment field was empty, so we rely only on the source dates).
    const amended = {
      id: "363657",
      number: "EPA-OW-OWM-26-03",
      title: "Innovative Water Infrastructure Workforce Development Grant",
      openDate: "08/19/2026",
      closeDate: "10/15/2026",
      oppStatus: "posted",
    };
    const r = mapGrantResult(
      amended,
      { lastUpdated: "Sep 09, 2026 11:09:00 AM EDT", estimatedFunding: "10800000" },
      NOW,
    );
    expect(r.closingDate).toBe("10/15/2026"); // the amended, live value
    expect(r.derivedStatus).toBe("open");
    expect(r.sourceLastUpdated).toBe("Sep 09, 2026");
    // The pre-amendment date is NOT used: a stale 10/05/2026 would have been
    // wrong in neither direction here, so assert the source of truth directly.
    expect(grantDeadlineDisplay(r)).toEqual({
      label: "Closing date",
      value: "10/15/2026",
    });
  });

  test("an amendment that moves a deadline into the past is honoured too", () => {
    // Same opportunity number, source now says the deadline already passed: we
    // follow the source and drop it from Open (no cached/vendor copy anywhere —
    // there is no grants storage, so the live field is always the answer).
    const amendedPast = { ...expiredPosted, closeDate: "09/01/2026" };
    expect(classifyGrantStatus("posted", amendedPast.closeDate, NOW)).toBe("expired");
    const asOpen = mapGrantResult({ ...amendedPast, id: "900002" }, null, NOW);
    expect(filterResultsForStatus([asOpen], "open")).toEqual([]);
  });

  test("source status is the only authority: no status value we do not recognise is ever open", () => {
    expect(classifyGrantStatus(undefined, "10/31/2026", NOW)).toBe("unconfirmed");
    expect(classifyGrantStatus("", "10/31/2026", NOW)).toBe("unconfirmed");
    expect(classifyGrantStatus("archived", "10/31/2026", NOW)).toBe("unconfirmed");
    expect(classifyGrantStatus("Posted ", "10/31/2026", NOW)).toBe("open"); // trims, case-insensitive
    expect(classifyGrantStatus("closed", "10/31/2026", NOW)).toBe("closed");
    // A posted row with an unparseable date is unconfirmed, not open.
    expect(classifyGrantStatus("posted", "31/12/2026", NOW)).toBe("unconfirmed");
    expect(classifyGrantStatus("posted", null, NOW)).toBe("unconfirmed");
    expect(parseSourceDay("10/15/2026")).toBe(Date.UTC(2026, 9, 15));
    expect(parseSourceDay("13/15/2026")).toBeNull();
    expect(parseSourceDay("")).toBeNull();
    expect(parseSourceDay(undefined)).toBeNull();
    expect(parseSourceDay(20261015)).toBeNull();
  });

  test("the OPEN COUNT excludes forecasts, expired rows and deadline-less rows", () => {
    const window: GrantsUpstreamHit[] = [
      openPosted,
      closesToday,
      mpCpi1,
      mpCpi3,
      expiredPosted,
      noDeadline,
    ];
    const tally = tallyGrantStatuses(window, NOW);
    expect(tally).toEqual({
      open: 2, // openPosted + closesToday (deadline day inclusive)
      expired: 1,
      forecast: 2,
      closed: 0,
      unconfirmed: 1,
      expiredPosted: 1,
      missingDeadline: 1,
    });
    // The corrected count (2) is strictly less than the raw upstream count (6),
    // which is exactly the bug: "Open" used to mean `posted|forecasted`.
    expect(tally.open).toBeLessThan(window.length);
    // Closed rows stay countable under closed.
    expect(tallyGrantStatuses([{ oppStatus: "closed", closeDate: "01/01/2025" }], NOW).closed).toBe(1);
    // The scan window is respected by the count strategy constant.
    expect(COUNT_SCAN_ROWS).toBeGreaterThanOrEqual(PAGE_SIZE * MAX_PAGE);
  });

  test("the excluded-forecast figure cannot come from the `posted`-only scan", () => {
    // The Open tab's scan asks upstream for `posted` ALONE, so a forecast row can
    // never appear in it: a tally over that window reports 0 forecasts. The page
    // therefore sources "N forecasted — see the Forecast filter" from the
    // source's own `forecasted` hitCount (search.ts handler), never from this
    // tally. Pinned here so the two can never be silently swapped back, which
    // would print "0 forecasted" above a reduced open count — a false statement,
    // since the live forecasted corpus is not empty (590 rows on 2026-09-18).
    const postedOnlyWindow: GrantsUpstreamHit[] = [
      openPosted,
      closesToday,
      expiredPosted,
      noDeadline,
    ];
    const postedTally = tallyGrantStatuses(postedOnlyWindow, NOW);
    expect(postedTally.forecast).toBe(0);
    expect(postedTally.open).toBe(2);
    // Same rows, but with the two real forecasts of the incident added the way
    // the OLD `posted|forecasted` window had them: the tally does see them.
    const oldWindow: GrantsUpstreamHit[] = [...postedOnlyWindow, mpCpi1, mpCpi3];
    expect(tallyGrantStatuses(oldWindow, NOW).forecast).toBe(2);
  });

  test("count copy is honest: exact vs lower bound vs singular", () => {
    expect(describeGrantCount("open", 465, true)).toBe("465 posted opportunities accepting applications");
    expect(describeGrantCount("open", 465, false)).toBe(
      "465+ posted opportunities accepting applications",
    );
    expect(describeGrantCount("open", 1, true)).toBe("1 posted opportunity accepting applications");
    expect(describeGrantCount("forecast", 314, true)).toBe(
      "314 forecasted opportunities — not yet open for applications",
    );
    expect(describeGrantCount("closed", 8689, true)).toBe("8,689 closed opportunities");
  });

  test("deadline display never lets an estimated date be a Closing date", () => {
    const base = { closingDate: "10/31/2026", estimatedDeadline: "Jun 23, 2025" };
    expect(grantDeadlineDisplay({ ...base, derivedStatus: "open" })).toEqual({
      label: "Closing date",
      value: "10/31/2026",
    });
    expect(grantDeadlineDisplay({ ...base, derivedStatus: "closed" })).toEqual({
      label: "Closing date",
      value: "10/31/2026",
    });
    expect(grantDeadlineDisplay({ ...base, derivedStatus: "expired" })).toEqual({
      label: "Deadline passed",
      value: "10/31/2026",
    });
    expect(grantDeadlineDisplay({ ...base, derivedStatus: "forecast" })?.label).toBe(
      "Estimated application deadline",
    );
    // A forecast with no source estimate gets NO date row at all.
    expect(
      grantDeadlineDisplay({ derivedStatus: "forecast", closingDate: null, estimatedDeadline: null }),
    ).toBeNull();
    expect(
      grantDeadlineDisplay({ derivedStatus: "unconfirmed", closingDate: null, estimatedDeadline: null }),
    ).toEqual({ label: "Closing date", value: NOT_SPECIFIED });
  });

  test("a card can only ever be shown under the status the source confirms for it", () => {
    const rows = [openPosted, mpCpi1, expiredPosted, noDeadline, { ...openPosted, id: "x", oppStatus: "closed" }];
    const mapped = rows.map((h, i) => mapGrantResult({ ...h, id: String(900000 + i) }, null, NOW));
    for (const status of GRANTS_STATUSES) {
      const kept = filterResultsForStatus(mapped, status);
      for (const r of kept) {
        expect(r.derivedStatus).toBe(status === "open" ? "open" : status === "forecast" ? "forecast" : "closed");
        expect(GRANT_DERIVED_LABELS[r.derivedStatus].length).toBeGreaterThan(0);
      }
    }
    // Every mapped row is either in exactly ONE tab, or is one of the two
    // statuses that deliberately has no tab (expired / unconfirmed) — nothing is
    // silently dropped and nothing lands in two places.
    const tabbed = mapped.filter(
      (r) => GRANTS_STATUSES.filter((s) => filterResultsForStatus([r], s).length === 1).length === 1,
    );
    const untabbed = mapped.filter(
      (r) => r.derivedStatus === "expired" || r.derivedStatus === "unconfirmed",
    );
    expect(tabbed.length + untabbed.length).toBe(mapped.length);
    expect(untabbed.map((r) => r.derivedStatus).sort()).toEqual(["expired", "unconfirmed"]);
  });

  test("'Source last updated' distinguishes published / not published / not checked", () => {
    expect(formatSourceDayText("Sep 09, 2026 11:09:00 AM EDT")).toBe("Sep 09, 2026");
    expect(formatSourceDayText("Mar 20, 2025 10:28:30 AM EDT")).toBe("Mar 20, 2025");
    expect(formatSourceDayText("")).toBeNull();
    expect(formatSourceDayText(undefined)).toBeNull();
    expect(formatSourceDayText("not a date")).toBeNull();
    // The long form (fetchOpportunity's own format) is parsed for comparisons.
    expect(parseSourceLongDay("Jun 23, 2025 12:00:00 AM EDT")).toBe(Date.UTC(2025, 5, 23));
    expect(parseSourceLongDay("Sep 30, 2025 11:10:44 AM EDT")).toBe(Date.UTC(2025, 8, 30));
    expect(parseSourceLongDay("nonsense")).toBeNull();
    expect(parseSourceLongDay(undefined)).toBeNull();

    const checked = mapGrantResult(openPosted, { lastUpdated: "Sep 30, 2025 11:10:44 AM EDT" }, NOW);
    expect(checked.sourceLastUpdated).toBe("Sep 30, 2025");
    expect(checked.sourceLastUpdatedKnown).toBe(true);

    // Detail retrieved, source published no stamp ⇒ "Not published".
    const checkedNoValue = mapGrantResult(openPosted, { estimatedFunding: "1000" }, NOW);
    expect(checkedNoValue.sourceLastUpdated).toBeNull();
    expect(checkedNoValue.sourceLastUpdatedKnown).toBe(true);
    expect(SOURCE_LAST_UPDATED_NOT_PUBLISHED).toBe("Not published");

    // Detail never fetched (beyond the enrichment limit) ⇒ "Not checked" — an
    // honest, different statement; we must not claim the source omitted it.
    const unchecked = mapGrantResult(openPosted, null, NOW);
    expect(unchecked.sourceLastUpdated).toBeNull();
    expect(unchecked.sourceLastUpdatedKnown).toBe(false);
    expect(SOURCE_LAST_UPDATED_NOT_CHECKED).toBe("Not checked");
    expect(SOURCE_LAST_UPDATED_NOT_PUBLISHED).not.toBe(SOURCE_LAST_UPDATED_NOT_CHECKED);
  });

  test("open rows keep their real funding/eligibility/description (no regression)", () => {
    const r: GrantResult = mapGrantResult(openPosted, {
      estimatedFunding: "14518510",
      awardCeiling: "14518510",
      awardFloor: "5710210",
      applicantTypes: [{ id: "00", description: "State governments" }],
      synopsisDesc: "<p>Trust Fund amounts are available…</p>",
    }, NOW);
    expect(r.derivedStatus).toBe("open");
    expect(r.estimatedFunding).toBe("Est. $14,518,510");
    expect(r.eligibleApplicants).toEqual(["State governments"]);
    expect(r.description?.startsWith("Trust Fund amounts")).toBe(true);
    expect(r.agency).toBe("U.S. Dept. of Treasury RESTORE Act Program");
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
describe("grants: ?checkout=success toast is gated on real entitlement (QA 09-17)", () => {
  test("the param ALONE never justifies a 'subscription is set up' toast", () => {
    // Anonymous URL fiddler: no subscription → the param must claim nothing.
    expect(grantsCheckoutToastVisible({ checkoutParam: "success", subscribed: false })).toBe(
      false,
    );
  });
  test("only a server-reported subscription shows the toast", () => {
    expect(grantsCheckoutToastVisible({ checkoutParam: "success", subscribed: true })).toBe(
      true,
    );
  });
  test("no param, a cancel param, or a bogus object never shows the toast", () => {
    expect(grantsCheckoutToastVisible({ checkoutParam: null, subscribed: true })).toBe(false);
    expect(grantsCheckoutToastVisible({ checkoutParam: "cancel", subscribed: true })).toBe(
      false,
    );
    expect(
      grantsCheckoutToastVisible({
        checkoutParam: "success",
        // A truthy-but-not-true value (a string straight off a URL) is not
        // entitlement evidence.
        subscribed: "yes" as unknown as boolean,
      }),
    ).toBe(false);
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
