/**
 * Montana — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * Montana-specific is that the dated sentence is the Department's own ordered
 * "open X and close on Y" pair, read from the CHILD programme page (the parent
 * tourism-grant catalogue publishes dates nowhere).
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  montanaConnector,
  MONTANA_APPROVED_HOSTS,
  MONTANA_SOURCE_NAME,
  MONTANA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/montana";

await runLiveSourceValidation({
  connector: montanaConnector,
  approvedHosts: MONTANA_APPROVED_HOSTS,
  sourceName: MONTANA_SOURCE_NAME,
  validationTestFile: MONTANA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The Department's own applicant-resources heading is on the page we read.
    expect(liveText).toContain("Resources for Applicants");
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      expect(o.raw.orderedOpenThenCloseSentence).toBe(true);
      // Every record's URL stays on the Department's own host.
      expect(o.url).toContain("commerce.mt.gov");
    }
    // At least one record carries the Department's own published cycle pair.
    const dated = opportunities.filter((o) => o.closeDate !== null);
    expect(dated.length).toBeGreaterThanOrEqual(1);
    for (const o of dated) {
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.status === "open" || o.status === "upcoming").toBe(true);
    }
  },
});
