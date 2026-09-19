/**
 * NATIONWIDE CONTINUOUS WORKSTREAM — next-12 tranche fixture tests.
 *
 * States land in this file one at a time, in the build spec's order (§F), each
 * one COMMITTED only with its own fixture tests green. Every fixture here is a
 * trimmed REAL page captured live with the bot UA; the zero-network tripwire
 * below proves the whole file is deterministic and offline.
 *
 * The traps this file pins for the states landed so far:
 *   - New Hampshire: the Division's "Applicants Notified:" value is NOT a
 *     deadline; four ROUNDS are four separate records, each with its own date;
 *     a passed round is `closed` on a still-live page.
 *   - Montana: "will open X and close on Y" is read as its two ordered ends; a
 *     year-less or unreadable end yields NO date; a passed cycle is `closed`.
 *   - Indiana: ONE row of a cycle's own timeline table is the deadline
 *     ("Application Due"); the draft-review / funding-notification / final-report
 *     rows and the "Grant Period" activity period are NEVER deadlines; a
 *     struck-through (<del>) value is the Commission's own superseded value; every
 *     record comes from its OWN child page (the hub is a 0-date catalogue).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type GrantOpportunity,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { newHampshireConnector } from "~/lib/state-grants/connectors/new-hampshire";
import {
  MARYLAND_SOURCE_URL,
  marylandConnector,
} from "~/lib/state-grants/connectors/maryland";
import { montanaConnector } from "~/lib/state-grants/connectors/montana";
import { texasConnector } from "~/lib/state-grants/connectors/texas";
import { joinSourcePages } from "~/lib/state-grants/connectors/multi-page";
import {
  INDIANA_SOURCE_URL,
  indianaConnector,
  indianaFundingPrograms,
} from "~/lib/state-grants/connectors/indiana";
import {
  FLORIDA_DEADLINE_LABEL,
  FLORIDA_MAX_CHILD_PAGES,
  FLORIDA_PROGRAM_PATH_PREFIX,
  FLORIDA_SOURCE_URL,
  FLORIDA_STATUS_MARKER,
  floridaConnector,
  floridaGrantPrograms,
} from "~/lib/state-grants/connectors/florida";

/** One fixed clock for every classification below (2026-09-19, US Eastern). */
const NOW = new Date("2026-09-19T12:00:00Z");
const TODAY = "2026-09-19";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}
function parse(connector: StateGrantConnector<string>, name: string): GrantOpportunity[] {
  return parseGrantOpportunities(connector, fixture(name), NOW).opportunities;
}
const NH_FILE = "new-hampshire-jpp-program.html";
const MT_FILE = "montana-commerce-tourism-grant-program.html";
const NH = () => parse(newHampshireConnector, NH_FILE);
const MT = () => parse(montanaConnector, MT_FILE);
const TX_FILE = "texas-deaag-grant-program.html";
const TX = () => parse(texasConnector, TX_FILE);

/**
 * Indiana is a MULTI-PAGE source: the hub plus every funding programme page the
 * hub publishes, concatenated with the shared delimiters. The fixture for each
 * fetched page is its own trimmed real capture.
 */
const IN_FILES = {
  index: "indiana-arts-commission-funding.html",
  artsProjectSupport: "indiana-arts-project-support.html",
  artsOrganizationSupport: "indiana-arts-organization-support.html",
  everyCountyFunded: "indiana-every-county-funded.html",
  america250: "indiana-america250.html",
} as const;
const IN_CHILD_URLS = {
  artsProjectSupport: `${INDIANA_SOURCE_URL}arts-project-support`,
  artsOrganizationSupport: `${INDIANA_SOURCE_URL}arts-organization-support`,
  everyCountyFunded: `${INDIANA_SOURCE_URL}every-county-funded`,
  america250: `${INDIANA_SOURCE_URL}america250`,
} as const;
const IN_CHILD_FIXTURES = [
  [IN_CHILD_URLS.artsProjectSupport, IN_FILES.artsProjectSupport],
  [IN_CHILD_URLS.artsOrganizationSupport, IN_FILES.artsOrganizationSupport],
  [IN_CHILD_URLS.everyCountyFunded, IN_FILES.everyCountyFunded],
  [IN_CHILD_URLS.america250, IN_FILES.america250],
] as const;
/** The hub's own page text, alone (the fixture lookup helper takes a file NAME). */
const IN_INDEX_ONLY = () => indianaConnector.parse(fixture(IN_FILES.index));
/** A synthetic cycle page served in place of the real Arts Project Support page. */
function indianaPayloadWith(childHtml: string): string {
  return joinSourcePages(INDIANA_SOURCE_URL, fixture(IN_FILES.index), [
    { url: IN_CHILD_URLS.artsProjectSupport, html: childHtml },
  ]);
}
const IN = () =>
  parseGrantOpportunities(
    indianaConnector,
    joinSourcePages(
      INDIANA_SOURCE_URL,
      fixture(IN_FILES.index),
      IN_CHILD_FIXTURES.map(([url, file]) => ({ url, html: fixture(file) })),
    ),
    NOW,
  ).opportunities;

/**
 * Florida is also a MULTI-PAGE source: the Division's grants index plus every
 * grant PROGRAMME page the index publishes, concatenated with the shared
 * delimiters. One fixture per fetched page, each a trimmed real capture.
 */
