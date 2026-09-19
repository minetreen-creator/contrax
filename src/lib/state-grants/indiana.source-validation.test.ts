/**
 * Indiana — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * Indiana-specific is the MULTI-PAGE corpus (hub + funding programme pages) and
 * the per-cycle timeline table: the hub publishes no dated listing at all, and
 * one cycle's deadline must never be borrowed from a sibling row or page.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  INDIANA_AGENCY,
  INDIANA_APPROVED_HOSTS,
  INDIANA_SOURCE_NAME,
  INDIANA_SOURCE_URL,
  INDIANA_SOURCE_VALIDATION_TEST,
  indianaConnector,
} from "~/lib/state-grants/connectors/indiana";

await runLiveSourceValidation({
  connector: indianaConnector,
  approvedHosts: INDIANA_APPROVED_HOSTS,
  sourceName: INDIANA_SOURCE_NAME,
  validationTestFile: INDIANA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The Commission's own deadline label is on the pages we read, and the
    // publishing body names itself on them.
    expect(liveText).toContain("Application Due");
    expect(liveText).toContain(INDIANA_AGENCY);
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    let withOpening = 0;
    for (const o of opportunities) {
      // Every record is attributed to the funding programme page that published
      // it — never to the hub, never to a sibling programme.
      expect(o.raw.childPageUrl).toContain("/arts/programs-and-services/funding/");
      expect(o.url).toBe(o.raw.childPageUrl);
      expect(o.url.startsWith(INDIANA_SOURCE_URL)).toBe(true);
      expect(o.sourceUrl).toBe(INDIANA_SOURCE_URL);
      if (o.postedDate !== null) withOpening += 1;
      // The process rows and the activity period are read but never promoted.
      expect(o.raw.draftReviewDeadlineIsNeverADeadline).toBe(true);
      expect(o.raw.fundingNotificationIsNeverADeadline).toBe(true);
      expect(o.raw.finalGrantReportIsNeverADeadline).toBe(true);
      expect(o.raw.grantPeriodIsNeverADeadline).toBe(true);
      expect(o.raw.datesReadOnlyFromThisCyclesOwnCells).toBe(true);
      // A draft-review date can never be this cycle's deadline.
      if (typeof o.raw.draftReviewDeadlineText === "string") {
        expect(o.raw.draftReviewDeadlineText).not.toBe(o.raw.applicationDueDateText);
      }
      // The Grant Period's own days can never be a posted/close date.
      if (typeof o.raw.grantPeriodText === "string") {
        expect(o.raw.grantPeriodText).not.toBe(o.raw.closingText);
      }
    }
    // The Commission publishes an opening row for the cycles it runs, so at
    // least one live record carries a posted date (never invented elsewhere).
    expect(withOpening).toBeGreaterThanOrEqual(1);
  },
});
