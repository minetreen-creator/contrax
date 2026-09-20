/**
 * OHIO (fixtures) — the deterministic half of the state's verification.
 * Everything below runs on the REAL trimmed captures in `./fixtures/` (the OAC
 * catalogue index + one file per pinned programme page, each trimmed to the
 * page's own `odx-content__title` … footer body region, verbatim), joined with
 * the shared multi-page delimiters exactly as `fetch()` joins them. ZERO network.
 *
 * The live half is `ohio.source-validation.test.ts` (opt-in).
 *
 * WHAT THIS FILE PINS DOWN: the OAC catalogue is a PROGRAMME CATALOGUE whose
 * timelines are lifecycle tables, so the ONE thing this connector may publish is
 * the source's own latest labelled `Application Deadline …` row. Every other row
 * (`*Grant Agreement Deadline`, `*Final Report Deadline`, `Off-year Update
 * Deadline`, `Application Available in ARTIE`, `Grant Award Announcement`,
 * `Large Orgs' Financial Materials Due`, a Fee Support contract-submission
 * deadline) and every date in the page prose or site furniture is REFUSED
 * verbatim — no record may carry a posted date or an estimate, and a programme
 * whose only application-deadline row is RELATIVE ("90 days prior to Project
 * Start Date") stays `unverified` rather than being dated by inference.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseGrantOpportunities, STATE_GRANT_STATUSES } from "~/lib/state-grants/connector";
import { joinSourcePages } from "~/lib/state-grants/connectors/multi-page";
import { stripTags } from "~/lib/state-grants/connectors/source-support";
import {
  OHIO_CHILD_PAGES,
  OHIO_INDEX_MARKER,
  OHIO_PROGRAMME_PATHS,
  OHIO_SOURCE_URL,
  ohioConnector,
} from "~/lib/state-grants/connectors/ohio";

/** One fixed clock for every classification below (2026-09-20, US Eastern). */
const NOW = new Date("2026-09-20T12:00:00Z");
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}
/** The fixture file for one pinned programme path (the trimmer's own rule). */
function fileFor(path: string): string {
  const slug = path.split("/").filter((s) => s.length > 0).pop()!;
  return `oh-${slug}.html`;
}
const INDEX_FILE = "oh-grants-catalog.html";
const PAYLOAD = () =>
  joinSourcePages(
    OHIO_SOURCE_URL,
    fixture(INDEX_FILE),
    OHIO_PROGRAMME_PATHS.map((path, i) => ({
      url: OHIO_CHILD_PAGES[i]!,
      html: fixture(fileFor(path)),
    })),
  );
const OH = (now: Date = NOW) =>
  parseGrantOpportunities(ohioConnector, PAYLOAD(), now).opportunities;
const byStatus = (status: string) => OH().filter((o) => o.status === status);
const byId = (id: string) => OH().find((o) => o.externalId.endsWith(id));
/** The refused-date ledger of one record, as the connector stores it. */
const refusals = (id: string) =>
  (byId(id)!.raw.refusedDates ?? []) as { text: string; kind: string; reason: string }[];
const FIXTURE_TEXT = () => stripTags(PAYLOAD());

