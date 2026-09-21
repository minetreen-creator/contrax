/**
 * NATIONWIDE WORKSTREAM — DETERMINISTIC FIXTURE TESTS for the continuous tranche
 * NV / OK / SC / IL (owner correction 2026-09-19, ratified 243: ONE continuous
 * nationwide workstream, ONE accumulating PR #408 — no batches).
 *
 * THE OWNER'S GUARDRAIL (2026-09-19): the DEFAULT suite must be deterministic and
 * touch NO network. Every page here is a SAVED, TRIMMED content-region fixture of
 * the real official source (`src/lib/state-grants/fixtures/…`, fetched
 * 2026-09-19), and the first test proves parsing + classifying all four produces
 * ZERO fetch calls. The live half lives in `<state>.source-validation.test.ts`,
 * which is opt-in (`bun run validate:live-sources`) and skipped loudly otherwise.
 *
 * WHAT THESE TESTS ARE FOR: the honesty traps each source carries —
 *   - an application WINDOW read as an ordered range (never a picked date),
 *   - "No end date" as the ONLY way a row becomes rolling,
 *   - a "Grant Activity Period" / "Project Activity Dates" that is NOT a deadline,
 *   - a deadline published as a RULE ("60 days before your project begins."),
 *   - the source's own "(Closed)" / "Closed" badge and its "Closed Grants:" section,
 *   - a passed published deadline served `closed` even under an "Open and Upcoming"
 *     heading or on a still-live listing,
 *   - "Not Applicable" award ranges that are not numbers,
 *   - a Letter-of-Intent note and a "five weeks" rule that are not deadlines,
 *   - the award-recipient / checklist links at the bottom of a listing,
 * — plus the owner's status model on real data.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type GrantOpportunity,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  publishedAmountRange,
  publishedRangeEnds,
} from "~/lib/state-grants/connectors/source-support";
import { nevadaConnector } from "~/lib/state-grants/connectors/nevada";
import { oklahomaConnector } from "~/lib/state-grants/connectors/oklahoma";
import { southCarolinaConnector } from "~/lib/state-grants/connectors/south-carolina";
import { illinoisConnector } from "~/lib/state-grants/connectors/illinois";

/** One fixed clock for every classification below (2026-09-19, US Eastern). */
const NOW = new Date("2026-09-19T12:00:00Z");
const TODAY = "2026-09-19";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

function parse(connector: StateGrantConnector<string>, name: string): GrantOpportunity[] {
  return parseGrantOpportunities(connector, fixture(name), NOW).opportunities;
}

const NV_FILE = "nevada-arts-council-grant-offerings.html";
const OK_FILE = "oklahoma-arts-council-grants.html";
const SC_FILE = "south-carolina-arts-commission-all-grants.html";
const IL_FILE = "illinois-csfa-opportunities.html";

const NV = () => parse(nevadaConnector, NV_FILE);
const OK = () => parse(oklahomaConnector, OK_FILE);
const SC = () => parse(southCarolinaConnector, SC_FILE);
const IL = () => parse(illinoisConnector, IL_FILE);

const ALL = [
  ["NV", nevadaConnector, NV, NV_FILE],
  ["OK", oklahomaConnector, OK, OK_FILE],
  ["SC", southCarolinaConnector, SC, SC_FILE],
  ["IL", illinoisConnector, IL, IL_FILE],
] as const;

function count(records: GrantOpportunity[], status: string): number {
  return records.filter((o) => o.status === status).length;
}

function exact(records: GrantOpportunity[], title: string): GrantOpportunity {
  const found = records.filter((o) => o.title === title);
  expect(found.length).toBe(1);
  return found[0]!;
}

function byTitle(records: GrantOpportunity[], needle: string): GrantOpportunity {
  const found = records.filter((o) => o.title.toLowerCase().includes(needle.toLowerCase()));
  expect(found.length).toBe(1);
  return found[0]!;
}

