/**
 * P3 BATCH #1 — DETERMINISTIC FIXTURE TESTS for the five new state connectors
 * (Arizona, Delaware, Pennsylvania, Rhode Island, Hawaii).
 *
 * THE OWNER'S GUARDRAIL (2026-09-19, proven in #402): the DEFAULT suite must be
 * deterministic and touch NO network. Every page here is a SAVED fixture of the
 * real official source (`src/lib/state-grants/fixtures/…`, fetched 2026-09-19),
 * and the first test in this file proves that parsing + classifying all five
 * produces ZERO fetch calls. The live half lives in
 * `<state>.source-validation.test.ts`, which is opt-in
 * (`bun run validate:live-sources`) and skipped loudly otherwise.
 *
 * WHAT THESE TESTS ARE FOR: the honesty traps each source carries — year-less
 * dates that must stay unparsed, multi-deadline cells that must not be resolved
 * by picking one date, a final-report column that is NOT an application
 * deadline, an awardee table that is NOT opportunities, a second audience tab
 * that is NOT a second program — plus the owner's status model on real data.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  NOT_SPECIFIED,
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type GrantOpportunity,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { arizonaConnector } from "~/lib/state-grants/connectors/arizona";
import { delawareConnector } from "~/lib/state-grants/connectors/delaware";
import { hawaiiConnector } from "~/lib/state-grants/connectors/hawaii";
import { pennsylvaniaConnector } from "~/lib/state-grants/connectors/pennsylvania";
import { rhodeIslandConnector } from "~/lib/state-grants/connectors/rhode-island";

/** One fixed clock for every classification below (2026-09-19, US Eastern). */
const NOW = new Date("2026-09-19T12:00:00Z");

