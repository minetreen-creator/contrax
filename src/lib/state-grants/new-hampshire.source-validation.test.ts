/**
 * New Hampshire — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * New-Hampshire-specific is the round list: one record per round, the Division's
 * own "Application Due Date" value as the only deadline input, and the
 * "Applicants Notified" value that must never become one.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  newHampshireConnector,
  NEW_HAMPSHIRE_APPROVED_HOSTS,
  NEW_HAMPSHIRE_SOURCE_NAME,
  NEW_HAMPSHIRE_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/new-hampshire";

await runLiveSourceValidation({
  connector: newHampshireConnector,
  approvedHosts: NEW_HAMPSHIRE_APPROVED_HOSTS,
  sourceName: NEW_HAMPSHIRE_SOURCE_NAME,
  validationTestFile: NEW_HAMPSHIRE_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The Division's own deadlines heading and label are on the page we read.
    expect(liveText).toMatch(/JPP\s+FY\s*\d{4}\s+Deadlines/i);
    expect(liveText).toContain("Application Due Date");
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      // One record per ROUND, and each round's date is its own.
      expect(o.raw.round).toMatch(/^\d+$/);
      expect(o.raw.applicantsNotifiedIsNeverADeadline).toBe(true);
      // No round publishes an opening date, so none may be invented.
      expect(o.postedDate).toBeNull();
      // The submission link is on a third-party grant platform; a record's page
      // stays the Division's own listing.
      expect(o.url).toBe(newHampshireConnector.sourceUrl);
      // A notified date is never this record's deadline.
      if (typeof o.raw.applicantsNotifiedText === "string") {
        expect(o.raw.applicantsNotifiedText).not.toBe(o.raw.applicationDueDateText);
      }
    }
  },
});