describe("nationwide continuous tranche (NV, OK, SC, IL) — determinism and shared invariants", () => {
  test("parsing and classifying all four fixtures makes ZERO network requests", () => {
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
        // The store requires `source_url` to equal the source's own official_url.
        expect(o.sourceUrl).toBe(connector.sourceUrl);
        expect(o.title.trim().length).toBeGreaterThan(2);
        expect(STATE_GRANT_STATUSES).toContain(o.status);
        // `forecast` is not a status any more (owner 2026-09-19).
        expect(o.status as string).not.toBe("forecast");
        // Every URL stays on the source's own official host.
        expect(new URL(o.url).host).toBe(new URL(connector.sourceUrl).host);
        expect(new URL(o.url).protocol).toBe("https:");
        for (const day of [o.postedDate, o.closeDate, o.estimatedCloseDate]) {
          if (day === null) continue;
          expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(Number.isNaN(Date.parse(`${day}T00:00:00Z`))).toBe(false);
        }
        // No estimate ever masquerades as a posted deadline.
        expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
        // No source in this tranche publishes an estimate at all.
        expect(o.estimatedCloseDate).toBeNull();
      }
    }
  });

  test("the owner's status model holds on every record (open needs a future published date)", () => {
    for (const [, , parseFn] of ALL) {
      for (const o of parseFn()) {
        const sourceClosed =
          o.raw.sourceClosedDeclaredBySource === true ||
          o.raw.cycleClosedDeclaredBySource === true ||
          o.raw.sectionDeclaresClosed === true;
        const rollingDeclared =
          o.raw.rollingDeclaredBySource === true || o.raw.ongoingDeclaredBySource === true;
        switch (o.status) {
          case "open":
            expect(o.closeDate).not.toBeNull();
            expect(o.closeDate! >= TODAY).toBe(true);
            expect(o.sourceClosed).toBe(false);
            break;
          case "upcoming":
            expect(o.postedDate).not.toBeNull();
            expect(o.postedDate! > TODAY).toBe(true);
            expect(o.closeDate).not.toBeNull();
            break;
          case "rolling":
            expect(rollingDeclared).toBe(true);
            expect(o.closeDate).toBeNull();
            break;
          case "closed":
            expect(sourceClosed || (o.closeDate !== null && o.closeDate < TODAY)).toBe(true);
            break;
          case "unverified":
            expect(o.closeDate).toBeNull();
            break;
          default:
            throw new Error(`unexpected status ${o.status}`);
        }
      }
    }
  });

  test("no record carries the string `forecast` anywhere in its raw payload", () => {
    for (const [, , parseFn] of ALL) {
      for (const o of parseFn()) {
        expect(JSON.stringify(o.raw).toLowerCase()).not.toContain("forecast");
      }
    }
  });
});

/**
 * The two shared helpers this tranche added, pinned at the source: a RANGE is read
 * as its ordered ends (never picked), and an amount range is the source's own
 * arithmetic (one amount = the ceiling the source states).
 */
describe("publishedRangeEnds / publishedAmountRange — the tranche's two new shared honesty helpers", () => {
  test("reads a two-ended application window in source order", () => {
    expect(publishedRangeEnds("08/25/2026 - 03/25/2027")).toEqual({
      startDay: "2026-08-25",
      endDay: "2027-03-25",
      openEnded: false,
      parts: ["08/25/2026", "03/25/2027"],
    });
  });

  test("the source's own \"No end date\" is the only open-ended wording", () => {
    const open = publishedRangeEnds("04/03/2025 - No end date");
    expect(open.startDay).toBe("2025-04-03");
    expect(open.endDay).toBeNull();
    expect(open.openEnded).toBe(true);
    // A near-miss is NOT open-ended and yields no end day either.
    expect(publishedRangeEnds("04/03/2025 - TBD").openEnded).toBe(false);
    expect(publishedRangeEnds("04/03/2025 - TBD").endDay).toBeNull();
  });

  test("a cell that is not exactly two ends is refused, never guessed", () => {
    expect(publishedRangeEnds("03/25/2027").startDay).toBeNull();
    expect(publishedRangeEnds("03/25/2027").endDay).toBeNull();
    expect(publishedRangeEnds("06/12/2026 - 09/11/2026 - 12/04/2026").endDay).toBeNull();
    // A year-less end parses to nothing rather than an invented year.
    expect(publishedRangeEnds("08/25/2026 - March 25").endDay).toBeNull();
  });

  test("an amount range is the source's own arithmetic, and one amount is the ceiling", () => {
    expect(publishedAmountRange("$15000 - $75000")).toEqual({ min: 15000, max: 75000 });
    expect(publishedAmountRange("Up to $1,800")).toEqual({ min: null, max: 1800 });
    // "Not Applicable" states no amount: nothing is invented.
    expect(publishedAmountRange("Not Applicable")).toEqual({ min: null, max: null });
    expect(publishedAmountRange("")).toEqual({ min: null, max: null });
  });
});

