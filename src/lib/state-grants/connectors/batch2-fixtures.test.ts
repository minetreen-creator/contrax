/**
 * NATIONWIDE BATCH 1 — DETERMINISTIC FIXTURE TESTS for the three new state
 * connectors (California, Kansas, Washington).
 *
 * WHY "batch 2": the previous branch's batch shipped five connectors in
 * `batch1-fixtures.test.ts` (Arizona, Delaware, Pennsylvania, Rhode Island,
 * Hawaii). This branch continues the nationwide program on its own accumulating
 * branch/PR, so its batch-1 slice (CA, KS, WA) uses its own file — named for QA
 * (the batch brief asks for an explicit name, QA flag #7). North Carolina and
 * Utah exited batch 1 under the checklist §0 exit rule (no dependable official
 * dated listing) and have NO connector: they stay `unavailable`.
 *
 * THE OWNER'S GUARDRAIL (2026-09-19): the DEFAULT suite must be deterministic and
 * touch NO network. Every page here is a SAVED fixture of the real official
 * source (`src/lib/state-grants/fixtures/…`, fetched 2026-09-19, copied verbatim),
 * and the first test in this file proves that parsing + classifying all three
 * produces ZERO fetch calls. The live half lives in
 * `<state>.source-validation.test.ts`, which is opt-in (`bun run
 * validate:live-sources`) and skipped loudly otherwise.
 *
 * WHAT THESE TESTS ARE FOR: the honesty traps each source carries — a window's
 * year-less START that must never be given a year, an opening announcement that
 * is NOT a deadline, a link off the allowlist that falls back to the listing, a
 * two-digit-year Open Date that is never parsed, a month-range calendar whose
 * "Announcement"/"Awards Given" month labels are NOT deadlines — plus the owner's
 * status model on real data.
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
import { californiaConnector } from "~/lib/state-grants/connectors/california";
import { kansasConnector } from "~/lib/state-grants/connectors/kansas";
import { washingtonConnector } from "~/lib/state-grants/connectors/washington";

/** One fixed clock for every classification below (2026-09-19, US Eastern). */
const NOW = new Date("2026-09-19T12:00:00Z");

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

function parse(connector: StateGrantConnector<string>, name: string): GrantOpportunity[] {
  return parseGrantOpportunities(connector, fixture(name), NOW).opportunities;
}

const CA = () => parse(californiaConnector, "california-grants-portal.html");
const KS = () => parse(kansasConnector, "kansas-grants-calendar.html");
const WA = () => parse(washingtonConnector, "washington-arts.html");

const ALL = [
  ["CA", californiaConnector, CA, "california-grants-portal.html"],
  ["KS", kansasConnector, KS, "kansas-grants-calendar.html"],
  ["WA", washingtonConnector, WA, "washington-arts.html"],
] as const;

function count(records: GrantOpportunity[], status: string): number {
  return records.filter((o) => o.status === status).length;
}

