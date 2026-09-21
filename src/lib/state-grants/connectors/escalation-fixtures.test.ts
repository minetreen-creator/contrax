/**
 * ESCALATION PASS — DETERMINISTIC FIXTURE TESTS for the two connectors this
 * delegation lands (Tennessee, Utah) under the owner's escalation order of
 * 2026-09-19 (batch checklist §0.5).
 *
 * THE OWNER'S GUARDRAIL: the DEFAULT suite must be deterministic and touch NO
 * network. Both pages here are SAVED fixtures of the real official sources
 * (`src/lib/state-grants/fixtures/…`, captured 2026-09-19 with the team's bot UA
 * and copied verbatim as a contiguous content slice), and the first test proves
 * that parsing + classifying both produces ZERO fetch calls. The live half lives
 * in `<state>.source-validation.test.ts`, which is opt-in
 * (`bun run validate:live-sources`) and skipped loudly otherwise.
 *
 * WHAT THESE TESTS ARE FOR: the honesty traps these two sources carry —
 * a milestone calendar whose lines are NOT programs, two lines that are not
 * dates at all (a month, a month range), a cycle-wide opening bullet that must
 * not be invented and must not be copied onto a program it does not name,
 * dated INFORMATIONAL WEBINARS that are events and never deadlines, and an
 * "ongoing legislative pass-through funding" eligibility sentence that must not
 * flip a program to `rolling`.
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
import {
  TENNESSEE_APPROVED_HOSTS,
  parseTennesseeCycleDates,
  tennesseeConnector,
} from "~/lib/state-grants/connectors/tennessee";
import { UTAH_APPROVED_HOSTS, utahConnector } from "~/lib/state-grants/connectors/utah";
/** One fixed clock for every classification below (2026-09-19, noon UTC). */
const NOW = new Date("2026-09-19T12:00:00Z");
function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}
function fixtureText(name: string): string {
  return fixture(name)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}
function parse(connector: StateGrantConnector<string>, name: string): GrantOpportunity[] {
  return parseGrantOpportunities(connector, fixture(name), NOW).opportunities;
}
const TN_FILE = "tennessee-arts-important-dates.html";
const UT_FILE = "utah-arts-project-grants.html";
const TN = () => parse(tennesseeConnector, TN_FILE);
const UT = () => parse(utahConnector, UT_FILE);
const ALL = [
  ["TN", tennesseeConnector, TN, TN_FILE],
  ["UT", utahConnector, UT, UT_FILE],
] as const;
function count(records: GrantOpportunity[], status: string): number {
  return records.filter((o) => o.status === status).length;
}
function byId(records: GrantOpportunity[], id: string): GrantOpportunity {
  const found = records.find((o) => o.externalId === id);
  if (!found) throw new Error(`fixture no longer publishes ${id}`);
  return found;
}