describe("Nevada (nvartscouncil.org) — the Council's labelled deadline, and nothing else, dates a card", () => {
  const records = NV;

  test("reads the ten FY27 program cards in both of the Council's own sections", () => {
    const parsed = records();
    expect(parsed.length).toBe(10);
    expect(parseGrantOpportunities(nevadaConnector, fixture(NV_FILE), NOW).collisions).toEqual([]);
    expect(count(parsed, "closed")).toBe(4);
    expect(count(parsed, "unverified")).toBe(6);
    expect(count(parsed, "open")).toBe(0);
  });

  test("a published deadline that has passed is `closed` even under the \"Open and Upcoming\" heading", () => {
    // The Council files the Heritage Fellowship and the Artist Fellowship Award
    // under "Open and Upcoming Grants:" while their own published deadline
    // (May 1, 2026) has gone by — the source's own dates decide (Alabama rule).
    const heritage = byTitle(records(), "Nevada Heritage Fellowship");
    expect(heritage.raw.sectionDeclaresClosed).toBe(false);
    expect(heritage.closeDate).toBe("2026-05-01");
    expect(heritage.closeDate! < TODAY).toBe(true);
    expect(heritage.status).toBe("closed");
    expect(heritage.raw.deadlineValue).toBe("May 1, 2026, 5 p.m. PST");
  });

  test("the Council's own \"Closed Grants:\" section is served closed", () => {
    for (const o of records().filter((r) => r.raw.sectionDeclaresClosed === true)) {
      expect(o.sourceClosed).toBe(true);
      expect(o.status).toBe("closed");
    }
    expect(byTitle(records(), "Project Grant for Organizations").raw.sectionDeclaresClosed).toBe(true);
    expect(byTitle(records(), "Arts Learning Project Grant").raw.sectionDeclaresClosed).toBe(true);
  });

  test("a deadline published as a RULE stays `unverified` — never inferred", () => {
    for (const o of records().filter((r) => r.raw.deadlineIsARuleWhenNoDayParsed === true)) {
      expect(o.closeDate).toBeNull();
      expect(o.status).toBe("unverified");
      expect(String(o.raw.deadlineValue).length).toBeGreaterThan(8);
    }
    const rules = records().filter((r) => r.raw.deadlineIsARuleWhenNoDayParsed === true);
    expect(rules.filter((r) => String(r.raw.deadlineValue).includes("At least 30 days before")).length).toBe(4);
    expect(byTitle(records(), "Folklife Artist Grant").status).toBe("unverified");
    expect(byTitle(records(), "Folklife Community Grant").status).toBe("unverified");
  });

  test("the \"Grant Activity Period\" is never read as an application deadline", () => {
    // Every card publishes a funded-ACTIVITY period (e.g. "July 1, 2026 – June
    // 30, 2027"): no record may carry one of its days as a deadline.
    for (const o of records()) {
      expect(o.raw.grantActivityPeriodIsNeverADeadline).toBe(true);
      expect(o.closeDate).not.toBe("2026-06-30");
      expect(o.postedDate).not.toBe("2026-07-01");
      expect(o.closeDate).not.toBe("2027-06-30");
    }
  });

  test("a card that publishes no deadline at all is `unverified`, never open", () => {
    const target = byTitle(records(), "Target of Opportunity Grant");
    expect(target.closeDate).toBeNull();
    expect(target.status).toBe("unverified");
    expect(target.raw.deadlineValue).toBe("Dependent upon funding source - consult with agency");
    expect(byTitle(records(), "Professional and Workforce Development Grant").closeDate).toBeNull();
  });

  test("the Council's own labelled facts are stored verbatim, and nothing else is inferred", () => {
    const heritage = byTitle(records(), "Nevada Heritage Fellowship");
    expect(heritage.eligibleApplicants).toBe("Individuals");
    expect(heritage.awardRange).toBe("$5,000");
    expect(heritage.awardMaxAmount).toBe(5000);
    expect(heritage.awardMinAmount).toBeNull();
    // The record's page is the program's OWN Guidelines page on the Council's host.
    expect(heritage.url).toBe(
      "https://www.nvartscouncil.org/fy27-heritage-fellowship-guidelines/",
    );
  });
});