const FL_FILES = {
  index: "florida-dos-cultural-grants.html",
  generalProgramSupport: "florida-dos-general-program-support.html",
  specificCulturalProjects: "florida-dos-specific-cultural-projects.html",
  culturalFacilities: "florida-dos-cultural-facilities.html",
  culturalEndowment: "florida-dos-cultural-endowment.html",
  america250: "florida-dos-america-250-grants.html",
} as const;
const FL_CHILD_FIXTURES = [
  [
    `${FLORIDA_SOURCE_URL}grant-programs/general-program-support/`,
    FL_FILES.generalProgramSupport,
  ],
  [
    `${FLORIDA_SOURCE_URL}grant-programs/specific-cultural-projects/`,
    FL_FILES.specificCulturalProjects,
  ],
  [`${FLORIDA_SOURCE_URL}grant-programs/cultural-facilities/`, FL_FILES.culturalFacilities],
  [`${FLORIDA_SOURCE_URL}grant-programs/cultural-endowment/`, FL_FILES.culturalEndowment],
  [`${FLORIDA_SOURCE_URL}grant-programs/america-250-florida-grants/`, FL_FILES.america250],
] as const;
/** The index page text alone (a catalog with no dated listing of its own). */
const FL_INDEX_ONLY = () => floridaConnector.parse(fixture(FL_FILES.index));
/** A synthetic programme page served in place of a real one. */
function floridaPayloadWith(childHtml: string): string {
  return joinSourcePages(FLORIDA_SOURCE_URL, fixture(FL_FILES.index), [
    { url: `${FLORIDA_SOURCE_URL}grant-programs/general-program-support/`, html: childHtml },
  ]);
}
const FL = () =>
  parseGrantOpportunities(
    floridaConnector,
    joinSourcePages(
      FLORIDA_SOURCE_URL,
      fixture(FL_FILES.index),
      FL_CHILD_FIXTURES.map(([url, file]) => ({ url, html: fixture(file) })),
    ),
    NOW,
  ).opportunities;
const MD_FILES = {
  index: "maryland-msac-grants-organizations.html",
  newGfoApplicants: "maryland-msac-new-gfo-applicants.html",
  currentGfoGrantees: "maryland-msac-current-gfo-grantees.html",
} as const;
const MD_CHILD_URLS = {
  newGfoApplicants: `${MARYLAND_SOURCE_URL}/new-gfo-applicants`,
  currentGfoGrantees: `${MARYLAND_SOURCE_URL}/current-gfo-grantees`,
} as const;
const MD_CHILD_FIXTURES = [
  [MD_CHILD_URLS.newGfoApplicants, MD_FILES.newGfoApplicants],
  [MD_CHILD_URLS.currentGfoGrantees, MD_FILES.currentGfoGrantees],
] as const;
/** The index page text alone (a catalogue with no cycle of its own). */
const MD_INDEX_ONLY = () => marylandConnector.parse(fixture(MD_FILES.index));
/** A synthetic GFO page served in place of the real New GFO Applicants page. */
function marylandPayloadWith(childHtml: string): string {
  return joinSourcePages(MARYLAND_SOURCE_URL, fixture(MD_FILES.index), [
    { url: MD_CHILD_URLS.newGfoApplicants, html: childHtml },
  ]);
}
const MD = () =>
  parseGrantOpportunities(
    marylandConnector,
    joinSourcePages(
      MARYLAND_SOURCE_URL,
      fixture(MD_FILES.index),
      MD_CHILD_FIXTURES.map(([url, file]) => ({ url, html: fixture(file) })),
    ),
    NOW,
  ).opportunities;


const ALL = [
  ["NH", newHampshireConnector, NH],
  ["MT", montanaConnector, MT],
  ["IN", indianaConnector, IN],
  ["FL", floridaConnector, FL],
  ["TX", texasConnector, TX],
  ["MD", marylandConnector, MD],
] as const;
function count(records: GrantOpportunity[], status: string): number {
  return records.filter((o) => o.status === status).length;
}
function exact(records: GrantOpportunity[], id: string): GrantOpportunity {
  const found = records.filter((o) => o.externalId === id);
  expect(found.length).toBe(1);
  return found[0]!;
}

