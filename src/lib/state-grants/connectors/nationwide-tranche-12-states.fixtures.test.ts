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
import { montanaConnector } from "~/lib/state-grants/connectors/montana";

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
const ALL = [
  ["NH", newHampshireConnector, NH],
  ["MT", montanaConnector, MT],
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
        expect(o.url).toBe(connector.sourceUrl);
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