describe("escalation pass (TN, UT) — determinism and shared invariants", () => {
  test("parsing and classifying both fixtures makes ZERO network requests", () => {
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
        expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
        expect(o.estimatedCloseDate).toBeNull();
        if (o.status === "unverified" || o.status === "rolling") {
          expect(o.closeDate).toBeNull();
        }
        expect(o.summary.length).toBeGreaterThan(0);
        expect(o.title.length).toBeGreaterThan(2);
        expect(o.eligibleApplicants).toBe(NOT_SPECIFIED);
        expect(o.eligibleGeography).toBe(NOT_SPECIFIED);
        expect(o.categories).toEqual([]);
        expect(o.awardRange).toBe(NOT_SPECIFIED);
        expect(new URL(o.url).protocol).toBe("https:");
        for (const day of [o.postedDate, o.closeDate]) {
          expect(day === null || /^\d{4}-\d{2}-\d{2}$/.test(day)).toBe(true);
        }
      }
    }
  });

  test("every parsed title really appears in its own page's text", () => {
    for (const [, , parseFixture, file] of ALL) {
      const text = fixtureText(file);
      for (const o of parseFixture()) {
        expect(text).toContain(o.title.replace(/\s+/g, " ").trim());
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
    // The fetch gate must not parse a page that arrived from a host the
    // connector did not approve (QA flag #5). No network: fetch is injected.
    const body = fixture(TN_FILE);
    const fake = (url: string) =>
      (async () => ({
        status: 200,
        url,
        text: async () => body,
      })) as unknown as typeof fetch;
    const run = async (url: string) =>
      fetchStateGrantSource({
        url: tennesseeConnector.sourceUrl,
        marker: "<h2>Important Dates</h2>",
        label: "Tennessee",
        approvedHosts: TENNESSEE_APPROVED_HOSTS,
        fetchImpl: fake(url),
      });
    let offHost: unknown = null;
    try {
      await run("https://evil.example.com/grants");
    } catch (e) {
      offHost = e;
    }
    expect((offHost as { stage?: string }).stage).toBe("fetch");
    // The approved host passes the same gate.
    expect(await run(tennesseeConnector.sourceUrl)).toBe(body);
    // Utah's own allowlist is a `.gov` domain, and the same rule applies.
    expect(UTAH_APPROVED_HOSTS).toContain(new URL(utahConnector.sourceUrl).host);
    for (const o of UT()) expect(UTAH_APPROVED_HOSTS).toContain(new URL(o.url).host);
  });
});