describe("next-12 tranche — determinism and shared invariants", () => {
  test("parsing and classifying every fixture makes ZERO network requests", () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = ((input: unknown, init?: unknown) => {
        calls.push(String(input));
        return realFetch(input as never, init as never);
      }) as typeof fetch;
      for (const [, connector, parseFn] of ALL) {
        const records = parseFn();
        expect(records.length).toBeGreaterThan(0);
        for (const o of records) connector.classify(o, NOW);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([]);
  });
  test("every record is well formed, on an approved host, and carries no invented date", () => {
    for (const [code, connector, parseFn] of ALL) {
      const records = parseFn();
      expect(records.length).toBeGreaterThan(0);
      expect(new Set(records.map((o) => o.externalId)).size).toBe(records.length);
      for (const o of records) {
        expect(o.stateCode).toBe(code);
        expect(o.sourceKey).toBe(connector.id);
        expect(o.sourceUrl).toBe(connector.sourceUrl);
        // A single-page connector's records are the listing itself. A MULTI-PAGE
        // connector (Indiana) attributes each record to the CHILD page that
        // published it, so the record's page must sit under the connector's own
        // source URL on the same host — never on a sibling host or the hub only.
        expect(
          o.url === connector.sourceUrl || o.url.startsWith(connector.sourceUrl),
        ).toBe(true);
        expect(o.title.trim().length).toBeGreaterThan(2);
        expect(STATE_GRANT_STATUSES).toContain(o.status);
        // `forecast` is not a status any more (owner 2026-09-19).
        expect(o.status as string).not.toBe("forecast");
        // Nothing is invented: a date is an exact ISO day or null.
        for (const day of [o.postedDate, o.closeDate, o.estimatedCloseDate]) {
          if (day !== null) expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        // An estimate and a deadline can never coexist on one record.
        expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
        if (o.status === "unverified" || o.status === "rolling") expect(o.closeDate).toBeNull();
        // Missing facts stay missing.
        if (o.eligibleApplicants === "") throw new Error("empty eligibility is not 'Not specified'");
      }
    }
  });
  test("a payload that is not this source's page is a PARSE failure, never an empty corpus", () => {
    for (const [, connector] of ALL) {
      let thrown: unknown = null;
      try {
        connector.parse("<html><body>not the listing</body></html>");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      expect((thrown as { stage?: string }).stage).toBe("parse");
    }
  });
});

describe("New Hampshire — Joint Promotional Program (JPP) round list", () => {
  test("one record per published round, in the Division's own order", () => {
    const records = NH();
    expect(records.map((o) => o.externalId)).toEqual([
      "jpp-fy2027-round-1",
      "jpp-fy2027-round-2",
      "jpp-fy2027-round-3",
      "jpp-fy2027-round-4",
    ]);
    expect(records[0]!.title).toContain("Round 1");
    expect(records[0]!.agency).toBe("New Hampshire Joint Promotional Program (JPP)");
  });
  test("each round carries ITS OWN published deadline", () => {
    const records = NH();
    expect(records.map((o) => o.closeDate)).toEqual([
      "2026-06-24",
      "2026-09-23",
      "2026-11-18",
      "2027-01-27",
    ]);
    expect(records[0]!.raw.applicationDueDateText).toBe("6/24/2026");
  });
  test("a passed round is CLOSED even though the page is live; future rounds are OPEN", () => {
    const records = NH();
    expect(count(records, "closed")).toBe(1);
    expect(count(records, "open")).toBe(3);
    // The Division's own dates decide — never "the page is live, so it's open".
    expect(exact(records, "jpp-fy2027-round-1").status).toBe("closed");
    expect(exact(records, "jpp-fy2027-round-1").statusReason.length).toBeGreaterThan(10);
  });
  test("'Applicants Notified' is NEVER a deadline", () => {
    const records = NH();
    const notifiedDays = ["2026-07-08", "2026-10-07", "2026-12-02", "2027-02-10"];
    for (const o of records) {
      expect(notifiedDays).not.toContain(o.closeDate);
      expect(notifiedDays).not.toContain(o.postedDate);
      expect(o.raw.applicantsNotifiedIsNeverADeadline).toBe(true);
    }
    expect(records.map((o) => o.raw.applicantsNotifiedText)).toEqual([
      "7/8/2026",
      "10/7/2026",
      "12/2/2026",
      "2/10/2027",
    ]);
  });
  test("no round publishes an opening date, so none is invented", () => {
    for (const o of NH()) {
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.openingDayPublishedBySource).toBeNull();
    }
  });
  test("a round whose only labelled value is a notification date stays UNDATED", () => {
    // The source's own labels, reworded so the deadline is absent: the record
    // must not borrow the notification date (or the sibling round's).
    const onlyNotified = `<h5>JPP FY2027 Deadlines</h5><ul><li><strong>Round 1:</strong><ul><li>Application Due Date: Not specified</li><li>Applicants Notified: 7/8/2026</li></ul></li></ul><h5>Rules/State Laws</h5>`;
    const records = parseGrantOpportunities(newHampshireConnector, onlyNotified, NOW).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.status).toBe("unverified");
  });
  test("a year-less deadline value is refused rather than given a year", () => {
    const yearless = `<h5>JPP FY2027 Deadlines</h5><ul><li><strong>Round 1:</strong><ul><li>Application Due Date: June 24</li><li>Applicants Notified: July 8</li></ul></li></ul><h5>Rules/State Laws</h5>`;
    const records = parseGrantOpportunities(newHampshireConnector, yearless, NOW).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.status).toBe("unverified");
  });
});