describe("Ohio Arts Council grant catalogue (fixtures)", () => {
  test("reads exactly one record per pinned programme page, in the catalogue's own order", () => {
    const records = OH();
    expect(records.length).toBe(OHIO_CHILD_PAGES.length);
    expect(records.length).toBe(14);
    // Every pinned page contributes exactly one record — all 14 URLs are used.
    expect(records.map((o) => o.url)).toEqual([...OHIO_CHILD_PAGES]);
    expect(new Set(records.map((o) => o.url)).size).toBe(OHIO_CHILD_PAGES.length);
    // The catalogue index contributes nothing (no record, no date).
    expect(records.some((o) => o.url === OHIO_SOURCE_URL)).toBe(false);
  });

  test("the owner's five statuses only — `forecast` is gone", () => {
    for (const o of OH()) {
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      expect(o.stateCode).toBe("OH");
      expect(o.sourceKey).toBe(ohioConnector.id);
      expect(JSON.stringify(o)).not.toContain("forecast");
      // Every record's own page is the source's, and stays on its host.
      expect(o.sourceUrl).toBe(OHIO_SOURCE_URL);
      expect(o.url).toContain("oac.ohio.gov");
      expect(o.agency).toBe("Ohio Arts Council");
      expect(o.title.trim().length).toBeGreaterThan(2);
    }
    expect(byStatus("open").length).toBe(2);
    expect(byStatus("closed").length).toBe(9);
    expect(byStatus("unverified").length).toBe(3);
    expect(byStatus("rolling").length).toBe(0);
    expect(byStatus("upcoming").length).toBe(0);
  });

  test("the close date is the page's own LATEST labelled application deadline", () => {
    const dated = OH()
      .map((o) => [o.externalId.replace("oh-arts-council-grant-programs-", ""), o.closeDate])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(dated).toEqual([
      ["01-sustainability", "2025-02-01"],
      ["05-individual-excellence-awards", "2026-09-01"],
      ["10-artstart", "2026-04-01"],
      ["15-artsnext", "2026-03-01"],
      ["20-arts-partnership", "2025-02-01"],
      ["25-teachartsohio", "2026-03-01"],
      ["30-artist-opportunities", "2026-05-01"],
      ["35-artsrise", null],
      ["40-artists-with-disabilities-access-program", "2026-11-01"],
      ["45-capacity-building", "2026-11-01"],
      ["50-traditional-arts-apprenticeship", "2026-04-01"],
      ["55-big-yellow-school-bus", null],
      ["65-statewide-arts-service-organizations", "2023-02-01"],
      ["70-ohio-artists-on-tour", null],
    ]);
    for (const o of OH()) {
      if (o.closeDate !== null) expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("the source's own row is kept verbatim beside the parsed day", () => {
    const cb = byId("45-capacity-building")!;
    expect(cb.status).toBe("open");
    expect(cb.closeDate).toBe("2026-11-01");
    expect(cb.raw.closeDateLabelText).toBe("Application Deadline 5 p.m.: November 1, 2026");
    expect(cb.raw.closeDateLabelDayText).toBe("November 1, 2026");
    expect(cb.raw.closeDateIsLatestLabelledApplicationDeadlineRow).toBe(true);
    // A four-cycle page: every earlier cycle's own row is kept, newest first.
    expect(cb.raw.labelledApplicationDeadlineRowCount).toBe(4);
    expect(cb.raw.earlierApplicationDeadlineRows).toEqual([
      "Application Deadline 5 p.m.: May 1, 2026",
      "Application Deadline 5 p.m.: November 1, 2025",
      "Application Deadline 5 p.m.: May 1, 2025",
    ]);
    // The second open record, and the oldest published deadline on the corpus.
    const adap = byId("40-artists-with-disabilities-access-program")!;
    expect(adap.status).toBe("open");
    expect(adap.closeDate).toBe("2026-11-01");
    expect(adap.raw.closeDateLabelText).toBe("Application Deadline at 5 p.m.: November 1, 2026");
    const saso = byId("65-statewide-arts-service-organizations")!;
    expect(saso.closeDate).toBe("2023-02-01");
    expect(saso.raw.labelledApplicationDeadlineRowCount).toBe(1);
    // The label read is done on stripped text, which is why the pages that wrap
    // the label in <strong> (sustainability) are still read.
    const su = byId("01-sustainability")!;
    expect(su.raw.closeDateLabelText).toBe("Application Deadline at 5 p.m.: February 1, 2025");
    expect(su.raw.earlierApplicationDeadlineRows).toEqual([
      "Application Deadline at 5 p.m.: February 1, 2023",
    ]);
    // Nothing is published except the labelled row: no posted date, no estimate.
    for (const o of OH()) {
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.ongoing).toBe(false);
      expect(o.sourceClosed).toBe(false);
      // No status is inherited from a page's unrelated wording.
      expect(o.raw.openingDateNeverRead).toBe(true);
      expect(o.raw.timelineHeadingNeverUsedAsScope).toBe(true);
      expect(o.raw.readOnlyFromThisProgrammesOwnPage).toBe(true);
      expect(o.raw.indexDatesNeverRead).toBe(true);
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
      expect(o.raw.statewidePortalNotReadable).toBe(true);
    }
  });

  test("a RELATIVE application deadline is never a date: the record stays `unverified`", () => {
    // ArtsRISE: "Application Deadline 5 p.m.: 90 days prior to Project Start Date".
    const rise = byId("35-artsrise")!;
    expect(rise.status).toBe("unverified");
    expect(rise.closeDate).toBeNull();
    expect(rise.raw.closeDateLabelText).toBeNull();
    expect(rise.raw.labelledApplicationDeadlineRowCount).toBe(0);
    expect(
      refusals("35-artsrise").some(
        (r) =>
          r.kind === "application-deadline-row-without-one-published-day" &&
          r.text.includes("90 days prior to Project Start Date"),
      ),
    ).toBe(true);
    // Big Yellow School Bus: "Application Deadline: At least 8 weeks prior to event".
    const bus = byId("55-big-yellow-school-bus")!;
    expect(bus.status).toBe("unverified");
    expect(bus.closeDate).toBeNull();
    expect(
      refusals("55-big-yellow-school-bus").some(
        (r) =>
          r.kind === "application-deadline-row-without-one-published-day" &&
          r.text.includes("At least 8 weeks prior to event"),
      ),
    ).toBe(true);
    // Ohio Artists on Tour publishes NO application deadline at all — only a
    // Fee Support contract-submission deadline, which is refused.
    const tour = byId("70-ohio-artists-on-tour")!;
    expect(tour.status).toBe("unverified");
    expect(tour.closeDate).toBeNull();
    expect(tour.raw.labelledApplicationDeadlineRowCount).toBe(0);
    expect(refusals("70-ohio-artists-on-tour").some((r) => r.kind === "contract-submission-deadline")).toBe(
      true,
    );
  });

  test("every other date the source publishes is REFUSED verbatim, with a reason", () => {
    const su = refusals("01-sustainability");
    const kinds = new Set(su.map((r) => r.kind));
    for (const kind of [
      "grant-agreement-deadline",
      "off-year-update-deadline",
      "application-available-in-artie",
      "grant-award-announcement",
      "financial-materials-due",
      "page-prose-or-furniture-date",
      "month-and-year-period",
    ]) {
      expect(kinds).toContain(kind);
    }
    // The agency's own lifecycle rows, verbatim.
    expect(su.some((r) => r.text === "*Grant Agreement Deadline: August 30, 2026")).toBe(true);
    expect(su.some((r) => r.text === "Off-year Update Deadline at 5 p.m.: April 1, 2026")).toBe(true);
    expect(su.some((r) => r.text === "Large Orgs' Financial Materials Due: April 1, 2023")).toBe(true);
    // A window OPENING is never a closing date.
    expect(su.some((r) => r.text.includes("Application Available in ARTIE"))).toBe(true);
    // The site's own news date in the furniture around the body is refused.
    expect(su.some((r) => r.text === "March 24, 2023")).toBe(true);
    // A month-and-year period is refused, not completed ("November 2024").
    expect(su.some((r) => r.kind === "month-and-year-period" && r.text === "November 2024")).toBe(true);
    // ADAP's own prose (the ADA's enactment date) is refused too.
    expect(
      refusals("40-artists-with-disabilities-access-program").some((r) =>
        r.text.includes("which went into effect on January 1"),
      ),
    ).toBe(true);
    // Every refusal carries a reason, and NO refused text is ever a close date.
    for (const o of OH()) {
      for (const r of (o.raw.refusedDates ?? []) as { text: string; reason: string }[]) {
        expect(r.reason.length).toBeGreaterThan(20);
        expect(r.text).not.toBe(o.raw.closeDateLabelText);
      }
    }
  });

  test("the corpus really is the Council's own pages", () => {
    const text = FIXTURE_TEXT();
    expect(text).toContain(OHIO_INDEX_MARKER);
    expect(text).toContain("Ohio Arts Council");
    // The catalogue index publishes no Application Deadline of its own.
    expect(text).toContain("Grant Opportunities");
  });

  test("deterministic: the same bytes parse to the same records, twice", () => {
    const first = JSON.stringify(OH());
    const second = JSON.stringify(OH());
    expect(second).toBe(first);
    expect(parseGrantOpportunities(ohioConnector, PAYLOAD(), NOW).collisions).toEqual([]);
    // A different clock only moves the statuses, never a date.
    const later = OH(new Date("2026-12-01T12:00:00Z"));
    expect(later.map((o) => o.closeDate)).toEqual(OH().map((o) => o.closeDate));
    expect(later.filter((o) => o.status === "open").length).toBe(0);
  });

  test("a payload that is not the OAC catalogue fails loudly", () => {
    expect(() => parseGrantOpportunities(ohioConnector, "<html>hi</html>", NOW)).toThrow(
      /not come from Ohio Arts Council/,
    );
    // The right marker but no pinned programme page is a changed catalogue, not
    // an empty one.
    expect(() =>
      parseGrantOpportunities(
        ohioConnector,
        `<html>${OHIO_INDEX_MARKER}${"odx-content__title"}</html>`,
        NOW,
      ),
    ).toThrow(/pinned programme pages/);
    // A pinned page that lost the site's own body region is refused rather than
    // read for dates.
    const broken = joinSourcePages(OHIO_SOURCE_URL, fixture(INDEX_FILE), [
      { url: OHIO_CHILD_PAGES[0]!, html: "<html><h1>Sustainability</h1>January 1, 2027</html>" },
    ]);
    expect(() => parseGrantOpportunities(ohioConnector, broken, NOW)).toThrow(/body region/);
    expect(stripTags(fixture(INDEX_FILE))).toContain(OHIO_INDEX_MARKER);
  });
});