function fixture(name: string): string {
  return readFileSync(
    new URL(`../fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

function parse(connector: StateGrantConnector<string>, name: string): GrantOpportunity[] {
  return parseGrantOpportunities(connector, fixture(name), NOW).opportunities;
}

const AZ = () => parse(arizonaConnector, "arizona-azarts.html");
const DE = () => parse(delawareConnector, "delaware-arts.html");
const PA = () => parse(pennsylvaniaConnector, "pennsylvania-due-dates.html");
const RI = () => parse(rhodeIslandConnector, "rhode-island-risca.html");
const HI = () => parse(hawaiiConnector, "hawaii-sfca.html");

const ALL = [
  ["AZ", arizonaConnector, AZ, "arizona-azarts.html"],
  ["DE", delawareConnector, DE, "delaware-arts.html"],
  ["PA", pennsylvaniaConnector, PA, "pennsylvania-due-dates.html"],
  ["RI", rhodeIslandConnector, RI, "rhode-island-risca.html"],
  ["HI", hawaiiConnector, HI, "hawaii-sfca.html"],
] as const;

describe("batch 1 fixtures: determinism and the shared invariants", () => {
  test("parsing and classifying all five fixtures makes ZERO network requests", () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = ((input: unknown, init?: unknown) => {
        calls.push(String(input));
        return realFetch(input as never, init as never);
      }) as typeof fetch;
      for (const [, connector, parseFixture] of ALL) {
        const opportunities = parseFixture();
        expect(opportunities.length).toBeGreaterThan(0);
        expect(connector.sourceUrl.startsWith("https://")).toBe(true);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([]);
  });

  test("every record obeys the owner's status model and identity rules", () => {
    for (const [code, connector, parseFixture] of ALL) {
      for (const o of parseFixture()) {
        expect(o.stateCode).toBe(code);
        expect(o.sourceKey).toBe(connector.id);
        expect(o.sourceUrl).toBe(connector.sourceUrl);
        expect(STATE_GRANT_STATUSES).toContain(o.status);
        expect(o.status).not.toBe("forecast" as never);
        expect(o.fingerprint).toMatch(/^[0-9a-f]{32}$/);
        expect(o.statusReason.length).toBeGreaterThan(10);
        // An estimate is never a deadline, and a non-open/upcoming/closed record
        // never carries one.
        expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
        if (o.status === "unverified" || o.status === "rolling") {
          expect(o.closeDate).toBeNull();
        }
        // A missing fact is stored as NOT_SPECIFIED, never as an empty string.
        expect(o.summary.length).toBeGreaterThan(0);
        expect(o.title.length).toBeGreaterThan(2);
        expect(o.eligibleApplicants.length).toBeGreaterThan(0);
        expect(o.eligibleGeography.length).toBeGreaterThan(0);
      }
    }
  });

  test("every parser refuses a payload that is not its source's page", () => {
    for (const [, connector] of ALL) {
      let thrown: unknown = null;
      try {
        connector.parse("<html><body>nope</body></html>");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      expect((thrown as { stage?: string }).stage).toBe("parse");
    }
  });
});

describe("arizona: the source's own cycle label and the dated application periods", () => {
  test("yields the six program cards, and not the 'Found 6 Results' strip", () => {
    const records = AZ();
    expect(records.map((o) => o.externalId)).toEqual([
      "artist-opportunity",
      "creative-youth",
      "lifelong-arts-engagement",
      "youth-arts-engagement",
      "festival",
      "creative-capacity-grant",
    ]);
    expect(records.some((o) => /found \d+ results/i.test(o.title))).toBe(false);
  });

  test("the open cycle is open on its published deadline; the closed ones are closed", () => {
    const records = AZ();
    const open = records.find((o) => o.externalId === "artist-opportunity")!;
    expect(open.title).toBe("Artist Opportunity Grant");
    expect(open.postedDate).toBe("2026-08-06");
    expect(open.closeDate).toBe("2026-09-24");
    expect(open.status).toBe("open");
    expect(open.url).toBe("https://azarts.gov/grant/artist-opportunity/");

    const closed = records.filter((o) => o.status === "closed");
    expect(closed.length).toBe(5);
    for (const o of closed) {
      // The source's own visible "Application Period Closed" label, not a guess.
      expect(o.raw.cycleLabelDeclaresClosed).toBe(true);
    }
  });

  test("the page's missing facts stay missing (no invented categories)", () => {
    for (const o of AZ()) {
      expect(o.categories).toEqual([]);
      expect(o.eligibleApplicants).toBe(NOT_SPECIFIED);
      expect(o.eligibleGeography).toBe(NOT_SPECIFIED);
      expect(o.awardRange).toBe(NOT_SPECIFIED);
      expect(o.awardMaxAmount).toBeNull();
      expect(o.matchingRequirement).toBe(NOT_SPECIFIED);
    }
  });
});

describe("delaware: year-bearing deadlines, rolling wording, and no year-less guesses", () => {
  test("ten programs, one record per program page (the duplicate tab is dropped)", () => {
    const records = DE();
    expect(records.length).toBe(10);
    expect(new Set(records.map((o) => o.url)).size).toBe(10);
    // "Arts Access (ACC)" is listed under two audience tabs on one URL.
    expect(records.filter((o) => o.externalId === "arts-access").length).toBe(1);
  });

  test("'Next Deadline: March 1, 2027' is a published close date", () => {
    const gos = DE().find((o) => o.externalId === "general-operating-support")!;
    expect(gos.closeDate).toBe("2027-03-01");
    expect(gos.status).toBe("open");
    expect(gos.raw.deadlineValue).toBe("March 1, 2027 at 4:30pm");
  });

  test("the year-less 'Applications open December 1' prose is never a date", () => {
    for (const o of DE()) {
      expect(o.closeDate ?? "").not.toMatch(/-12-01$/);
      expect(o.postedDate).toBeNull();
    }
  });

  test("a past published deadline classifies as closed, on the source's date", () => {
    const artist = DE().find((o) => o.externalId === "artist-opportunity-grants")!;
    expect(artist.closeDate).toBe("2026-07-15");
    expect(artist.status).toBe("closed");
    // The source's own "up to $X" wording is the award range and its ceiling.
    expect(artist.awardRange).toBe("up to $1,000");
    expect(artist.awardMaxAmount).toBe(1000);
  });

  test("a program's own Next Deadline wins over its prerequisite LOI paragraph", () => {
    const startup = DE().find((o) => o.externalId === "startup")!;
    expect(startup.closeDate).toBe("2027-03-01");
    expect(startup.raw.deadlineParagraphsPublished).toEqual([
      "Letter of Intent due by January 15, 2027",
      "Next Deadline: March 1, 2027 at 4:30pm",
    ]);
    // …and the deadline line never leaks into the description.
    expect(startup.summary).not.toContain("Next Deadline:");
  });

  test("'Rolling deadlines until funding expires' becomes rolling, with no deadline", () => {
    const records = DE();
    const rolling = records.filter((o) => o.status === "rolling");
    expect(rolling.length).toBe(3);
    for (const o of rolling) {
      expect(o.ongoing).toBe(true);
      expect(o.closeDate).toBeNull();
      expect(o.raw.rollingDeclaredBySource).toBe(true);
    }
    // The audience group's own preamble is the source's eligibility statement.
    const gos = records.find((o) => o.externalId === "general-operating-support")!;
    expect(gos.eligibleApplicants).toContain("Non-profit Delaware organizations");
    expect(gos.raw.audienceGroup).toBe("Art Organizations");
  });
});

describe("pennsylvania: the application-due column only, and no picked deadline", () => {
  test("seven programs from the due-dates calendar", () => {
    const records = PA();
    expect(records.length).toBe(7);
    expect(records.map((o) => o.externalId)).toEqual([
      "creative-asset-program",
      "creative-business-loan-fund",
      "creative-catalyst-grants",
      "creative-communities-initiative",
      "creative-districts",
      "creative-entrepreneur-accelerator",
      "creative-innovation-and-impact-grant-program",
    ]);
  });

  test("the final-report date is never used as an application deadline", () => {
    const asset = PA().find((o) => o.externalId === "creative-asset-program")!;
    // The row's Final Report Due Date is 07/30/2027 — deliberately not read.
    expect(asset.closeDate).toBe("2026-03-16");
    expect(asset.status).toBe("closed");
    expect(asset.raw.ignoredColumns).toEqual([
      "Grant Activity/Performance Period",
      "Final Report Due Date",
    ]);
    for (const o of PA()) {
      expect(String(o.raw.applicationDueDateText).length).toBeGreaterThan(0);
    }
  });

  test("a multi-deadline cell stays unverified — a date is never picked for the user", () => {
    const records = PA();
    const catalyst = records.find((o) => o.externalId === "creative-catalyst-grants")!;
    expect(catalyst.closeDate).toBeNull();
    expect(catalyst.status).toBe("unverified");
    const districts = records.find((o) => o.externalId === "creative-districts")!;
    expect(districts.closeDate).toBeNull();
    expect(districts.status).toBe("unverified");
    expect(districts.raw.applicationDueDateText).toContain("Letter of Intent");
  });

  test("'Rolling' rolls, and a single published date is a real deadline", () => {
    const records = PA();
    const loanFund = records.find((o) => o.externalId === "creative-business-loan-fund")!;
    expect(loanFund.status).toBe("rolling");
    expect(loanFund.raw.applicationDueDateText).toBe("Rolling");
    const communities = records.find((o) => o.externalId === "creative-communities-initiative")!;
    expect(communities.closeDate).toBe("2026-11-13");
    expect(communities.status).toBe("open");
    // The page publishes no descriptions, eligibility or awards: they stay Not specified.
    expect(communities.summary).toBe(NOT_SPECIFIED);
    expect(communities.eligibleApplicants).toBe(NOT_SPECIFIED);
  });
});

describe("rhode island: year-less dates stay unverified, the source's words still classify", () => {
  test("fifteen cards, none with an invented year", () => {
    const records = RI();
    expect(records.length).toBe(15);
    for (const o of records) {
      expect(o.postedDate).toBeNull();
      expect(o.closeDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      // The source publishes only year-less cycle wording; we saw it and refused it.
      expect(o.raw.datesPublishedBySourceAreYearless).toBe(true);
    }
    // "Opens: Feb. 1. Deadline: April 1." must NOT become a 2026/2027 deadline.
    const apprenticeship = records.find((o) => o.externalId === "folk-arts-apprenticeships")!;
    expect(apprenticeship.status).toBe("unverified");
    expect(apprenticeship.summary).toContain("Deadline: April. 1.");
  });

  test("the source's own 'Currently Closed' heading closes those programs", () => {
    const records = RI();
    const closed = records.filter((o) => o.status === "closed");
    expect(closed.length).toBe(5);
    for (const o of closed) {
      expect(o.raw.sectionDeclaresClosed).toBe(true);
      expect(o.raw.sourceSection).toBe("Currently Closed");
    }
  });

  test("'Rolling Deadlines' is the source declaring the program ongoing", () => {
    const records = RI();
    const rolling = records.filter((o) => o.status === "rolling");
    expect(rolling.map((o) => o.externalId)).toEqual([
      "artist-open-studio-tour",
      "big-yellow-school-bus",
    ]);
    for (const o of rolling) expect(o.raw.rollingDeclaredBySource).toBe(true);
    expect(records.find((o) => o.externalId === "big-yellow-school-bus")!.awardRange).toBe(
      "up to $500",
    );
  });

  test("a card linking off the official hosts falls back to the listing page", () => {
    const records = RI();
    expect(records.some((o) => o.url.includes("rifoundation.org"))).toBe(false);
    const foundation = records.find((o) => o.title === "Rhode Island Foundation")!;
    expect(foundation.url).toBe(rhodeIslandConnector.sourceUrl);
    for (const o of records) {
      expect(["www.arts.ri.gov", "arts.ri.gov"]).toContain(new URL(o.url).host);
    }
  });
});

describe("hawaii: the current-cycle table only", () => {
  test("three current/upcoming programs, with the source's own eligibility text", () => {
    const records = HI();
    expect(records.length).toBe(3);
    expect(records.map((o) => o.title)).toEqual([
      "Outreach Initiative Program",
      "America250 grant",
      "Community Arts Grant Program",
    ]);
    for (const o of records) {
      expect(o.eligibleApplicants).not.toBe(NOT_SPECIFIED);
      expect(o.url.startsWith("https://sfca.hawaii.gov/")).toBe(true);
    }
  });

  test("'closed <date>' is the source's own past-tense label", () => {
    const records = HI();
    const outreach = records.find((o) => o.externalId.includes("outreach"))!;
    expect(outreach.closeDate).toBe("2026-04-30");
    expect(outreach.status).toBe("closed");
    expect(outreach.raw.cycleClosedDeclaredBySource).toBe(true);
    const veterans = records.find((o) => o.title === "America250 grant")!;
    expect(veterans.closeDate).toBe("2026-02-06");
    expect(veterans.status).toBe("closed");
  });

  test("a two-window range cell that closes on ONE published day is open on that day", () => {
    const community = HI().find((o) => o.externalId.includes("community-arts"))!;
    expect(community.raw.enrollmentDatesText).toContain("October 30, 2026");
    expect(community.closeDate).toBe("2026-10-30");
    expect(community.status).toBe("open");
  });

  test("a payload without the cycle column is refused (the awardee table is not coverage)", () => {
    const awardeeOnly = `
      <div id="grant-table"><table><thead><tr><th>Grant Name</th><th>Grantee</th></tr></thead>
      <tbody><tr><td><a href="https://sfca.hawaii.gov/awards/x/">Some Award</a></td><td>org</td></tr></tbody>
      </table></div>`;
    expect(() => hawaiiConnector.parse(awardeeOnly)).toThrow(/Enrollment Dates/);
    // The full fixture's own awardee table never becomes a record.
    expect(HI().some((o) => /award/i.test(o.title))).toBe(false);
  });
});