describe("Montana — Tourism Development Grant Program cycle", () => {
  test("the published open/close pair is read as its two ordered ends", () => {
    const records = MT();
    expect(records.length).toBe(1);
    const cycle = records[0]!;
    expect(cycle.externalId).toBe("mtdgp-2027");
    expect(cycle.postedDate).toBe("2027-01-06");
    expect(cycle.closeDate).toBe("2027-02-03");
    // Opening day still in the future ⇒ `upcoming`, never `open`.
    expect(cycle.status).toBe("upcoming");
    expect(cycle.estimatedCloseDate).toBeNull();
  });
  test("the page's other (historical) material is never read as a cycle", () => {
    // The fixture carries the 2023 SB 540 / 2027 SB 409 sentences; only the
    // applicant-resources cycle sentence is a deadline.
    expect(MT().length).toBe(1);
    expect(MT()[0]!.raw.orderedOpenThenCloseSentence).toBe(true);
  });
  test("a passed cycle classifies CLOSED, not open", () => {
    const passed = `<h3>Resources for Applicants:</h3><ul><li>The 2025 Montana Tourism Development Grant cycle will open Jan. 6, 2025 and close on Feb. 3, 2025.</li></ul>`;
    const records = parseGrantOpportunities(montanaConnector, passed, NOW).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBe("2025-02-03");
    expect(records[0]!.status).toBe("closed");
  });
  test("a year-less cycle sentence yields no date at all (never an invented year)", () => {
    const yearless = `<h3>Resources for Applicants:</h3><ul><li>The Montana Tourism Development Grant cycle will open Jan. 6 and close on Feb. 3.</li></ul>`;
    const records = parseGrantOpportunities(montanaConnector, yearless, NOW).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.postedDate).toBeNull();
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.status).toBe("unverified");
  });
  test("today's fixture is a future cycle, not a stale one", () => {
    // Guards the record against silently becoming a historical cycle: if the
    // Department rolls the page to a new cycle the fixture test still passes,
    // but the pinned close date proves the parser reads the LATEST cycle.
    expect(MT()[0]!.closeDate! >= TODAY).toBe(true);
  });
});
describe("Indiana — Arts Commission funding programmes (hub + programme pages)", () => {
  test("the hub is a 0-date catalogue; only the funding programme pages carry a timeline", () => {
    // The source map's evidence for Indiana: the hub publishes thirteen grant
    // links and NO dates, so a hub-only parse can only ever be undated. The
    // connector refuses it rather than serving an all-`unverified` catalogue.
    expect(fixture(IN_FILES.index)).not.toContain("Application Due");
    // Either refusal is a refusal: the trimmed hub fixture carries no timeline
    // marker, and a full hub-only payload (which does) would still yield zero
    // cycles. Both are PARSE-stage failures — never an empty corpus.
    let thrown: { stage?: string } | null = null;
    try {
      IN_INDEX_ONLY();
    } catch (e) {
      thrown = e as { stage?: string };
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.stage).toBe("parse");
  });
  test("the child scope is the hub's own funding programmes — never its training pages", () => {
    const programs = indianaFundingPrograms(fixture(IN_FILES.index));
    expect(programs.map((p) => p.name)).toEqual([
      "Arts Project Support",
      "Arts Organization Support",
      "Every County Funded",
      "America250 Grant Program",
    ]);
    expect(programs.map((p) => p.url)).toEqual([...IN_CHILD_FIXTURES.map(([url]) => url)]);
    for (const p of programs) {
      expect(p.url.startsWith(INDIANA_SOURCE_URL)).toBe(true);
      // A generic /arts/ sweep would pull the Commission's training pages in.
      expect(p.url).not.toContain("/training");
    }
  });
  test("one record per published cycle, each attributed to its own child page", () => {
    const records = IN();
    expect(records.map((o) => o.externalId)).toEqual([
      "arts-project-support-fy2027-spring",
      "arts-project-support-fy2027-fall",
      "arts-project-support-fy2026-spring",
      "arts-project-support-fy2026-fall",
      "arts-organization-support-timeline-for-fy26-27-aos-granting-cycle",
      "america250",
    ]);
    expect(records.map((o) => o.raw.childPageUrl)).toEqual([
      IN_CHILD_URLS.artsProjectSupport,
      IN_CHILD_URLS.artsProjectSupport,
      IN_CHILD_URLS.artsProjectSupport,
      IN_CHILD_URLS.artsProjectSupport,
      IN_CHILD_URLS.artsOrganizationSupport,
      IN_CHILD_URLS.america250,
    ]);
    for (const o of records) {
      expect(o.status).not.toBe("forecast");
      expect(o.title.length).toBeGreaterThan(2);
      expect(o.agency).toBe("Indiana Arts Commission");
      expect(o.url).toBe(o.raw.childPageUrl);
      expect(o.sourceUrl).toBe(INDIANA_SOURCE_URL);
    }
  });
  test("each cycle's dates come from ITS OWN Application Due row", () => {
    const records = IN();
    expect(records.map((o) => o.postedDate)).toEqual([
      "2026-01-08",
      "2026-07-07",
      "2025-01-07",
      "2025-09-01",
      "2025-01-07",
      "2025-11-13",
    ]);
    expect(records.map((o) => o.closeDate)).toEqual([
      "2026-03-05",
      "2026-09-03",
      "2025-03-04",
      "2025-09-30",
      "2025-03-04",
      "2025-12-15",
    ]);
    expect(exact(records, "arts-project-support-fy2027-spring").raw.applicationDueDateText).toContain(
      "Thursday, March 5, 2026",
    );
  });
  test("every cycle is honestly CLOSED on 2026-09-19 (a live page is not an open cycle)", () => {
    const records = IN();
    expect(count(records, "closed")).toBe(6);
    expect(count(records, "open")).toBe(0);
    expect(count(records, "upcoming")).toBe(0);
    expect(count(records, "unverified")).toBe(0);
    for (const o of records) {
      expect(o.closeDate! < TODAY).toBe(true);
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.statusReason.length).toBeGreaterThan(10);
    }
  });
  test("process dates and the Grant Period activity period are NEVER deadlines", () => {
    const processDays = [
      "2026-01-29", // Program Informational Webinar (FY2027 spring)
      "2026-02-23", // Draft Application Review Deadline (FY2027 spring)
      "2026-07-01", // Funding Notification (FY2027 spring)
      "2027-07-15", // Final Grant Report Due (FY2027 spring)
      "2026-08-24", // Draft Application Review Deadline (FY2027 fall)
      "2026-12-21", // Funding Notification (FY2027 fall)
      "2028-01-14", // Final Grant Report Due (FY2027 fall)
      "2025-02-24", // Draft Application Review Deadline (FY2026 spring)
      "2025-08-01", // Funding Notification (FY2026 spring)
    ];
    for (const o of IN()) {
      for (const day of processDays) {
        expect(o.closeDate).not.toBe(day);
        expect(o.postedDate).not.toBe(day);
        expect(o.estimatedCloseDate).not.toBe(day);
      }
      // The Grant Period is an activity period: it is carried verbatim and is
      // never a date input, so none of its days can appear on the record.
      expect(o.raw.grantPeriodIsNeverADeadline).toBe(true);
      expect(o.raw.grantPeriodText === null || /^(January 1|July 1)/.test(o.raw.grantPeriodText)).toBe(
        true,
      );
      expect(o.postedDate).not.toBe("2026-06-30");
      expect(o.closeDate).not.toBe("2026-06-30");
      expect(o.raw.draftReviewDeadlineIsNeverADeadline).toBe(true);
      expect(o.raw.fundingNotificationIsNeverADeadline).toBe(true);
      expect(o.raw.finalGrantReportIsNeverADeadline).toBe(true);
      expect(o.raw.datesReadOnlyFromThisCyclesOwnCells).toBe(true);
    }
    // The process values ARE read — they are kept in `raw` for review.
    const spring = exact(IN(), "arts-project-support-fy2027-spring");
    expect(spring.raw.draftReviewDeadlineText).toContain("February 23, 2026");
    expect(spring.raw.fundingNotificationText).toContain("July 1, 2026");
    expect(spring.raw.finalGrantReportText).toContain("July 15, 2027");
    expect(spring.raw.grantPeriodText).toContain("July 1, 2026");
  });
  test("a struck-through value is the source's own superseded value", () => {
    // The FY2026 fall row publishes BOTH the original deadline (struck through in
    // the Commission's own markup: September 9, 2025) and its replacement. The
    // source's markup says which is in force, so the replacement is the deadline
    // and the struck-through day appears nowhere on the record.
    const fall = exact(IN(), "arts-project-support-fy2026-fall");
    expect(fall.raw.closingText).not.toContain("September 9, 2025");
    expect(fall.closeDate).toBe("2025-09-30");
    expect(fall.postedDate).toBe("2025-09-01");
    expect(fall.raw.struckThroughValuesAreSupersededBySource).toBe(true);
  });
  test("the Every County Funded page is fetched but publishes no cycle, not a fabricated one", () => {
    const programs = indianaFundingPrograms(fixture(IN_FILES.index));
    // It IS in the corpus (the hub links it as a funding programme) …
    expect(programs.some((p) => p.slug === "every-county-funded")).toBe(true);
    // … and it contributes NO record: its page text is programme copy and a list
    // of funded projects, with no "Application Due" row anywhere.
    expect(fixture(IN_FILES.everyCountyFunded)).not.toContain("Application Due");
    expect(IN().some((o) => o.raw.childPageUrl.includes("every-county-funded"))).toBe(false);
  });
  test("a cycle whose only other row is the draft-review step is NOT given that date", () => {
    const child =
      `<h2><strong>APS FY2028 Application Timeline</strong></h2>` +
      `<p><strong>Spring Application Cycle (Grant Period July 1, 2027 &ndash; June 30, 2028)</strong></p>` +
      `<table><tbody><tr><td>Program Opens for Applications</td><td>January 3, 2028</td></tr>` +
      `<tr><td>Draft Application Review Deadline for New Applicants</td><td>February 20, 2028</td></tr>` +
      `<tr><td>Application Due</td><td>Thursday, March 4, 2028 by 11:59 p.m. ET</td></tr>` +
      `</tbody></table>`;
    const records = parseGrantOpportunities(
      indianaConnector,
      indianaPayloadWith(child),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBe("2028-03-04");
    expect(records[0]!.postedDate).toBe("2028-01-03");
    // Opening day still in the future ⇒ `upcoming`, and the draft-review date is
    // nowhere near it.
    expect(records[0]!.status).toBe("upcoming");
    expect(records[0]!.closeDate).not.toBe("2028-02-20");
    expect(records[0]!.postedDate).not.toBe("2028-02-20");
  });
  test("two LIVE days in one deadline cell are refused, never picked", () => {
    const child =
      `<h2><strong>APS FY2028 Application Timeline</strong></h2>` +
      `<table><tbody><tr><td>Program Opens for Applications</td><td>January 3, 2028</td></tr>` +
      `<tr><td>Application Due</td><td><p>September 9, 2025 by 11:59 p.m. ET</p>` +
      `<p>September 30, 2025 by 11:59 p.m. ET</p></td></tr></tbody></table>`;
    const records = parseGrantOpportunities(
      indianaConnector,
      indianaPayloadWith(child),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.status).toBe("unverified");
    expect(records[0]!.raw.closingText).toContain("September 30, 2025");
  });
  test("a cycle heading that carries only a Grant Period leaves no date behind", () => {
    const child =
      `<h2><strong>APS FY2028 Application Timeline</strong></h2>` +
      `<p><strong>Spring Application Cycle (Grant Period July 1, 2027 &ndash; June 30, 2028)</strong></p>` +
      `<table><tbody><tr><td>Program Opens for Applications</td><td>Not specified</td></tr>` +
      `<tr><td>Application Due</td><td>Not specified</td></tr></tbody></table>`;
    const records = parseGrantOpportunities(
      indianaConnector,
      indianaPayloadWith(child),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.postedDate).toBeNull();
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.estimatedCloseDate).toBeNull();
    expect(records[0]!.status).toBe("unverified");
    expect(records[0]!.raw.grantPeriodText).toContain("July 1, 2027");
  });
});