describe("Oklahoma (oklahoma.gov) — the Council's two program indexes, read as ONE source", () => {
  const records = OK;

  test("reads all thirteen programs across the organizations and schools indexes", () => {
    const parsed = records();
    expect(parsed.length).toBe(13);
    expect(parseGrantOpportunities(oklahomaConnector, fixture(OK_FILE), NOW).collisions).toEqual([]);
    expect(count(parsed, "closed")).toBe(6);
    expect(count(parsed, "unverified")).toBe(7);
    expect(count(parsed, "open")).toBe(0);
    // Both indexes contributed: the schools index supplies the last six.
    expect(byTitle(parsed, "Classroom Supply Grants").sourceUrl).toBe(oklahomaConnector.sourceUrl);
    expect(byTitle(parsed, "Classroom Supply Grants").url).toBe(
      "https://oklahoma.gov/arts/grants/grants-for-schools.html",
    );
  });

  test("the Council's own \"(Closed)\" mark is the source's past tense, with its own date kept", () => {
    const alt = exact(records(), "Arts in Alt Ed Community Partnership");
    expect(alt.raw.deadlineValue).toBe("March 17, 2025 ( Closed )");
    expect(alt.raw.sourceClosedDeclaredBySource).toBe(true);
    expect(alt.sourceClosed).toBe(true);
    expect(alt.closeDate).toBe("2025-03-17");
    expect(alt.status).toBe("closed");
    // "(Closed)" alone names no day: closed, with NO invented date.
    const pol = exact(records(), "Poetry Out Loud Partnership Grant");
    expect(pol.raw.sourceClosedDeclaredBySource).toBe(true);
    expect(pol.closeDate).toBeNull();
    expect(pol.status).toBe("closed");
  });

  test("a deadline that is the Council's own RULE stays `unverified`", () => {
    const rules = records().filter((r) => r.raw.deadlineIsARuleWhenNoDayParsed === true);
    // Seven of the thirteen programs publish their deadline as a RULE, and the
    // Council publishes TWO different rules — "60 days before your project
    // begins" (six programs) and "30 days before the scheduled field trip date"
    // (Capitol Art Field Trips). Every one of them keeps its own words and
    // NOTHING is inferred from them: no day, so no close date, so not `open`.
    expect(rules.length).toBe(7);
    for (const o of rules) {
      expect(o.closeDate).toBeNull();
      expect(o.status).toBe("unverified");
      expect(String(o.raw.deadlineValue)).toMatch(/\bdays? before\b/);
    }
    // The source's exact wording is stored verbatim, rules included.
    expect(
      String(byTitle(records(), "Rural Arts Opportunity Grants").raw.deadlineValue),
    ).toContain("60 days before your project begins");
    expect(
      String(byTitle(records(), "Capitol Art Field Trip Grants").raw.deadlineValue),
    ).toContain("30 days before the scheduled field trip date");
    expect(byTitle(records(), "Rural Arts Opportunity Grants").status).toBe("unverified");
  });

  test("the \"Project Activity Dates\" grant period is never read as a deadline", () => {
    for (const o of records()) {
      expect(o.raw.projectActivityDatesIsNeverADeadline).toBe(true);
      expect(o.closeDate).not.toBe("2027-06-30");
      expect(o.closeDate).not.toBe("2027-06-31");
    }
    expect(typeof byTitle(records(), "Community Arts Learning Grants").raw.projectActivityDates).toBe(
      "string",
    );
  });

  test("the schools index's own \"Application Period: April 1 – May 1, 2026 … (closed)\" is read as a published window (QA finding, tranche NV/OK/SC/IL)", () => {
    const sch = exact(records(), "Oklahoma Poetry Out Loud Partnership Grant");
    // The Council's own value under its OTHER own label, verbatim.
    expect(String(sch.raw.applicationPeriod)).toContain("April 1");
    expect(String(sch.raw.applicationPeriod)).toContain(
      "May 1, 2026, at 5:00 p.m. Central Time (closed)",
    );
    // ...and it is never read from the card's "Project Activity Dates" paragraph.
    expect(sch.raw.deadlineValue).toBeNull();
    // Read as its two SOURCE-ORDERED ends — never as one picked date.
    const ends = sch.raw.applicationPeriodEnds as string[];
    expect(ends.length).toBe(2);
    expect(ends[0]).toBe("April 1");
    expect(ends[1]).toContain("May 1, 2026");
    expect(sch.raw.applicationPeriodIsOrderedRange).toBe(true);
    // The opening end publishes no year of its own: its year comes from the
    // window's own closing end, and it is NEVER served as a date of the record.
    expect(sch.raw.applicationPeriodStartDay).toBe("2026-04-01");
    expect(sch.raw.applicationPeriodStartDayYearComesFromTheWindowsClosingEnd).toBe(true);
    expect(sch.raw.applicationPeriodEndDay).toBe("2026-05-01");
    expect(sch.postedDate).toBeNull();
    // The Council's "(closed)" mark AND the window's end agree: closed, dated.
    expect(sch.raw.applicationPeriodClosedMarkerDeclaredBySource).toBe(true);
    expect(sch.sourceClosed).toBe(true);
    expect(sch.closeDate).toBe("2026-05-01");
    expect(sch.status).toBe("closed");
    // The "Project Activity Dates" period on the same card is still not a date.
    expect(String(sch.raw.projectActivityDates)).toContain("July 1, 2026");
    expect(sch.closeDate).not.toBe("2027-06-30");
    // The orgs-index counterpart is UNCHANGED: its own label publishes "( Closed )"
    // and no day at all, so it stays closed with NO invented date.
    const org = exact(records(), "Poetry Out Loud Partnership Grant");
    expect(org.raw.deadlineValue).toBe("( Closed )");
    expect(org.raw.applicationPeriod).toBeNull();
    expect(org.sourceClosed).toBe(true);
    expect(org.closeDate).toBeNull();
    expect(org.status).toBe("closed");
  });

  test("the Council's own \"(closed)\" mark and its own end date must AGREE (a disagreeing date is withheld)", () => {
    const sch = exact(records(), "Oklahoma Poetry Out Loud Partnership Grant");
    // Before the window's own end, the past tense still wins for the STATUS — the
    // cycle can never be served open — but no contradicting date is served.
    const early = oklahomaConnector.classify(sch, new Date("2026-04-15T12:00:00Z"));
    expect(early.status).toBe("closed");
    expect(early.closeDate).toBeNull();
    // From the end day onwards the two agree and the source's own date is served.
    const atEnd = oklahomaConnector.classify(sch, new Date("2026-05-01T12:00:00Z"));
    expect(atEnd.status).toBe("closed");
    expect(atEnd.closeDate).toBe("2026-05-01");
    // A passed published date with NO marker is untouched by this rule: the
    // Classroom Supply card is closed by its own date alone, with its date kept.
    const classroom = byTitle(records(), "Classroom Supply Grants");
    expect(classroom.sourceClosed).toBe(false);
    expect(
      oklahomaConnector.classify(classroom, new Date("2026-08-01T12:00:00Z")).closeDate,
    ).toBe("2026-09-15");
  });

  test("a passed published window is closed, and NOTHING but the Council's own window labels dates a card", () => {
    const classroom = byTitle(records(), "Classroom Supply Grants");
    expect(classroom.closeDate).toBe("2026-09-15");
    expect(classroom.closeDate! < TODAY).toBe(true);
    expect(classroom.status).toBe("closed");
    // Every dated record is dated under one of the Council's OWN window labels —
    // "Application Deadlines" or, on the schools index, "Application Period".
    for (const o of records()) {
      if (o.closeDate === null) continue;
      expect(o.raw.deadlineValue !== null || o.raw.applicationPeriodEndDay !== null).toBe(true);
      expect(o.raw.projectActivityDatesIsNeverADeadline).toBe(true);
    }
    // No card in this source publishes NO window at all...
    const none = records().filter((r) => r.raw.cardPublishesNoApplicationWindow === true);
    expect(none.length).toBe(0);
    // ...and exactly ONE card publishes no "Application Deadlines" paragraph: its
    // window is the "Application Period" the test above pins.
    const noDeadlineParagraph = records().filter(
      (r) => r.raw.cardPublishesNoApplicationDeadline === true,
    );
    expect(noDeadlineParagraph.length).toBe(1);
    expect(noDeadlineParagraph[0]!.title).toBe("Oklahoma Poetry Out Loud Partnership Grant");
    expect(noDeadlineParagraph[0]!.raw.applicationPeriodEndDay).toBe("2026-05-01");
    expect(noDeadlineParagraph[0]!.status).toBe("closed");
    // ...and the field-trip card publishes a RULE instead, which is not a date.
    expect(String(exact(records(), "Capitol Art Field Trip Grants").raw.deadlineValue)).toContain(
      "30 days before the scheduled field trip date",
    );
  });

  test("the Council's own Grant Amount is stored, and nothing off-host is served as a page", () => {
    const rural = byTitle(records(), "Rural Arts Opportunity Grants");
    expect(rural.awardRange).toBe("Up to $5,000 per organization");
    expect(rural.awardMaxAmount).toBe(5000);
    for (const o of records()) {
      expect(new URL(o.url).host).toBe("oklahoma.gov");
      expect(o.url.endsWith(".pdf")).toBe(false);
    }
  });
});

