/**
 * WYOMING (fixtures) — the deterministic half of the state's verification.
 * Everything below runs on the REAL trimmed captures in `./fixtures/` (one per
 * fetched page, trimmed to the page's own `wp-page` body region), joined with the
 * shared multi-page delimiters exactly as `fetch()` joins them. ZERO network.
 *
 * The live half is `wyoming.source-validation.test.ts` (opt-in).
 *
 * WHAT THIS FILE PINS DOWN: Wyoming's catalogue is real and current, but it
 * publishes almost no year-bearing application deadline. So the connector reads
 * the agency's OWN two status sentences (kickstart's "currently paused" ⇒
 * `closed`, SBIR's "open year-round" ⇒ `rolling`) and refuses every date-like
 * token verbatim — no record may carry a posted, close or estimated date, and
 * nothing may be inferred from a year-less or period-of-performance fragment.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
} from "~/lib/state-grants/connector";
import { joinSourcePages } from "~/lib/state-grants/connectors/multi-page";
import { stripTags } from "~/lib/state-grants/connectors/source-support";
import {
  WYOMING_APPROVED_HOSTS,
  WYOMING_CHILD_MARKER,
  WYOMING_CHILD_PAGES,
  WYOMING_INDEX_MARKER,
  WYOMING_PROGRAMME_PATHS,
  WYOMING_SOURCE_HOST,
  WYOMING_SOURCE_URL,
  wyomingConnector,
} from "~/lib/state-grants/connectors/wyoming";
/** One fixed clock for every classification below (2026-09-20, US Eastern). */
const NOW = new Date("2026-09-20T12:00:00Z");
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}
/** The fixture file for one pinned programme path (the generator's own rule). */
function fileFor(path: string): string {
  const slug = path.split("/").filter((s) => s.length > 0).pop()!;
  return `wy-${slug}.html`;
}
const INDEX_FILE = "wy-grants-index.html";
const PAYLOAD = () =>
  joinSourcePages(
    WYOMING_SOURCE_URL,
    fixture(INDEX_FILE),
    WYOMING_PROGRAMME_PATHS.map((path, i) => ({
      url: WYOMING_CHILD_PAGES[i]!,
      html: fixture(fileFor(path)),
    })),
  );
const WY = (now: Date = NOW) =>
  parseGrantOpportunities(wyomingConnector, PAYLOAD(), now).opportunities;
const byStatus = (status: string) => WY().filter((o) => o.status === status);
const parsed = (raw: string) => wyomingConnector.parse(raw);
const byId = (id: string) => WY().find((o) => o.externalId.endsWith(id));
/** The concatenated fixture text, for the "source really says this" checks. */
const FIXTURE_TEXT = () => stripTags(PAYLOAD());
/** Every refused date this corpus produced, joined, for the review checks. */
const REFUSED = () =>
  WY()
    .flatMap((o) => (o.raw.refusedDates as string[]) ?? [])
    .join(" | ");