describe("Florida — Division of Arts and Culture grant programmes (index + programme pages)", () => {
  test("the index is a 0-date catalogue; only the programme pages carry a statement", () => {
    // The source map's evidence for Florida: the grants index publishes
    // twenty-seven grant links and NO dates and NO per-programme statement, so
    // an index-only parse can only ever be an undated catalogue. The connector
    // refuses it rather than serving one.
    expect(fixture(FL_FILES.index)).not.toContain(FLORIDA_STATUS_MARKER);
    expect(fixture(FL_FILES.index)).not.toContain(FLORIDA_DEADLINE_LABEL);
    let thrown: { stage?: string } | null = null;
    try {
      FL_INDEX_ONLY();
    } catch (e) {
      thrown = e as { stage?: string };
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.stage).toBe("parse");
  });
  test("the child scope is the grant PROGRAMME pages — never the funding-process page", () => {
    const programs = floridaGrantPrograms(fixture(FL_FILES.index));
    expect(programs.map((p) => p.slug)).toEqual([
      "general-program-support",
      "specific-cultural-projects",
      "cultural-facilities",
      "cultural-endowment",
      "america-250-florida-grants",
    ]);
    expect(programs.map((p) => p.url)).toEqual([...FL_CHILD_FIXTURES.map(([url]) => url)]);
    expect(programs.length).toBeLessThanOrEqual(FLORIDA_MAX_CHILD_PAGES);
    for (const p of programs) {
      expect(p.url.startsWith(FLORIDA_SOURCE_URL)).toBe(true);
      expect(p.url).toContain(FLORIDA_PROGRAM_PATH_PREFIX);
      // The funding-process page carries ONE general `deadline` token that is not
      // any programme's deadline, so it can never be swept into the corpus.
      expect(p.url).not.toContain("application-and-funding-process");
      expect(p.url).not.toContain("grant-resources");
      expect(p.url).not.toContain("managing-your-grants");
    }
  });
  test("one record per programme that publishes its own statement, all served closed", () => {
    const records = FL();
    expect(records.map((o) => o.externalId)).toEqual([
      "general-program-support",
      "specific-cultural-projects",
      "cultural-facilities",
      "america-250-florida-grants",
    ]);
    // The Cultural Endowment page is programme history with no application
    // status and no dated cycle: it contributes NO record.
    expect(records.some((o) => o.externalId === "cultural-endowment")).toBe(false);
    for (const o of records) {
      // The Division's own past-tense statement wins over the live page.
      expect(o.status).toBe("closed");
      // "Next Deadline: TBD" is not a date, and the 2028/2029 dates the source
      // publishes are the GRANT PERIOD: no date is ever read from them.
      if (o.raw.closedCycleDayIsFromThisProgramsOwnPage === true) {
        // This programme's own page dates the cycle it closed (America 250).
        expect(o.closeDate).toBe("2025-08-06");
      } else {
        expect(o.closeDate).toBeNull();
      }
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.raw.grantPeriodIsNeverADeadline).toBe(true);
      expect(o.raw.datesReadOnlyFromThisProgramsOwnPage).toBe(true);
      expect(o.raw.sourceClosedDeclaredBySource).toBe(true);
      expect(o.sourceUrl).toBe(FLORIDA_SOURCE_URL);
      expect(o.url.startsWith(FLORIDA_SOURCE_URL)).toBe(true);
      expect(o.url).toBe(o.raw.childPageUrl);
    }
    // The Grant Period's own days are the 2028/2029 dates the source publishes —
    // and they are carried verbatim, never promoted.
    const gps = exact(records, "general-program-support");
    expect(String(gps.raw.grantPeriodText)).toContain("July 1, 2028");
    expect(gps.raw.grantPeriodText).not.toBe(gps.raw.closingText);
    expect(gps.closeDate).not.toBe("2028-07-01");
    expect(gps.postedDate).not.toBe("2028-07-01");
    // The deadline label's own value is "TBD", kept for review.
    expect(gps.raw.nextDeadlineText).toBe("TBD");
    expect(gps.raw.deadlineValueTbdIsNotADate).toBe(true);
  });
  test("the ONE dated cycle is the programme's own closed-on sentence, read verbatim", () => {
    const records = FL();
    const a250 = exact(records, "america-250-florida-grants");
    // "The application submission period closed on August 6, 2025, at 5:00 p.m."
    // — the programme's own past APPLICATION deadline, on its own page.
    expect(a250.raw.closedCycleOnText).toBe("August 6, 2025");
    expect(a250.raw.closedCycleDayIsFromThisProgramsOwnPage).toBe(true);
    expect(a250.closeDate).toBe("2025-08-06");
    expect(a250.estimatedCloseDate).toBeNull();
    expect(a250.postedDate).toBeNull();
    expect(a250.status).toBe("closed");
    // No deadline slot on that page, so the TBD flag has nothing to declare, and
    // the record's close date is NOT claimed to be an estimate.
    expect(a250.raw.deadlineValueTbdIsNotADate).toBe(false);
    expect(a250.raw.deadlineValueIsAnEstimate).toBe(false);
    // A sibling programme with a "TBD" deadline is untouched by it.
    const gps = exact(records, "general-program-support");
    expect(gps.closeDate).toBeNull();
    expect(gps.raw.closedCycleOnText).toBeNull();
    expect(gps.raw.closedCycleDayIsFromThisProgramsOwnPage).toBe(false);
  });
  test("a closed-on day is read ONLY for a cycle the source declares closed", () => {
    // The same sentence on a page whose statement says the cycle is OPEN must
    // never become a close date (a stale prose line is not the live cycle).
    const child =
      `<h1>Synthetic Program</h1><ul>` +
      `<li><strong>Applications for Fiscal Year 2029-2030 are OPEN</strong></li>` +
      `<li><strong>Next Deadline: TBD</strong></li>` +
      `</ul>` +
      `<p>The application submission period closed on August 6, 2025, at 5:00 p.m. (Eastern).</p>`;
    const records = parseGrantOpportunities(
      floridaConnector,
      floridaPayloadWith(child),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.raw.closedCycleOnText).toBe("August 6, 2025");
    expect(records[0]!.raw.closedCycleDayIsFromThisProgramsOwnPage).toBe(false);
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.status).not.toBe("closed");
  });
  test("a programme page with its own OPEN cycle and a real deadline is read from its own value", () => {
    const child =
      `<h1>Synthetic Program</h1><ul>` +
      `<li><strong>Applications for Fiscal Year 2029-2030 are OPEN</strong></li>` +
      `<li><strong>Next Deadline: March 5, 2027</strong></li>` +
      `<li><strong>Grant Period for Next Application Cycle: July 1, 2027 through June 30, 2028</strong></li>` +
      `</ul>`;
    const records = parseGrantOpportunities(
      floridaConnector,
      floridaPayloadWith(child),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.externalId).toBe("general-program-support");
    expect(records[0]!.closeDate).toBe("2027-03-05");
    expect(records[0]!.status).toBe("open");
    // The Grant Period in the same list is still not a date.
    expect(records[0]!.postedDate).toBeNull();
    expect(records[0]!.raw.grantPeriodIsNeverADeadline).toBe(true);
  });
  test("a value the Division marks as an estimate can only ever be an estimate", () => {
    const child =
      `<h1>Synthetic Program</h1><ul>` +
      `<li><strong>Applications for Fiscal Year 2029-2030 are OPEN</strong></li>` +
      `<li><strong>Next Deadline: Estimated March 5, 2027</strong></li>` +
      `</ul>`;
    const records = parseGrantOpportunities(
      floridaConnector,
      floridaPayloadWith(child),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.estimatedCloseDate).toBe("2027-03-05");
    expect(records[0]!.status).toBe("unverified");
    expect(records[0]!.raw.deadlineValueIsAnEstimate).toBe(true);
  });
  test("one programme's deadline value is never spread across the catalogue", () => {
    const child =
      `<h1>Synthetic Program</h1><ul>` +
      `<li><strong>Applications for Fiscal Year 2029-2030 are OPEN</strong></li>` +
      `<li><strong>Next Deadline: March 5, 2027</strong></li>` +
      `</ul>`;
    const payload = joinSourcePages(FLORIDA_SOURCE_URL, fixture(FL_FILES.index), [
      { url: `${FLORIDA_SOURCE_URL}grant-programs/general-program-support/`, html: child },
      {
        url: `${FLORIDA_SOURCE_URL}grant-programs/specific-cultural-projects/`,
        html: fixture(FL_FILES.specificCulturalProjects),
      },
    ]);
    const records = parseGrantOpportunities(floridaConnector, payload, NOW).opportunities;
    expect(records.length).toBe(2);
    const scp = exact(records, "specific-cultural-projects");
    // The sibling programme's deadline did NOT leak into the second record.
    expect(scp.closeDate).toBeNull();
    expect(scp.status).toBe("closed");
    expect(scp.raw.nextDeadlineText).toBe("TBD");
  });
});