describe("batch 2 (nationwide batch 1: CA, KS, WA) — determinism and shared invariants", () => {
  test("parsing and classifying all three fixtures makes ZERO network requests", () => {
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
    const body = fixture("washington-arts.html");
    const fakeOk = (async () => ({
      status: 200,
      url: "https://www.arts.wa.gov/grants/",
      text: async () => body,
    })) as unknown as typeof fetch;
    const fakeOffHost = (async () => ({
      status: 200,
      url: "https://grants.vendor-portal.example/wa",
      text: async () => body,
    })) as unknown as typeof fetch;

    // The approved host passes …
    await expect(
      fetchStateGrantSource({
        url: washingtonConnector.sourceUrl,
        marker: "Open and upcoming grants",
        label: "Washington",
        fetchImpl: fakeOk,
        approvedHosts: ["www.arts.wa.gov", "arts.wa.gov"],
      }),
    ).resolves.toBe(body);

    // … and the same body from an unapproved host is a FETCH failure.
    let thrown: unknown = null;
    try {
      await fetchStateGrantSource({
        url: washingtonConnector.sourceUrl,
        marker: "Open and upcoming grants",
        label: "Washington",
        fetchImpl: fakeOffHost,
        approvedHosts: ["www.arts.wa.gov", "arts.wa.gov"],
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect((thrown as { stage?: string }).stage).toBe("fetch");
    expect((thrown as Error).message).toContain("redirected off the approved hosts");
  });
});

describe("california: machine-readable deadlines only, and never a two-digit year", () => {
  test("the Active results listing yields its twenty grants, in page order", () => {
    const records = CA();
    expect(records.length).toBe(20);
    expect(records[0]!.externalId).toBe("2027-specialty-crop-block-grant-program");
    expect(records[0]!.title).toBe("2027 Specialty Crop Block Grant Program");
    expect(records[0]!.url).toBe(
      "https://www.grants.ca.gov/grants/2027-specialty-crop-block-grant-program/",
    );
    expect(records[0]!.raw.portalId).toBe("191016");
    expect(new Set(records.map((o) => o.externalId)).size).toBe(20);
  });

  test("the deadline comes from <time datetime>, and every record classifies open today", () => {
    const records = CA();
    expect(count(records, "open")).toBe(20);
    expect(records[0]!.closeDate).toBe("2026-09-21");
    expect(records[0]!.raw.deadlineDateTimeAttribute).toBe("Mon, 21 Sep 2026 09:00:00 +0000");
    for (const o of records) {
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.sourceStatusClass).toBe("active");
      expect(o.raw.sourceStatusLabel).toBe("Active");
      expect(o.sourceClosed).toBe(false);
    }
  });

  test("the Open Date cell's TWO-DIGIT year is never parsed into a date", () => {
    for (const o of CA()) {
      // The portal publishes the Open Date as "8/24/26 13:55" — a two-digit year
      // the owner's rule refuses. It is kept verbatim in raw, never guessed.
      expect(o.postedDate).toBeNull();
      expect(String(o.raw.openDateText)).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}\s/);
      expect(String(o.raw.openDateUnparsedReason)).toContain("two-digit year");
    }
  });

  test("a forecasted cycle's date would be an estimate, never a deadline", () => {
    // Same page, the portal's other status word: "Forecasted" must send the date
    // to estimated_close_date and leave the record `unverified`.
    const forecasted = fixture("california-grants-portal.html")
      .replace(/status--active/g, "status--forecasted")
      .replace(/Active\s*<\/span>/g, "Forecasted</span>");
    const records = parseGrantOpportunities(californiaConnector, forecasted, NOW).opportunities;
    expect(records.length).toBe(20);
    const active = CA();
    records.forEach((o, i) => {
      expect(o.status).toBe("unverified");
      expect(o.closeDate).toBeNull();
      // The same published day, kept as an ESTIMATE: never a deadline.
      expect(o.estimatedCloseDate).toBe(active[i]!.closeDate);
      expect(o.statusReason).toContain("ESTIMATED");
    });
  });

  test("the portal's own per-record facts are read, and its CSS classes are not", () => {
    const records = CA();
    const first = records[0]!;
    expect(first.agency).toBe("CA Department of Food and Agriculture");
    // Per-record publishers differ across the page (14 at capture).
    expect(new Set(records.map((o) => o.agency)).size).toBeGreaterThan(5);
    expect(first.summary).toContain("Specialty Crop Block Grant Program");
    expect(first.eligibleApplicants).toBe("Business, Nonprofit, Public Agency, Tribal Government");
    expect(first.eligibleGeography).toContain("California specialty crop industry");
    expect(first.totalFunding).toBe("$28,000,000");
    expect(first.matchingRequirement).toBe("No");
    expect(first.sourceUpdatedAt).toBe("2026-08-24T20:57:57.000Z");
    expect(first.raw.lastUpdatedText).toBe("August 24, 2026, 1:57 pm");
    // "Estimated Low/High" is the portal's own estimate wording: kept verbatim and
    // turned into min/max only where it states amounts (entity decoded).
    expect(first.awardRange).toBe("$100,000 - $600,000");
    expect(first.awardMinAmount).toBe(100000);
    expect(first.awardMaxAmount).toBe(600000);
    for (const o of records) {
      // Categories are published only as facet markup / `grant_categories-*`
      // classes — a CSS class is not a published fact.
      expect(o.categories).toEqual([]);
      expect(new URL(o.url).host).toBe("www.grants.ca.gov");
      expect(o.raw.categoriesPublished).toBe(false);
    }
  });

  test("a single published amount is the ceiling; 'Dependent' states no amount", () => {
    const records = CA();
    const single = records.find((o) => o.externalId === "california-serves-grant-program-2026-27")!;
    expect(single.awardRange).toBe("$500,000");
    expect(single.awardMaxAmount).toBe(500000);
    expect(single.awardMinAmount).toBeNull();

    const dependent = records.filter((o) => o.awardRange === "Dependent");
    expect(dependent.length).toBeGreaterThan(0);
    for (const o of dependent) {
      expect(o.awardMinAmount).toBeNull();
      expect(o.awardMaxAmount).toBeNull();
    }
  });
});

