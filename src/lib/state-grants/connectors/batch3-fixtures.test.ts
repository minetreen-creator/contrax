/**
 * NATIONWIDE BATCH 2 — DETERMINISTIC FIXTURE TESTS for the five new state
 * connectors (Arkansas, Colorado, Minnesota, North Dakota, New Mexico).
 *
 * WHY "batch 3": `batch1-fixtures.test.ts` shipped AZ/DE/PA/RI/HI and
 * `batch2-fixtures.test.ts` shipped the nationwide programme's CA/KS/WA slice (it
 * is "batch 2" in that file's own words — the file names carry the QA-requested
 * explicit names, checklist flag #7). The next slice on this accumulating
 * branch/PR is AR/CO/MN/ND/NM, so this file is `batch3`.
 *
 * THE OWNER'S GUARDRAIL (2026-09-19): the DEFAULT suite must be deterministic and
 * touch NO network. Every page here is a SAVED fixture of the real official source
 * (`src/lib/state-grants/fixtures/…`, captured 2026-09-19 with the team's bot UA
 * and copied verbatim as a contiguous slice), and the first test in this file
 * proves that parsing + classifying all five produces ZERO fetch calls. The live
 * half lives in `<state>.source-validation.test.ts`, which is opt-in
 * (`bun run validate:live-sources`) and skipped loudly otherwise.
 *
 * WHAT THESE TESTS ARE FOR: the honesty traps each of these five sources carries —
 * a card whose only published date is a MEMORIAL date, a page whose real cycle
 * dates live in a list that does not map onto the cards, a program that is both
 * "closed" and "year-round", a "year-round except in September" that must not be
 * loosened into rolling, an opening announcement that is NOT a deadline, a
 * prior-fiscal-year archive table that must never be read, a passed-marker that is
 * ROUND-SCOPED, a deadline stated as a RULE, and a webinar date that is an EVENT.
 * It also pins the two defects this batch fixed: the Colorado listing whose
 * headings were consumed as delimiters, and the North Dakota card that publishes
 * "Deadline" in a different markup shape from its siblings.
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
import { fetchStateGrantSource } from "~/lib/state-grants/connectors/source-support";
import { arkansasConnector } from "~/lib/state-grants/connectors/arkansas";
import { coloradoConnector } from "~/lib/state-grants/connectors/colorado";
import { minnesotaConnector } from "~/lib/state-grants/connectors/minnesota";
import { northDakotaConnector } from "~/lib/state-grants/connectors/north-dakota";
import { newMexicoConnector } from "~/lib/state-grants/connectors/new-mexico";

/** One fixed clock for every classification below (2026-09-19, noon UTC). */
const NOW = new Date("2026-09-19T12:00:00Z");

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

function parse(connector: StateGrantConnector<string>, name: string): GrantOpportunity[] {
  return parseGrantOpportunities(connector, fixture(name), NOW).opportunities;
}

const AR = () => parse(arkansasConnector, "arkansas-arts-council-grants.html");
const CO = () => parse(coloradoConnector, "colorado-oedit-ai-programs.html");
const MN = () => parse(minnesotaConnector, "minnesota-arts-board-calendar.html");
const ND = () => parse(northDakotaConnector, "north-dakota-arts-grants.html");
const NM = () => parse(newMexicoConnector, "new-mexico-arts-apply.html");

const ALL = [
  ["AR", arkansasConnector, AR, "arkansas-arts-council-grants.html"],
  ["CO", coloradoConnector, CO, "colorado-oedit-ai-programs.html"],
  ["MN", minnesotaConnector, MN, "minnesota-arts-board-calendar.html"],
  ["ND", northDakotaConnector, ND, "north-dakota-arts-grants.html"],
  ["NM", newMexicoConnector, NM, "new-mexico-arts-apply.html"],
] as const;

function count(records: GrantOpportunity[], status: string): number {
  return records.filter((o) => o.status === status).length;
}

function byId(records: GrantOpportunity[], id: string): GrantOpportunity {
  const found = records.find((o) => o.externalId === id);
  if (!found) throw new Error(`fixture no longer publishes ${id}`);
  return found;
}