describe("South Carolina (southcarolinaarts.com) — the 14 closed cards are never served open", () => {
  const records = SC;

  test("reads all nineteen cards: five open and fourteen closed", () => {
    const parsed = records();
    expect(parsed.length).toBe(19);
    expect(parseGrantOpportunities(southCarolinaConnector, fixture(SC_FILE), NOW).collisions).toEqual([]);
    expect(count(parsed, "open")).toBe(5);
    expect(count(parsed, "closed")).toBe(14);
    expect(count(parsed, "rolling")).toBe(0);
  });

  test("every card the Commission badges Closed is served closed, with no invented status", () => {
    const badged = records().filter((o) => o.raw.statusBadgeToken === "closed");
    expect(badged.length).toBe(14);
    for (const o of badged) {
      expect(o.raw.statusBadgeText).toBe("Closed");
      expect(o.sourceClosed).toBe(true);
      expect(o.status).toBe("closed");
    }
  });

  test("the Open / Closing Soon badges never date a card: the published window does", () => {
    const openBadged = records().filter((o) => o.raw.statusBadgeToken !== "closed");
    expect(openBadged.length).toBe(5);
    for (const o of openBadged) {
      // The Commission's own Application Period is the only date input, and every
      // Open/Closing-Soon window ends in the future — so nothing is served open
      // off a badge whose own published end date had passed.
      expect(o.closeDate).not.toBeNull();
      expect(o.closeDate! >= TODAY).toBe(true);
      expect(o.status).toBe("open");
      expect(String(o.raw.applicationPeriodText)).toMatch(/^\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/);
    }
    expect(byTitle(records(), "Emerging Artist Grants").raw.statusBadgeText).toBe("Closing Soon");
    expect(byTitle(records(), "Emerging Artist Grants").closeDate).toBe("2026-09-24");
  });

  test("the five-weeks rule and the Letter-of-Intent note are never deadlines", () => {
    for (const o of records()) {
      expect(o.raw.fiveWeeksRuleIsNeverADeadline).toBe(true);
      expect(o.raw.letterOfIntentNoteIsNeverADeadline).toBe(true);
    }
    const bfa = byTitle(records(), "Barrier-Free Arts SC Grants");
    expect(String(bfa.raw.letterOfIntentNoteText)).toContain("Letter of Intent deadline");
    // Its own Application Period dates are still what is served.
    expect(bfa.closeDate).toBe("2026-04-16");
    expect(bfa.status).toBe("closed");
  });

  test("the Commission's own Funding and Matching values are stored verbatim", () => {
    const aps = byTitle(records(), "Arts Project Support Grants");
    expect(aps.awardRange).toBe("Up to $2,500 within a fiscal year");
    expect(aps.matchingRequirement).toBe("1:2 for artists, 1:1 for organizations");
    expect(aps.url).toBe("https://www.southcarolinaarts.com/grant/aps/");
    expect(byTitle(records(), "Accessibility Grants").matchingRequirement).toBe("1:1 (grantee:SCAC)");
    expect(byTitle(records(), "Emerging Artist Grants").matchingRequirement).toBe("None");
  });

  test("a record's page is its own Learn More page on the agency's host, never the scheduling link", () => {
    for (const o of records()) {
      expect(o.url.startsWith("https://www.southcarolinaarts.com/grant/")).toBe(true);
      expect(o.url).not.toContain("calendly.com");
    }
    expect(records().map((o) => o.externalId)).toContain("aca");
  });
});