describe("Texas — the Governor's office DEAAG grant programme (one dated round)", () => {
  test("the Commission's own open/due pair, read from its own paragraph", () => {
    const records = TX();
    expect(records.length).toBe(1);
    const o = records[0]!;
    expect(o.externalId).toBe("deaag-fy-27");
    expect(o.title).toContain("Defense Economic Adjustment Assistance Grant (DEAAG)");
    expect(o.title).toContain("FY 27");
    expect(o.postedDate).toBe("2026-09-01");
    expect(o.closeDate).toBe("2026-11-06");
    expect(o.estimatedCloseDate).toBeNull();
    // 2026-09-19: the round has opened and its deadline has not passed.
    expect(o.status).toBe("open");
    expect(o.url).toBe(texasConnector.sourceUrl);
    expect(o.raw.orderedOpenThenDueSentence).toBe(true);
    expect(o.raw.datesReadOnlyFromThisProgramsOwnParagraph).toBe(true);
    expect(o.raw.openingText).toBe("September 1, 2026");
    expect(String(o.raw.closingText)).toContain("November 06, 2026");
    expect(o.raw.roundLabel).toBe("FY 27");
    expect(o.raw.rollingDeclaredBySource).toBe(false);
  });
  test("the award timing in the same paragraph is never a deadline", () => {
    const o = TX()[0]!;
    expect(String(o.raw.awardAnnouncementText)).toContain("awarded");
    expect(o.raw.awardAnnouncementIsNeverADeadline).toBe(true);
    // The award sentence names 2027: no date on the record comes from it.
    expect(String(o.closeDate)).not.toContain("2027");
    expect(String(o.postedDate)).not.toContain("2027");
    expect(o.estimatedCloseDate).toBeNull();
  });
  test("a passed round is closed, never open", () => {
    const records = parseGrantOpportunities(
      texasConnector,
      fixture(TX_FILE),
      new Date("2027-01-15T12:00:00Z"),
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.status).toBe("closed");
    expect(records[0]!.closeDate).toBe("2026-11-06");
  });
  test("a reworded, unreadable end yields NO invented date", () => {
    const reworded = fixture(TX_FILE).replace(
      "DEAAG applications will be due on or before 5 PM Friday, November 06, 2026.",
      "DEAAG applications will be due sometime this fall.",
    );
    const records = parseGrantOpportunities(texasConnector, reworded, NOW).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.estimatedCloseDate).toBeNull();
    expect(records[0]!.raw.closingText).toBeNull();
    // The published opening day is still read from the source's own words.
    expect(records[0]!.postedDate).toBe("2026-09-01");
  });
  test("dates on another programme's paragraph are never read into this record", () => {
    const extra = fixture(TX_FILE).replace(
      "</main>",
      "<p>The Governor's Committee on People with Disabilities awards will open on " +
        "March 3, 2027 and close on April 4, 2027.</p></main>",
    );
    const records = parseGrantOpportunities(texasConnector, extra, NOW).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.externalId).toBe("deaag-fy-27");
    expect(records[0]!.closeDate).toBe("2026-11-06");
  });
  test("a payload that is not the DEAAG page fails loudly at the parse stage", () => {
    let thrown: { stage?: string } | null = null;
    try {
      texasConnector.parse("<html><body>No marker here</body></html>");
    } catch (e) {
      thrown = e as { stage?: string };
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.stage).toBe("parse");
  });
});