describe("tennessee: the FY28 milestone calendar, read line by line", () => {
  test("six published lines, of which only three are dated deadlines", () => {
    const lines = parseTennesseeCycleDates(fixture(TN_FILE));
    expect(lines.length).toBe(6);
    // The two month-only lines are NOT dates: a month, and a month RANGE, can
    // never become a day.
    expect(lines.map((l) => l.day)).toEqual([
      null,
      "2026-10-09",
      "2026-12-18",
      "2027-01-08",
      "2027-01-15",
      null,
    ]);
    // Only the lines whose own words say "Due" are deadlines.
    expect(lines.filter((l) => l.isDeadline).map((l) => l.label)).toEqual([
      "FY28 Operating Support Applications Due",
      "FY28 Project Support Applications Due",
      "FY28 Individual Artist Fellowship Applications Due",
    ]);
    // The cycle's opening line and the two non-date lines are not deadlines.
    expect(lines.filter((l) => !l.isDeadline).map((l) => l.day)).toEqual([
      null,
      "2026-10-09",
      null,
    ]);
  });

  test("three records: the three annual-grant deadlines, with the cycle's own opening day", () => {
    const records = TN();
    expect(records.length).toBe(3);
    expect(records.map((o) => o.externalId)).toEqual([
      "fy28-operating-support-applications-due",
      "fy28-project-support-applications-due",
      "fy28-individual-artist-fellowship-applications-due",
    ]);
    expect(byId(records, "fy28-operating-support-applications-due").closeDate).toBe("2026-12-18");
    expect(byId(records, "fy28-project-support-applications-due").closeDate).toBe("2027-01-08");
    expect(
      byId(records, "fy28-individual-artist-fellowship-applications-due").closeDate,
    ).toBe("2027-01-15");
    // All three are `upcoming` at the fixed clock: the source's own opening day
    // (October 9, 2026) has not arrived yet, so the classifier must not call them
    // open. After that day the SAME records classify `open` (the published close
    // date is still ahead).
    expect(count(records, "upcoming")).toBe(3);
    for (const o of records) {
      expect(o.postedDate).toBe("2026-10-09");
      expect(o.raw.cycleOpeningText).toBe("October 9, 2026 - FY28 Annual Grant Applications Open");
      expect(o.raw.cycleOpeningDayUsedAsOpeningDate).toBe("2026-10-09");
      expect(o.raw.cycle).toBe("FY28");
      expect(o.sourceClosed).toBe(false);
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      expect(o.raw.listPublishesProgramDetail).toBe(false);
      expect(o.url).toBe(tennesseeConnector.sourceUrl);
      expect(new URL(o.url).host).toBe("tnartscommission.org");
    }
    // The deadline a reader sees is the source's own line, verbatim.
    expect(byId(records, "fy28-operating-support-applications-due").raw.closingText).toBe(
      "December 18, 2026 - FY28 Operating Support Applications Due (NEW Earlier Deadline)",
    );
  });

  test("the same page one day after its own opening day flips the records to open", () => {
    const after = parseGrantOpportunities(
      tennesseeConnector,
      fixture(TN_FILE),
      new Date("2026-10-10T12:00:00Z"),
    ).opportunities;
    expect(count(after, "open")).toBe(3);
  });

  test("a month-only or month-range line never becomes a date or a record", () => {
    const records = TN();
    const json = JSON.stringify(records.map((o) => ({ ...o, raw: o.raw })));
    expect(json).not.toContain("Panel Meetings");
    expect(json).not.toContain("Guidelines Post");
    for (const o of records) {
      expect(o.closeDate === "2026-12-18" || o.closeDate === "2027-01-08" ||
        o.closeDate === "2027-01-15").toBe(true);
      expect(o.postedDate).not.toBe("2026-09-01");
      expect(o.postedDate).not.toBe("2027-03-01");
    }
  });

  test("a line publishing TWO different days resolves to nothing, never to one of them", () => {
    const twoDays =
      '<section id="next-section"><h2>Important Dates</h2><ul class="dates-list">' +
      "<li>December 18, 2026 - FY28 Operating Support Applications Due</li>" +
      "<li>January 8, 2027 - FY28 Project Support Applications Due / March 5, 2027 - FY28 Late Round</li>" +
      "</ul>";
    const lines = parseTennesseeCycleDates(twoDays);
    expect(lines.length).toBe(2);
    expect(lines[0]!.day).toBe("2026-12-18");
    expect(lines[1]!.day).toBeNull();
    // …and the ambiguous line is therefore not a record at all.
    const records = parseTennesseeConnector(twoDays);
    expect(records.length).toBe(1);
    expect(records[0]!.externalId).toBe("fy28-operating-support-applications-due");
  });

  test("a list with no dated deadline fails closed rather than reporting an empty corpus", () => {
    const noDeadlines =
      '<section id="next-section"><h2>Important Dates</h2><ul class="dates-list">' +
      "<li>September 2026 - FY28 Annual Grant Guidelines Post</li>" +
      "<li>March-April 2027 - FY28 Annual Grant Panel Meetings</li></ul>";
    let thrown: unknown = null;
    try {
      parseTennesseeConnector(noDeadlines);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { stage?: string }).stage).toBe("parse");
  });
});

