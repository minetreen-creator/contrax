/**
 * Florida — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * Florida-specific is the MULTI-PAGE corpus (the Division's grants index + the
 * grant programme pages the index itself publishes) and the per-programme
 * application statement: one programme's "Next Deadline: TBD" must never become a
 * date, and the 2028/2029 dates the source publishes are the GRANT PERIOD (an
 * activity period), never a deadline.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  FLORIDA_AGENCY,
  FLORIDA_APPROVED_HOSTS,
  FLORIDA_INDEX_MARKER,
  FLORIDA_PROGRAM_PATH_PREFIX,
  FLORIDA_SOURCE_NAME,
  FLORIDA_SOURCE_URL,
  FLORIDA_SOURCE_VALIDATION_TEST,
  FLORIDA_STATUS_MARKER,
  floridaConnector,
} from "~/lib/state-grants/connectors/florida";

await runLiveSourceValidation({
  connector: floridaConnector,
  approvedHosts: FLORIDA_APPROVED_HOSTS,
  sourceName: FLORIDA_SOURCE_NAME,
  validationTestFile: FLORIDA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The Division's own statement and the body that publishes it are on the live
    // pages we read.
    expect(liveText).toContain(FLORIDA_STATUS_MARKER);
    expect(liveText).toContain(FLORIDA_INDEX_MARKER);
    expect(liveText).toContain(FLORIDA_AGENCY);
    expect(liveText).toContain("Florida Department of State");
    expect(opportunities.length).toBeGreaterThanOrEqual(3);
    for (const o of opportunities) {
      // Every record is attributed to the grant programme page that published it
      // — never to the index, never to the funding-process page, never a sibling.
      expect(o.url.startsWith(FLORIDA_SOURCE_URL)).toBe(true);
      expect(o.url).toContain(FLORIDA_PROGRAM_PATH_PREFIX);
      expect(o.url).toBe(o.raw.childPageUrl);
      expect(o.sourceUrl).toBe(FLORIDA_SOURCE_URL);
      expect(o.raw.datesReadOnlyFromThisProgramsOwnPage).toBe(true);
      // The 2028/2029 dates are the GRANT PERIOD: an activity period, kept for
      // review and never promoted to a posted or close date.
      expect(o.raw.grantPeriodIsNeverADeadline).toBe(true);
      if (typeof o.raw.grantPeriodText === "string") {
        expect(o.raw.grantPeriodText).not.toBe(o.raw.closingText);
      }
      // A "TBD" deadline value is not a date: the record keeps no close date and
      // never an estimate either.
      if (o.raw.deadlineValueTbdIsNotADate === true) {
        expect(o.closeDate).toBeNull();
        expect(o.estimatedCloseDate).toBeNull();
      }
      // Never a forecast, and no date is ever an estimate on this source.
      expect(o.status as string).not.toBe("forecast");
      expect(o.estimatedCloseDate).toBeNull();
    }
    // The Division's own past-tense statement is on the live pages, so at least
    // one programme is served `closed` — never as an open cycle on a live page.
    expect(opportunities.some((o) => o.status === "closed")).toBe(true);
  },
});