describe("Maryland — MSAC Grants for Organizations (index + programme pages)", () => {
  test("the one deadline the Council labels is read from its own page", () => {
    const records = MD();
    expect(records.length).toBe(1);
    const o = records[0]!;
    expect(o.externalId).toBe("new-gfo-applicants");
    expect(o.title).toBe("Grants for Organizations (GFO) — New GFO Applicants");
    expect(o.closeDate).toBe("2026-09-15");
    expect(o.postedDate).toBeNull();
    expect(o.estimatedCloseDate).toBeNull();
    // 2026-09-19: the published deadline is four days past — closed, never open.
    expect(o.status).toBe("closed");
    // The page that published it, never the index, never a sibling family.
    expect(o.url).toBe(MD_CHILD_URLS.newGfoApplicants);
    expect(o.sourceUrl).toBe(MARYLAND_SOURCE_URL);
    expect(o.raw.deadlineLabel).toBe("Deadline");
    expect(o.raw.labelledBySource).toBe(true);
    expect(o.raw.deadlineValueText).toBe("09/15/2026");
    expect(o.raw.quickResourcesHeading).toBe("Quick Resources");
    expect(o.raw.datesReadOnlyFromThisPagesOwnBlock).toBe(true);
    expect(o.raw.rollingDeclaredBySource).toBe(false);
  });
  test("the deadline is `open` while it is still ahead, and `closed` once it passes", () => {
    const before = parseGrantOpportunities(
      marylandConnector,
      joinSourcePages(
        MARYLAND_SOURCE_URL,
        fixture(MD_FILES.index),
        MD_CHILD_FIXTURES.map(([url, file]) => ({ url, html: fixture(file) })),
      ),
      new Date("2026-09-01T12:00:00Z"),
    ).opportunities;
    expect(before.length).toBe(1);
    expect(before[0]!.status).toBe("open");
    expect(before[0]!.closeDate).toBe("2026-09-15");
  });
  test("the page's year-less prose deadlines are never promoted to dates", () => {
    const o = MD()[0]!;
    const prose = String(o.raw.applicationWindowProseText);
    // The Council's own sentence names BOTH of its prose dates, and neither has a
    // year — so neither can ever become the record's close date.
    expect(prose).toContain("by September 15th annually");
    expect(prose).toContain("by November 15");
    expect(prose).not.toContain("2026");
    expect(o.raw.yearLessProseDeadlinesNeverRead).toBe(true);
    expect(o.closeDate).not.toBe("2026-11-15");
    expect(o.postedDate).toBeNull();
  });
  test("an undated GFO page contributes NO record (no fabricated deadline)", () => {
    const onlyDated = MD().filter((o) => o.url === MD_CHILD_URLS.currentGfoGrantees);
    expect(onlyDated.length).toBe(0);
    // The eligibility page really is in the corpus (its own words are on it), so
    // the emptiness above is the page having no labelled deadline, not a skip.
    expect(fixture(MD_FILES.currentGfoGrantees)).toContain("Intent to Apply");
  });
  test("the index's own dates are governance history, never cycles", () => {
    // The index publishes exactly one date token ("September 9, 2021", the day the
    // Council adopted the funding formula); parsing it alone yields no record at
    // all, and no record's date comes from it.
    expect(fixture(MD_FILES.index)).toContain("September 9, 2021");
    let thrown: { stage?: string } | null = null;
    try {
      MD_INDEX_ONLY();
    } catch (e) {
      thrown = e as { stage?: string };
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.stage).toBe("parse");
    for (const o of MD()) {
      expect(o.closeDate).not.toBe("2021-09-09");
      expect(o.raw.indexDatesAreGovernanceHistory).toBe(true);
    }
  });
  test("a Deadline label with no readable day keeps the record undated, never guessed", () => {
    const synthetic =
      "<h1><span>New GFO Applicants</span></h1>" +
      '<h2 class="aside__heading">Quick Resources</h2>' +
      '<aside class="aside"><h3 class="aside__section-heading">Deadline</h3>' +
      "<div><p>TBD</p></div></aside>";
    const records = parseGrantOpportunities(
      marylandConnector,
      marylandPayloadWith(synthetic),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBeNull();
    expect(records[0]!.estimatedCloseDate).toBeNull();
    expect(records[0]!.status).toBe("unverified");
  });
  test("a date in a SIBLING block is never read as this block's deadline", () => {
    const synthetic =
      "<h1><span>New GFO Applicants</span></h1>" +
      '<h2 class="aside__heading">Quick Resources</h2>' +
      '<aside class="aside"><h3 class="aside__section-heading">Deadline</h3>' +
      "<div><p>09/15/2026</p></div></div>" +
      '<div class="aside__section"><h3 class="aside__section-heading">Grant Period</h3>' +
      "<div><p>07/01/2029</p></div></div></aside>";
    const records = parseGrantOpportunities(
      marylandConnector,
      marylandPayloadWith(synthetic),
      NOW,
    ).opportunities;
    expect(records.length).toBe(1);
    expect(records[0]!.closeDate).toBe("2026-09-15");
    expect(records[0]!.closeDate).not.toBe("2029-07-01");
    expect(String(records[0]!.raw.deadlineValueText)).not.toContain("2029");
  });
  test("a payload that is not the GFO programme page fails loudly at the parse stage", () => {
    let thrown: { stage?: string } | null = null;
    try {
      marylandConnector.parse("<html><body>No marker here</body></html>");
    } catch (e) {
      thrown = e as { stage?: string };
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.stage).toBe("parse");
  });
});