describe("kansas: month ranges with no year, and the columns that are NOT deadlines", () => {
  test("thirty-two programs — the calendar's empty spacer rows are skipped", () => {
    const records = KS();
    expect(records.length).toBe(32);
    expect(records[0]!.externalId).toBe("accel-ks-proof-of-concept");
    expect(records[0]!.title).toBe("ACCEL-KS Proof of Concept");
    expect(records.at(-1)!.externalId).toBe("towns-grant");
    expect(records.at(-1)!.title).toBe("Towns Grant");
    // No per-program URL exists on the page (its only links are obfuscated
    // contact addresses), so every record points at the listing itself.
    for (const o of records) {
      expect(o.url).toBe(kansasConnector.sourceUrl);
      expect(o.sourceUrl).toBe(kansasConnector.sourceUrl);
    }
  });

  test("a year-less Application Period is never turned into a date", () => {
    const records = KS();
    expect(count(records, "unverified")).toBe(26);
    for (const o of records.filter((r) => r.status === "unverified")) {
      expect(o.postedDate).toBeNull();
      expect(o.closeDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.datesPublishedBySourceAreYearless).toBe(true);
      expect(o.raw.applicationPeriodText).toMatch(/^[A-Za-z. -]+$/);
    }
    expect(records[0]!.raw.applicationPeriodText).toBe("Mar.-Apr.");
    expect(records[0]!.raw.closingText).toBe("Mar.-Apr.");
  });

  test("'Rolling' is the source's own declaration — and only the Period column counts", () => {
    const records = KS();
    const rolling = records.filter((o) => o.status === "rolling");
    expect(rolling.length).toBe(6);
    for (const o of rolling) {
      expect(o.ongoing).toBe(true);
      expect(o.closeDate).toBeNull();
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(o.raw.applicationPeriodText).toBe("Rolling");
    }
    // The trap: "CDBG | Blueprint to Build" says "Rolling" in its Awards Given
    // column but "Jan.-Oct." in its Application Period column. A month label about
    // awards is NOT a rolling application window, and the connector never reads it.
    const blueprint = records.find((o) => o.externalId === "cdbg-blueprint-to-build")!;
    expect(blueprint.raw.applicationPeriodText).toBe("Jan.-Oct.");
    expect(blueprint.status).toBe("unverified");
    expect(blueprint.ongoing).toBe(false);
    for (const o of records) {
      expect(o.raw.ignoredColumns).toEqual(["Announcement", "Awards Given", "Contact"]);
      expect(Object.keys(o.raw)).not.toContain("announcementText");
      expect(Object.keys(o.raw)).not.toContain("awardsGivenText");
    }
  });

  test("the source's own Amount/Match/Description columns become the record's facts", () => {
    const records = KS();
    const accel = records.find((o) => o.externalId === "accel-ks-proof-of-concept")!;
    expect(accel.summary).toBe(
      "Funds to support the commercialization of groundbreaking ideas and products",
    );
    expect(accel.awardRange).toBe("$ 200,000");
    expect(accel.awardMaxAmount).toBe(200000);
    expect(accel.awardMinAmount).toBeNull();
    expect(accel.matchingRequirement).toBe("25%");
    // The calendar publishes neither eligibility nor geography.
    expect(accel.eligibleApplicants).toBe(NOT_SPECIFIED);
    expect(accel.eligibleGeography).toBe(NOT_SPECIFIED);
    expect(accel.categories).toEqual([]);
    expect(accel.agency).toBe("Kansas Department of Commerce");
  });

  test("a table without the Application Period column is refused", () => {
    const payload =
      '<table id="tablepress-155" class="tablepress tablepress-id-155"><thead><tr>' +
      "<th>Award</th><th>Max Amount</th></tr></thead><tbody><tr><td>Towns Grant</td><td>$1</td></tr></tbody></table>";
    expect(() => kansasConnector.parse(payload)).toThrow(/Application Period/);
  });
});

