/**
 * New Jersey — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * New Jersey-specific is that the NJDA page publishes its programmes in its OWN
 * named buckets (Open / Closed / SADC) and that the only dated round it labels
 * is the USDA-AMS Specialty Crop Multi-State round ("no later than October 16,
 * 2026"). Everything else date-like on the page is refused verbatim.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  NEW_JERSEY_APPROVED_HOSTS,
  NEW_JERSEY_CONTENT_MARKER,
  NEW_JERSEY_CLOSED_HEADING,
  NEW_JERSEY_OPEN_HEADING,
  NEW_JERSEY_SOURCE_NAME,
  NEW_JERSEY_SOURCE_VALIDATION_TEST,
  newJerseyConnector,
} from "~/lib/state-grants/connectors/new-jersey";

await runLiveSourceValidation({
  connector: newJerseyConnector,
  approvedHosts: NEW_JERSEY_APPROVED_HOSTS,
  sourceName: NEW_JERSEY_SOURCE_NAME,
  validationTestFile: NEW_JERSEY_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The page's own words are on the page we read.
    expect(liveText).toContain(NEW_JERSEY_CONTENT_MARKER);
    expect(liveText).toContain(NEW_JERSEY_OPEN_HEADING);
    expect(liveText).toContain(NEW_JERSEY_CLOSED_HEADING);
    expect(opportunities.length).toBeGreaterThanOrEqual(10);
    for (const o of opportunities) {
      // Every record's link stays on the state's own host.
      expect(o.url).toContain("nj.gov");
      expect(o.raw.closeDateLabelReadFromThisProgramsOwnSection).toBe(true);
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
      if (o.status === "unverified" || o.status === "rolling") {
        expect(o.closeDate).toBeNull();
      }
      if (o.closeDate !== null) {
        expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    // The source's own closure statement is what makes the closed bucket closed.
    for (const o of opportunities.filter((x) => x.status === "closed")) {
      expect(o.raw.sourceClosedDeclaredBySource).toBe(true);
    }
    // The live page still publishes the one labelled dated round.
    const dated = opportunities.filter((o) => o.closeDate !== null);
    expect(dated.length).toBeGreaterThanOrEqual(1);
    // The third-party bucket is never served.
    const titles = opportunities.map((o) => o.title).join(" | ");
    expect(titles).not.toContain("Fulfill");
    expect(titles).not.toContain("Community FoodBank");
  },
});