describe("Illinois (omb.illinois.gov) — the CSFA current-opportunity list, located live", () => {
  const records = IL;

  test("reads the whole unpaginated list the State itself counts (121 rows)", () => {
    const parsed = records();
    expect(parsed.length).toBe(121);
    expect(parseGrantOpportunities(illinoisConnector, fixture(IL_FILE), NOW).collisions).toEqual([]);
    // The page states its own total; the parse must agree with it.
    expect(fixture(IL_FILE)).toContain("Opportunities: 121");
    expect(count(parsed, "rolling")).toBe(82);
    expect(count(parsed, "open")).toBe(39);
    expect(count(parsed, "closed")).toBe(0);
  });

  test("the State's own \"No end date\" is the ONLY thing that makes a row rolling", () => {
    const rolling = records().filter((o) => o.status === "rolling");
    expect(rolling.length).toBe(82);
    for (const o of rolling) {
      expect(o.raw.noEndDateDeclaredBySource).toBe(true);
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(String(o.raw.applicationDateRange)).toMatch(/ - No end date$/);
      expect(o.closeDate).toBeNull();
    }
    // No two-ended row is ever rolling.
    for (const o of records().filter((r) => r.status === "open")) {
      expect(o.raw.noEndDateDeclaredBySource).toBe(false);
      expect(o.closeDate).not.toBeNull();
      expect(o.closeDate! >= TODAY).toBe(true);
      expect(String(o.raw.applicationDateRange)).toMatch(
        /^\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/,
      );
    }
  });

  test("the Application Date Range is read as its two ordered ends", () => {
    const foster = byTitle(records(), "FY2027 Foster Grandparent Program");
    expect(foster.raw.applicationDateRange).toBe("09/15/2026 - 09/21/2026");
    expect(foster.postedDate).toBe("2026-09-15");
    expect(foster.closeDate).toBe("2026-09-21");
    expect(foster.status).toBe("open");
    const nurse = byTitle(records(), "FY27 Nurse Educator Fellowship Program");
    expect(nurse.postedDate).toBe("2026-08-26");
    expect(nurse.closeDate).toBe("2026-10-30");
  });

  test("\"Not Applicable\" award ranges are not numbers, and stated ones are the State's own", () => {
    const th = byTitle(records(), "Targeted Holistic Resources to Invest in Vision");
    expect(th.raw.awardRangeStatedAsNotApplicable).toBe(true);
    expect(th.awardRange).toBe("Not specified");
    expect(th.awardMinAmount).toBeNull();
    expect(th.awardMaxAmount).toBeNull();
    const foster = byTitle(records(), "FY2027 Foster Grandparent Program");
    expect(foster.awardRange).toBe("$14132 - $83369");
    expect(foster.awardMinAmount).toBe(14132);
    expect(foster.awardMaxAmount).toBe(83369);
  });

  test("a record's identity and page are the State's own, always on its own host", () => {
    // The State hosts this notice itself → its own `nofo=` id is the identity.
    expect(byTitle(records(), "Targeted Holistic Resources to Invest in Vision").externalId).toBe(
      "nofo-4339",
    );
    // The GMS rows forward to the State's grant-management front end: the State's
    // own detail GUID is the identity, and the URL never leaves omb.illinois.gov.
    const gms = byTitle(records(), "FY2027 Foster Grandparent Program");
    expect(gms.externalId).toBe("gms-4ebf153e-f381-41be-a1b7-7aacffe165a9");
    for (const o of records()) {
      expect(new URL(o.url).host).toBe("omb.illinois.gov");
    }
  });

  test("the row's own Agency column is kept as the source's value", () => {
    expect(byTitle(records(), "FY2027 Foster Grandparent Program").agency).toBe("AGE (402)");
    expect(byTitle(records(), "Targeted Holistic Resources to Invest in Vision").agency).toBe("BHE (601)");
  });
});