describe("washington: a window's end is a deadline, an opening is not, and off-host links fall back", () => {
  test("the six programs of the Open-and-upcoming region, in card order", () => {
    const records = WA();
    expect(records.length).toBe(6);
    expect(records.map((o) => o.externalId)).toEqual([
      "cultivating-healthy-communities",
      "wam-gos-grant",
      "sap-grant",
      "aie-project-grant",
      "heritage-arts-apprenticeship-program",
      "tcagrant",
    ]);
    expect(count(records, "open")).toBe(3);
    expect(count(records, "unverified")).toBe(1);
    expect(count(records, "closed")).toBe(2);
  });

  test("the year-bearing day of a window is its END — the year-less start is refused", () => {
    const record = WA().find((o) => o.externalId === "cultivating-healthy-communities")!;
    expect(record.raw.statusText).toBe("This grant is open September 1 - October 6, 2026.");
    expect(record.closeDate).toBe("2026-10-06");
    expect(record.status).toBe("open");
    // "September 1" has no year on the page; only the window's end does.
    expect(record.raw.listedDaysBySource).toEqual(["2026-10-06"]);
    expect(record.raw.closingTextIsTheRangeEnd).toBe(true);
  });

  test("'Opens January 4, 2027' is an announcement, never a deadline", () => {
    const record = WA().find((o) => o.externalId === "aie-project-grant")!;
    expect(record.postedDate).toBe("2027-01-04");
    expect(record.closeDate).toBeNull();
    expect(record.estimatedCloseDate).toBeNull();
    expect(record.status).toBe("unverified");
    expect(record.statusReason).toContain("opening date");
    expect(record.raw.openingDatePublishedOnly).toBe(true);
  });

  test("'This grant is closed.' is the source's own past-tense label", () => {
    const records = WA();
    for (const id of ["heritage-arts-apprenticeship-program", "tcagrant"]) {
      const record = records.find((o) => o.externalId === id)!;
      expect(record.status).toBe("closed");
      expect(record.closeDate).toBeNull();
      expect(record.raw.statusDeclaresClosed).toBe(true);
      expect(record.raw.statusText).toBe("This grant is closed.");
    }
  });

  test("a card linking off the approved hosts falls back to the listing page", () => {
    const records = WA();
    const heritage = records.find((o) => o.externalId === "heritage-arts-apprenticeship-program")!;
    // The card links to wacultures.org; the record's URL is the ArtsWA listing,
    // and its identity comes from the title slug.
    expect(heritage.url).toBe(washingtonConnector.sourceUrl);
    expect(records.some((o) => o.url.includes("wacultures.org"))).toBe(false);
    for (const o of records.filter((r) => r !== heritage)) {
      expect(new URL(o.url).host).toBe("www.arts.wa.gov");
    }
  });

  test("the grantee spotlight below the listing is never a grant", () => {
    const records = WA();
    expect(records.some((o) => /NFFTY|official selection|years ago/i.test(o.title))).toBe(false);
    for (const o of records) {
      expect(o.raw.statusText).not.toContain("2020");
      expect(o.raw.categoriesPublished).toBe(false);
      expect(o.categories).toEqual([]);
      expect(o.eligibleApplicants).toBe(NOT_SPECIFIED);
      expect(o.eligibleGeography).toBe(NOT_SPECIFIED);
      expect(o.awardRange).toBe(NOT_SPECIFIED);
      expect(o.awardMaxAmount).toBeNull();
      expect(o.matchingRequirement).toBe(NOT_SPECIFIED);
      expect(o.totalFunding).toBe(NOT_SPECIFIED);
    }
  });
});
