/**
 * Illinois — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. This is
 * the state whose dated listing had to be LOCATED before a parser could be
 * written, so the live assertions below pin the listing's own shape (its own
 * total, its own date-range and award columns) on the real page.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  illinoisConnector,
  ILLINOIS_APPROVED_HOSTS,
  ILLINOIS_SOURCE_NAME,
  ILLINOIS_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/illinois";

await runLiveSourceValidation({
  connector: illinoisConnector,
  approvedHosts: ILLINOIS_APPROVED_HOSTS,
  sourceName: ILLINOIS_SOURCE_NAME,
  validationTestFile: ILLINOIS_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The State's own table header and its own total are on the page we read.
    expect(liveText).toContain("Application Date Range");
    expect(liveText).toContain("Opportunities:");
    expect(opportunities.length).toBeGreaterThanOrEqual(20);
    for (const o of opportunities) {
      expect(o.url).toContain("omb.illinois.gov");
      // The State's own "No end date" is the only rolling input, and a rolling
      // row never carries a deadline.
      if (o.status === "rolling") {
        expect(o.raw.noEndDateDeclaredBySource).toBe(true);
        expect(o.closeDate).toBeNull();
      }
    }
  },
});