describe("batch 3 (nationwide batch 2: AR, CO, MN, ND, NM) — determinism and shared invariants", () => {
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
        expect(new URL(o.url).protocol).toBe("https:");
        // No record of these five is ever a "closed" cycle dated by a year-less day.
        expect(o.closeDate === null || /^\d{4}-\d{2}-\d{2}$/.test(o.closeDate)).toBe(true);
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

  test("a listing that redirects off the approved hosts is refused, not parsed", async () => {
    // QA flag #5 (batch checklist §6): the fetch gate must not parse a page that
    // arrived from a host the connector did not approve. No network here: the
    // fetch implementation is injected.
    const body = fixture("north-dakota-arts-grants.html");
    const fakeOk = (async () => ({
      status: 200,
      url: "https://www.arts.nd.gov/grants",
      text: async () => body,
    })) as unknown as typeof fetch;
    const fakeOffHost = (async () => ({
      status: 200,
      url: "https://grants.vendor-portal.example/nd",
      text: async () => body,
    })) as unknown as typeof fetch;

    await expect(
      fetchStateGrantSource({
        url: northDakotaConnector.sourceUrl,
        marker: "<h1>Grants at a Glance",
        label: "North Dakota",
        fetchImpl: fakeOk,
        approvedHosts: ["www.arts.nd.gov", "arts.nd.gov"],
      }),
    ).resolves.toBe(body);

    let thrown: unknown = null;
    try {
      await fetchStateGrantSource({
        url: northDakotaConnector.sourceUrl,
        marker: "<h1>Grants at a Glance",
        label: "North Dakota",
        fetchImpl: fakeOffHost,
        approvedHosts: ["www.arts.nd.gov", "arts.nd.gov"],
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect((thrown as { stage?: string }).stage).toBe("fetch");
    expect((thrown as Error).message).toContain("redirected off the approved hosts");
  });
});

describe("arkansas: no date is read from a card, and neither a memorial nor a carve-out becomes a cycle", () => {
  test("the twelve programs of the accordion listing, in page order", () => {
    const records = AR();
    expect(records.length).toBe(12);
    expect(records.map((o) => o.externalId)).toEqual([
      "arts-on-tour-grant",
      "community-arts-project",
      "general-operating-support",
      "individual-artist-fellowship-closed-for-this-cycle",
      "major-arts-partners",
      "sally-a-williams-artist-fund",
      "aie-after-school-summer-residency",
      "aie-arts-curriculum-project",
      "aie-arts-for-lifelong-learning-mini-grants",
      "aie-in-school-residency-program",
      "aie-mini-grants",
      "aie-lifelong-learning-veteran-s-projects",
    ]);
    expect(count(records, "rolling")).toBe(1);
    expect(count(records, "closed")).toBe(2);
    expect(count(records, "unverified")).toBe(9);
    expect(records[0]!.agency).toBe("Arkansas Arts Council");
  });

  test("a card whose body is a <ul> with no <p> is still a program (the batch regression)", () => {
    // AIE AFTER-SCHOOL/SUMMER RESIDENCY renders its body as a list, not
    // paragraphs. A paragraph-only reader silently dropped the whole program.
    const record = byId(AR(), "aie-after-school-summer-residency");
    expect(record.title).toBe("AIE AFTER-SCHOOL/SUMMER RESIDENCY");
    expect(record.summary).toContain("after-school and summer programs");
    expect(record.status).toBe("unverified");
    expect(record.closeDate).toBeNull();
  });

  test("the page publishes NO per-program deadline, so every record refuses a date", () => {
    const records = AR();
    for (const o of records) {
      // The real cycle dates live in a separate "When To Apply" list keyed by
      // fiscal-year labels that do not map 1:1 onto these cards: attaching one
      // would be OUR inference, so it is refused outright.
      expect(o.closeDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.pagePublishesNoPerProgramDeadline).toBe(true);
      expect(o.raw.categoriesPublished).toBe(false);
      expect(o.categories).toEqual([]);
      expect(o.awardRange).toBe(NOT_SPECIFIED);
      expect(o.awardMaxAmount).toBeNull();
      expect(o.totalFunding).toBe(NOT_SPECIFIED);
      expect(o.matchingRequirement).toBe(NOT_SPECIFIED);
    }
  });

  test("the Sally A. Williams memorial date never marks a cycle closed", () => {
    const record = byId(AR(), "sally-a-williams-artist-fund");
    // The card's prose really does carry a death date …
    expect(record.summary).toContain("April 20, 2010");
    // … and that day is NOT a deadline: the program is unverified, not closed.
    expect(record.status).toBe("unverified");
    expect(record.closeDate).toBeNull();
    expect(record.sourceClosed).toBe(false);
    expect(record.raw.statusText).toBeNull();
  });

  test("'closed for applications' beats the same card's 'year-round' wording", () => {
    const record = byId(AR(), "community-arts-project");
    expect(record.raw.statusText).toBe("This grant is currently closed for applications.");
    expect(record.status).toBe("closed");
    expect(record.sourceClosed).toBe(true);
    expect(record.raw.rollingDeclaredBySource).toBe(false);
  });

  test("'year-round except in the month of September' is NEVER read as rolling", () => {
    const records = AR();
    const rolling = records.filter((o) => o.status === "rolling");
    expect(rolling.map((o) => o.externalId)).toEqual(["arts-on-tour-grant"]);
    expect(rolling[0]!.raw.statusText).toBe("Application Deadline Ongoing.");
    expect(rolling[0]!.raw.rollingDeclaredBySource).toBe(true);
    // The mini-grants deliberately refuse the rolling reading the source almost
    // gives them (a carve-out month means acceptance is NOT continuous).
    const mini = byId(records, "aie-mini-grants");
    expect(mini.raw.ongoingRefusedBecauseSourceCarvesOutAMonth).toBe(true);
    expect(mini.raw.rollingDeclaredBySource).toBe(false);
    expect(mini.ongoing).toBe(false);
    expect(mini.status).toBe("unverified");
  });

  test("only the agency's own hosts are ever linked", () => {
    const records = AR();
    for (const o of records) {
      expect(["www.arkansasheritage.com", "arkansasheritage.com"]).toContain(new URL(o.url).host);
      expect(o.sourceUrl).toBe(arkansasConnector.sourceUrl);
    }
    // The one card that links to a real sub-page keeps it; the rest point at the listing.
    expect(byId(records, "sally-a-williams-artist-fund").url).toBe(
      "https://www.arkansasheritage.com/arkansas-art-council/about/aac-grants/sally-williams-artist-fund",
    );
    expect(byId(records, "major-arts-partners").url).toBe(arkansasConnector.sourceUrl);
  });
});

describe("colorado: one program family, a published closing day, and the Overview block that is not a program", () => {
  test("the five accelerator programs, in page order", () => {
    const records = CO();
    expect(records.length).toBe(5);
    expect(records.map((o) => o.externalId)).toEqual([
      "advanced-industries-proof-of-concept-grant",
      "advanced-industries-early-stage-capital-retention-grant",
      "advanced-industries-collaborative-infrastructure-grant",
      "advanced-industries-export-grant",
      "global-consultant-network",
    ]);
    expect(records[0]!.agency).toBe(
      "Colorado Office of Economic Development and International Trade",
    );
    expect(count(records, "closed")).toBe(2);
    expect(count(records, "unverified")).toBe(3);
  });

  test("the two programs that publish a closing day are closed on it", () => {
    const records = CO();
    for (const id of [
      "advanced-industries-proof-of-concept-grant",
      "advanced-industries-early-stage-capital-retention-grant",
    ]) {
      const o = byId(records, id);
      expect(o.closeDate).toBe("2026-08-27");
      expect(o.status).toBe("closed");
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.blockPublishesAClosingLabel).toBe(true);
      expect(String(o.raw.closingText)).toContain("August 27, 2026");
    }
    expect(byId(records, "advanced-industries-proof-of-concept-grant").raw.closingText).toBe(
      "The application is open and due August 27, 2026 at 5pm MT.",
    );
  });

  test("the page's Overview block is never a record", () => {
    const records = CO();
    expect(records.some((o) => /^overview$/i.test(o.title))).toBe(false);
    expect(records.some((o) => /varies by program/i.test(o.title))).toBe(false);
    for (const o of records) {
      // "Type: Four grants / For: … / Application deadline: Varies by program"
      expect(JSON.stringify(o.raw)).not.toContain("Varies by program");
      expect(o.title.startsWith("Advanced Industries") || o.title === "Global Consultant Network").toBe(
        true,
      );
    }
  });

  test("an announced OPENING day is kept out of both date columns", () => {
    const record = byId(CO(), "advanced-industries-collaborative-infrastructure-grant");
    // The block says "The next application will open February 1, 2027" — a real
    // day, but an opening, not a deadline.
    expect(record.raw.publishedDayNotUsedAsADeadline).toBe("2027-02-01");
    expect(record.raw.announcedOpeningOnly).toBe(true);
    expect(record.postedDate).toBeNull();
    expect(record.closeDate).toBeNull();
    expect(record.estimatedCloseDate).toBeNull();
    expect(record.status).toBe("unverified");
  });

  test("nothing else is published on these blocks, so nothing else is claimed", () => {
    for (const o of CO()) {
      expect(o.raw.programFamily).toBe("Advanced Industries Accelerator Programs");
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      expect(o.raw.sourceClosedDeclaredBySource).toBe(false);
      expect(o.eligibleApplicants).toBe(NOT_SPECIFIED);
      expect(o.eligibleGeography).toBe(NOT_SPECIFIED);
      expect(o.awardRange).toBe(NOT_SPECIFIED);
      expect(o.totalFunding).toBe(NOT_SPECIFIED);
      expect(o.matchingRequirement).toBe(NOT_SPECIFIED);
      expect(o.categories).toEqual([]);
      expect(new URL(o.url).host).toBe("oedit.colorado.gov");
    }
  });
});

describe("minnesota: the current fiscal-year table's deadline column only", () => {
  test("six programs, each with the calendar's own published deadline", () => {
    const records = MN();
    expect(records.length).toBe(6);
    expect(records.map((o) => o.externalId)).toEqual([
      "accessible-arts",
      "arts-education",
      "arts-experiences",
      "creative-individuals",
      "cultural-expression",
      "operating-support",
    ]);
    expect(
      Object.fromEntries(records.map((o) => [o.externalId, o.closeDate])),
    ).toEqual({
      "accessible-arts": "2026-04-10",
      "arts-education": "2026-02-06",
      "arts-experiences": "2026-05-01",
      "creative-individuals": "2026-03-06",
      "cultural-expression": "2026-06-05",
      "operating-support": "2026-01-16",
    });
    expect(count(records, "closed")).toBe(6);
    expect(records[0]!.agency).toBe("Minnesota State Arts Board");
  });

  test("every one of these deadlines has already passed, and says so", () => {
    for (const o of MN()) {
      expect(o.status).toBe("closed");
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.raw.sourceClosedDeclaredBySource).toBe(false);
      expect(o.statusReason).toContain("published closing date has passed");
      expect(o.raw.applicationDeadlineText).toBe(o.raw.closingText);
    }
  });

  test("only the Application Deadline column is read; the prior cycle is never read", () => {
    const records = MN();
    for (const o of records) {
      // The calendar also publishes "Board Approval" and "Grant Period (*)" —
      // neither is an application deadline, and both are recorded as ignored.
      expect(o.raw.ignoredColumns).toEqual(["Board Approval", "Grant Period (*)"]);
      // Only the CURRENT cycle's table is read; the FY 2026 table is an expired
      // archive whose rows would duplicate these programs.
      expect(o.raw.calendarCycle).toBe("FY 2027 Grant Cycle");
      expect(new URL(o.url).host).toBe("www.arts.state.mn.us");
      expect(o.url.startsWith("https://www.arts.state.mn.us/grants/")).toBe(true);
    }
  });

  test("a table without the Application Deadline column is refused", () => {
    const payload =
      '<div id="activity"><h2>Grant Program Activity Dates</h2><h3>FY 2027 Grant Cycle</h3>' +
      '<table class="caltab"><thead><tr><th>Grant Program</th><th>Board Approval</th></tr></thead>' +
      "<tbody><tr><td>Accessible Arts</td><td>June 2026</td></tr></tbody></table></div>";
    expect(() => minnesotaConnector.parse(payload)).toThrow(/Application Deadline/);
  });
});

describe("north dakota: a round-scoped passed-marker, a rule that is not a deadline, and the card that used to vanish", () => {
  test("the nine grant cards, in page order", () => {
    const records = ND();
    expect(records.length).toBe(9);
    expect(records.map((o) => o.externalId)).toEqual([
      "accessibility-grant",
      "artist-growth-and-development",
      "folk-and-traditional-arts-apprenticeship",
      "arts-in-education-collaboration",
      "artist-in-residence",
      "community-arts-access",
      "institutional-support",
      "professional-development",
      "special-projects",
    ]);
    expect(count(records, "closed")).toBe(5);
    expect(count(records, "unverified")).toBe(4);
    expect(records[0]!.agency).toBe("North Dakota Council on the Arts");
  });

  test("the card that publishes '<strong>Deadline</strong>:' is not lost (the batch regression)", () => {
    // This card labels its deadline with the colon OUTSIDE the <strong>, unlike
    // its eight siblings. A raw-markup label search dropped the whole program.
    const record = byId(ND(), "folk-and-traditional-arts-apprenticeship");
    expect(record.title).toBe("Folk and Traditional Arts Apprenticeship");
    expect(record.closeDate).toBe("2026-04-30");
    expect(record.status).toBe("closed");
    expect(record.sourceClosed).toBe(true);
    expect(String(record.raw.deadlineText)).toContain("April 30, 2026");
    expect(record.url).toBe(
      "https://www.arts.nd.gov/individual-artists/folk-and-traditional-arts-apprenticeship-program",
    );
  });

  test("the five cards carrying a published day and the source's own passed-marker are closed", () => {
    const records = ND();
    for (const id of [
      "accessibility-grant",
      "artist-growth-and-development",
      "folk-and-traditional-arts-apprenticeship",
      "arts-in-education-collaboration",
      "institutional-support",
    ]) {
      const o = byId(records, id);
      expect(o.status).toBe("closed");
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.sourceClosed).toBe(true);
      expect(o.raw.sourceClosedDeclaredBySource).toBe(true);
      expect(o.raw.passedMarkerIsRoundScoped).toBe(false);
      expect(String(o.raw.deadlineText)).toContain("deadline has passed");
    }
    expect(byId(records, "accessibility-grant").closeDate).toBe("2026-04-23");
    expect(byId(records, "arts-in-education-collaboration").closeDate).toBe("2026-04-16");
    expect(byId(records, "institutional-support").closeDate).toBe("2025-04-03");
  });

  test("the two-round card's ROUND-SCOPED marker never closes the whole program", () => {
    const record = byId(ND(), "community-arts-access");
    // The card says "*Round 1 deadline has passed" — Round 1 only.
    expect(record.raw.passedMarkerIsRoundScoped).toBe(true);
    expect(record.sourceClosed).toBe(false);
    expect(record.raw.sourceClosedDeclaredBySource).toBe(false);
    // Two different published days ⇒ no single day is picked for the user.
    expect(record.closeDate).toBeNull();
    expect(record.estimatedCloseDate).toBeNull();
    expect(record.status).toBe("unverified");
    expect(String(record.raw.deadlineText)).toContain("April 26, 2026");
    expect(String(record.raw.deadlineText)).toContain("September 20, 2026");
  });

  test("'Deadline: 6 weeks prior to project start date' is a rule, never a date and never rolling", () => {
    const records = ND();
    for (const id of [
      "artist-in-residence",
      "professional-development",
      "special-projects",
    ]) {
      const o = byId(records, id);
      expect(o.raw.deadlineText).toBe("Deadline: 6 weeks prior to project start date");
      expect(o.raw.deadlinesStatedAsARule).toBe(true);
      expect(o.closeDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      // The source does NOT declare continuous acceptance, so this is not rolling.
      expect(o.ongoing).toBe(false);
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      expect(o.status).toBe("unverified");
    }
  });

  test("the card's own What:/Who: wording becomes the award and eligibility facts", () => {
    const records = ND();
    const institutional = byId(records, "institutional-support");
    expect(institutional.awardRange).toBe("$4,000 - $11,000");
    expect(institutional.awardMinAmount).toBe(4000);
    expect(institutional.awardMaxAmount).toBe(11000);
    expect(institutional.eligibleApplicants).toBe("501(c)(3) nonprofits with minimum part-time staff");

    const accessibility = byId(records, "accessibility-grant");
    expect(accessibility.awardRange).toBe("Up to $2,000");
    expect(accessibility.awardMinAmount).toBeNull();
    expect(accessibility.awardMaxAmount).toBe(2000);
    expect(accessibility.eligibleApplicants).toBe("Arts and non-arts organizations");

    // A single published amount is the ceiling; a card with no Who: claims nothing.
    const growth = byId(records, "artist-growth-and-development");
    expect(growth.awardRange).toBe("Two grants of $5,000");
    expect(growth.awardMaxAmount).toBe(5000);
    expect(growth.eligibleApplicants).toBe(NOT_SPECIFIED);
    for (const o of records) {
      expect(o.eligibleGeography).toBe(NOT_SPECIFIED);
      expect(o.totalFunding).toBe(NOT_SPECIFIED);
      expect(o.matchingRequirement).toBe(NOT_SPECIFIED);
      expect(o.categories).toEqual([]);
      expect(o.raw.categoriesPublished).toBe(false);
      expect(new URL(o.url).host).toBe("www.arts.nd.gov");
    }
  });
});

describe("new mexico: only the labelled 'published deadline of' phrase, never an event", () => {
  test("exactly two labelled milestones, both still open at the fixed clock", () => {
    const records = NM();
    expect(records.length).toBe(2);
    expect(records.map((o) => o.externalId)).toEqual(["advance-review", "final-deadline"]);
    expect(byId(records, "advance-review").closeDate).toBe("2026-10-23");
    expect(byId(records, "final-deadline").closeDate).toBe("2026-12-18");
    expect(count(records, "open")).toBe(2);
    expect(records[0]!.agency).toBe("New Mexico Arts");
  });

  test("the source's own sentence is the record, and the label is the only anchor", () => {
    const records = NM();
    for (const o of records) {
      expect(o.raw.labelledDeadlineResolvedToExactlyOneDay).toBe(true);
      expect(String(o.raw.closingText)).toContain("published deadline of");
      expect(o.raw.milestoneLabel).toBe(
        o.externalId === "advance-review" ? "Advance Review" : "Final Deadline",
      );
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.sourceClosed).toBe(false);
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      expect(o.url).toBe(newMexicoConnector.sourceUrl);
      expect(new URL(o.url).host).toBe("nmarts.org");
    }
    expect(byId(records, "final-deadline").summary).toContain(
      "published deadline of 11:59 PM MT December 18, 2026",
    );
  });

  test("the page's webinar dates are events and never become deadlines", () => {
    const records = NM();
    // "When: Sep 23, 2026 10:00 AM Mountain Time" is an EVENT on the same page.
    expect(records.some((o) => o.closeDate === "2026-09-23")).toBe(false);
    expect(records.some((o) => o.postedDate === "2026-09-23")).toBe(false);
    expect(JSON.stringify(records.map((o) => o.raw))).not.toContain("Sep 23");
    for (const o of records) {
      expect(o.closeDate === "2026-10-23" || o.closeDate === "2026-12-18").toBe(true);
    }
  });
});
