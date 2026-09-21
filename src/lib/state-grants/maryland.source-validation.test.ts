/**
 * Maryland — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * Maryland-specific is the MULTI-PAGE corpus (the Council's Grants for
 * Organizations index + the GFO programme pages that index itself publishes) and
 * the ONE kind of date this source labels: a source-owned `Deadline` value in the
 * programme page's own "Quick Resources" box. The page's year-less prose deadlines
 * ("by September 15th annually", "by November 15") must never become dates.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  MARYLAND_AGENCY,
  MARYLAND_APPROVED_HOSTS,
  MARYLAND_DEADLINE_LABEL,
  MARYLAND_GFO_PATH_PREFIX,
  MARYLAND_INDEX_MARKER,
  MARYLAND_QUICK_RESOURCES_HEADING,
  MARYLAND_SOURCE_NAME,
  MARYLAND_SOURCE_URL,
  MARYLAND_SOURCE_VALIDATION_TEST,
  marylandConnector,
} from "~/lib/state-grants/connectors/maryland";

await runLiveSourceValidation({
  connector: marylandConnector,
  approvedHosts: MARYLAND_APPROVED_HOSTS,
  sourceName: MARYLAND_SOURCE_NAME,
  validationTestFile: MARYLAND_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The Council's own programme sentence, its name for the box, its label and
    // the publishing body are all on the live pages we read.
    expect(liveText).toContain(MARYLAND_INDEX_MARKER);
    expect(liveText).toContain(MARYLAND_QUICK_RESOURCES_HEADING);
    expect(liveText).toContain(MARYLAND_DEADLINE_LABEL);
    expect(liveText).toContain(MARYLAND_AGENCY);
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      // Every record is attributed to the GFO page that published it — never to
      // the index, and never to a sibling programme family of the same Council.
      expect(o.url.startsWith(MARYLAND_SOURCE_URL)).toBe(true);
      expect(o.url).toContain(MARYLAND_GFO_PATH_PREFIX);
      expect(o.url).toBe(o.raw.childPageUrl);
      expect(o.sourceUrl).toBe(MARYLAND_SOURCE_URL);
      expect(o.raw.datesReadOnlyFromThisPagesOwnBlock).toBe(true);
      // The value is the source's OWN labelled Deadline, not a reading of prose.
      expect(o.raw.labelledBySource).toBe(true);
      expect(o.raw.deadlineLabel).toBe(MARYLAND_DEADLINE_LABEL);
      expect(typeof o.raw.deadlineValueText).toBe("string");
      // The year-less prose the Council publishes is carried verbatim and is
      // never the value a record is dated from.
      expect(o.raw.yearLessProseDeadlinesNeverRead).toBe(true);
      if (typeof o.raw.applicationWindowProseText === "string") {
        expect(o.raw.applicationWindowProseText).not.toBe(o.raw.closingText);
      }
      // This source publishes no estimates and no rolling wording for GFO.
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      expect(o.status as string).not.toBe("forecast");
    }
    // The labelled deadline resolves to a real day: that is the whole point of
    // reading this source, and every dated record's day is the value published in
    // its OWN block (never the index's 2021 governance date, never a sibling's).
    const dated = opportunities.filter((o) => o.closeDate !== null);
    expect(dated.length).toBeGreaterThanOrEqual(1);
    for (const o of dated) {
      expect(o.closeDate).toBe(o.raw.closingDayPublishedBySource);
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A labelled deadline is either still ahead of us (open/upcoming) or has
      // passed (closed on a live page) — never served as a forecast.
      expect(["open", "upcoming", "closed"]).toContain(o.status);
    }
    // The FY 2028 Intent to Apply deadline the Council published on 2026-09-19 is
    // 09/15/2026 — four days past — so at least one record is served `closed`.
    expect(opportunities.some((o) => o.status === "closed")).toBe(true);
  },
});