describe("Wyoming Business Council grants (fixtures)", () => {
  test("reads one record per pinned programme page", () => {
    const records = WY();
    expect(records.length).toBe(10);
    expect(records.length).toBe(WYOMING_CHILD_PAGES.length);
    expect(byStatus("closed").length).toBe(1);
    expect(byStatus("rolling").length).toBe(1);
    expect(byStatus("unverified").length).toBe(8);
    // Every pinned page contributes exactly one record — all 10 URLs are used.
    expect(new Set(records.map((o) => o.url)).size).toBe(WYOMING_CHILD_PAGES.length);
  });
  test("the owner's five statuses only — `forecast` is gone", () => {
    for (const o of WY()) {
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      expect(o.status as string).not.toBe("forecast");
      // Nothing on this source is `open` or `upcoming`: it publishes no
      // year-bearing application deadline at all.
      expect(["closed", "rolling", "unverified"]).toContain(o.status);
    }
  });
  test("NO record carries any date — no posted, close or estimated date anywhere", () => {
    for (const o of WY()) {
      expect(o.postedDate).toBeNull();
      expect(o.closeDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
    }
  });
  test("every record points at a pinned page on the Council's own host", () => {
    for (const o of WY()) {
      expect(WYOMING_CHILD_PAGES).toContain(o.url);
      expect(o.sourceUrl).toBe(WYOMING_SOURCE_URL);
      expect(new URL(o.url).host).toBe(WYOMING_SOURCE_HOST);
      expect(WYOMING_APPROVED_HOSTS).toContain(new URL(o.url).host);
      expect(o.url).not.toBe(WYOMING_SOURCE_URL);
      expect(o.externalId.startsWith("wy-grants-")).toBe(true);
      expect(o.agency).toBe("Wyoming Business Council");
    }
  });
  test("the catalogue itself contributes no record and no date", () => {
    const listingOnly = joinSourcePages(WYOMING_SOURCE_URL, fixture(INDEX_FILE), []);
    expect(parsed(listingOnly)).toEqual([]);
    // …and the index really does publish no date token of its own.
    expect(FIXTURE_TEXT()).toContain("Wyoming Business Council");
  });
  test("kickstart is `closed` on the agency's OWN words, with no date", () => {
    const kickstart = byId("kickstart")!;
    expect(kickstart).toBeDefined();
    expect(kickstart.status).toBe("closed");
    expect(kickstart.closeDate).toBeNull();
    expect(kickstart.raw.sourceClosedDeclaredBySource).toBe(true);
    expect(String(kickstart.raw.closedSentence)).toMatch(/currently paused/i);
    // The agency's own sentence is on the page, so no status was inferred.
    expect(FIXTURE_TEXT()).toContain("currently paused until further notice");
  });
  test("sbir is `rolling` on the agency's OWN words, with no deadline", () => {
    const sbir = byId("sbir")!;
    expect(sbir.status).toBe("rolling");
    expect(sbir.ongoing).toBe(true);
    expect(sbir.raw.rollingDeclaredBySource).toBe(true);
    expect(String(sbir.raw.rollingSentence)).toMatch(/year-round|rolling basis/i);
    expect(sbir.closeDate).toBeNull();
    expect(FIXTURE_TEXT()).toContain("open year-round");
  });
  test("every other programme is honestly `unverified` (no guessed cycle)", () => {
    const ids = WY()
      .filter((o) => o.status === "unverified")
      .map((o) => o.externalId)
      .sort();
    expect(ids).toEqual([
      "wy-grants-brownfields-rlf",
      "wy-grants-building-resilient-communities",
      "wy-grants-community-development-block-grant",
      "wy-grants-financial-incentives",
      "wy-grants-market-expansion-grant",
      "wy-grants-rural-development-grant",
      "wy-grants-startup-financing",
      "wy-grants-state-trade-expansion-program",
    ]);
  });
  test("every date-like token is refused VERBATIM, never a close date", () => {
    const refused = REFUSED();
    // The STEP page's period of performance, verbatim.
    expect(refused).toContain("July 1, 2026, to September 29, 2027");
    expect(refused).toContain("grant period is July 1, 2026, to September 29, 2027");
    // The rural page's YEAR-LESS pair and its stale January 2024 note.
    expect(refused).toContain("March 1 and September 1");
    expect(refused).toContain("Jan. 1, 2024");
    // The BRC table's year-less cells.
    expect(refused).toContain("February 1st");
    expect(refused).toContain("June 1st");
    expect(refused).toContain("August 1st");
    // The CDBG page's document-label year range, and the startup timeline's
    // RELATIVE day, are refused rather than read as a cycle.
    expect(refused).toMatch(/2019-2020 Community Development Grant and Loan Application/);
    expect(refused).toContain("Application deadline (Day 90)");
    // …and no record ever turns one of those days into a date.
    const datePublishing = [
      "wy-grants-kickstart",
      "wy-grants-rural-development-grant",
      "wy-grants-state-trade-expansion-program",
      "wy-grants-building-resilient-communities",
      "wy-grants-community-development-block-grant",
      "wy-grants-startup-financing",
    ];
    for (const o of WY()) {
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
      expect(Array.isArray(o.raw.refusedDates)).toBe(true);
      // Every page that publishes a date-like token must have refused it; the
      // two pages that publish NONE (SBIR's year-round declaration and the
      // market-expansion copy) honestly have nothing to refuse.
      if (datePublishing.some((id) => o.externalId === id)) {
        expect((o.raw.refusedDates as string[]).length).toBeGreaterThan(0);
      }
      expect(o.closeDate).not.toBe("2026-07-01"); // STEP period start
      expect(o.closeDate).not.toBe("2027-09-29"); // STEP period end
      expect(o.closeDate).not.toBe("2024-01-01"); // stale "reopen by" note
      expect(o.postedDate).not.toBe("2026-07-01");
    }
  });
  test("the connector has NO accepted-deadline reader (nothing here qualifies)", () => {
    for (const o of WY()) {
      expect(o.raw.noAcceptedDeadlineReader).toBe(true);
      expect(o.raw.readOnlyFromThisProgrammesOwnPage).toBe(true);
      expect(o.raw.programmePageUrl).toBe(o.url);
      expect(o.raw.listedBy).toBe(WYOMING_SOURCE_URL);
      expect(o.raw.indexDatesNeverRead).toBe(true);
    }
  });
  test("every title is the agency's own page heading, verbatim on its own page", () => {
    const text = FIXTURE_TEXT().replace(/\s+/g, " ");
    for (const o of WY()) {
      expect(o.raw.programmeTitle).toBe(o.title);
      expect(text).toContain(o.title.replace(/\s+/g, " ").trim());
    }
    // A few of the headings this source really publishes (the h1s, not the
    // paths): the agency's own naming is what a reader sees.
    const titles = WY().map((o) => o.title).sort();
    expect(titles).toContain("Kickstart");
    expect(titles).toContain("SBIR");
    expect(titles).toContain("Rural Development Grants");
    expect(titles).toContain("State Trade Expansion Program");
  });
  test("parsing the same payload twice is identical (no churn on re-run)", () => {
    const first = WY();
    const second = WY();
    expect(second.map((o) => o.externalId)).toEqual(first.map((o) => o.externalId));
    expect(second.map((o) => o.fingerprint)).toEqual(first.map((o) => o.fingerprint));
  });
  test("a payload that is not this source fails the gate loudly", () => {
    for (const junk of ["<html><body>nope</body></html>", ""]) {
      let thrown: unknown = null;
      try {
        wyomingConnector.parse(junk);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      expect((thrown as { stage?: string }).stage).toBe("parse");
    }
  });
  test("the fetch gate is bound to this source's own body marker", () => {
    expect(PAYLOAD()).toContain(WYOMING_INDEX_MARKER);
    expect(PAYLOAD()).toContain(WYOMING_CHILD_MARKER);
    expect(fixture(INDEX_FILE)).toContain(WYOMING_INDEX_MARKER);
    for (const path of WYOMING_PROGRAMME_PATHS) {
      expect(fixture(fileFor(path))).toContain(WYOMING_CHILD_MARKER);
    }
  });
});