describe("utah: per-program Grant Opens / Grant Closes, and webinars that are not deadlines", () => {
  test("three programs, each with the source's own opening and closing day", () => {
    const records = UT();
    expect(records.length).toBe(3);
    expect(records.map((o) => o.externalId)).toEqual([
      "folk-arts",
      "creative-aging",
      "individual-artist-advancement",
    ]);
    expect(byId(records, "folk-arts").postedDate).toBe("2026-07-06");
    expect(byId(records, "folk-arts").closeDate).toBe("2026-08-17");
    expect(byId(records, "creative-aging").postedDate).toBe("2026-08-03");
    expect(byId(records, "creative-aging").closeDate).toBe("2026-08-28");
    expect(byId(records, "individual-artist-advancement").postedDate).toBe("2026-07-20");
    expect(byId(records, "individual-artist-advancement").closeDate).toBe("2026-08-14");
    expect(records[0]!.agency).toBe("Utah Division of Arts & Museums");
  });

  test("all three published cycles have closed at the fixed clock, and none is deleted", () => {
    const records = UT();
    expect(count(records, "closed")).toBe(3);
    for (const o of records) {
      expect(o.statusReason).toContain("published closing date has passed");
      expect(o.sourceClosed).toBe(false);
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      expect(o.raw.closingDayPublishedBySource).toBe(o.closeDate);
      expect(o.url).toBe(utahConnector.sourceUrl);
      expect(new URL(o.url).host).toBe("artsandmuseums.utah.gov");
      expect(String(o.raw.closingText)).toContain("5:00pm MT");
    }
  });

  test("the dated Info Sessions are events and never become a deadline", () => {
    const records = UT();
    // The page's own webinar days: July 21 (Folk Arts), August 12 (Creative
    // Aging) and July 22 (Individual Artist Advancement), 2026.
    for (const day of ["2026-07-21", "2026-08-12", "2026-07-22"]) {
      expect(records.some((o) => o.closeDate === day)).toBe(false);
      expect(records.some((o) => o.postedDate === day)).toBe(false);
    }
    for (const o of records) {
      expect(o.raw.infoSessionDayIsNeverADeadline).toBe(true);
      expect(typeof o.raw.infoSessionLine).toBe("string");
      expect(String(o.raw.infoSessionLine)).toMatch(/2026/);
    }
    // "Watch the info session recording" copy is not a date either.
    expect(JSON.stringify(UT().map((o) => o.raw))).not.toContain("startTime");
  });

  test("the page's 'ongoing legislative pass-through funding' sentence never makes a program rolling", () => {
    // The live page carries an eligibility block reading "Organizations that
    // receive ongoing legislative pass-through funding … are not eligible for
    // UA&M grant funding." — a use of the word "ongoing" that has nothing to do
    // with a rolling deadline. Two independent guards keep it away from
    // `declaresOngoing()`: it sits BEYOND the listing region (so it is not even in
    // the cut fixture — asserted here), and `rolling` is decided on each program's
    // own labelled schedule text, never on a whole panel.
    expect(fixture(UT_FILE)).not.toContain("ongoing legislative pass-through funding");
    expect(fixtureText(UT_FILE)).not.toContain("ongoing");
    for (const o of UT()) {
      expect(o.status).not.toBe("rolling");
      expect(o.closeDate).not.toBeNull();
      expect(o.raw.rollingDeclaredBySource).toBe(false);
    }
  });

  test("the labelled values are read separately, so a two-day paragraph is not ambiguous", () => {
    // Grant Opens and Grant Closes share one paragraph, separated by a <br />.
    // Reading the paragraph as a whole would see two days and refuse both; the
    // connector reads each LABELLED value, which is why both are real dates.
    const records = UT();
    for (const o of records) {
      expect(o.raw.openingText).not.toBeNull();
      expect(o.raw.closingText).not.toBeNull();
      expect(o.postedDate).not.toBe(o.closeDate);
    }
  });

  test("a program panel with no published schedule stays a record and stays unverified", () => {
    const onePanel =
      '<h1 class="x-text-content-text-primary">Project Support Grants</h1>' +
      '<h2 class="x-text-content-text-primary">Grants Information</h2>' +
      '<h3 class="psg heading">Folk Arts</h3>' +
      "<p><strong>Grant Opens:</strong> Monday, July 6, 2026<br />" +
      "<strong>Grant Closes:</strong> Monday, August 17, 2026 at 5:00pm MT</p>" +
      '<h3 class="psg heading">New Program</h3><p>Details to follow.</p>' +
      "Grants Frequently Asked Questions";
    const records = parseUtahGrantsPageForTest(onePanel);
    expect(records.length).toBe(2);
    const blank = records[1]!;
    expect(blank.title).toBe("New Program");
    expect(blank.closeDate).toBeNull();
    expect(blank.postedDate).toBeNull();
    expect(blank.summary).toBe(NOT_SPECIFIED);
  });
});

function parseTennesseeConnector(html: string): GrantOpportunity[] {
  return parseGrantOpportunities(tennesseeConnector, html, NOW).opportunities;
}
function parseUtahGrantsPageForTest(html: string): GrantOpportunity[] {
  return parseGrantOpportunities(utahConnector, html, NOW).opportunities;
}
