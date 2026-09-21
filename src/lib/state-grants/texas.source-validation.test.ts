/**
 * Texas — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * Texas-specific: this page publishes ONE dated grant round in its own words —
 * "The FY 27 Round of DEAAG will open on September 1, 2026. DEAAG applications
 * will be due on or before 5 PM Friday, November 06, 2026." — plus an AWARD
 * timing sentence in the same paragraph that must never become a deadline.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  TEXAS_AGENCY,
  TEXAS_APPROVED_HOSTS,
  TEXAS_CONTENT_MARKER,
  TEXAS_SOURCE_NAME,
  TEXAS_SOURCE_VALIDATION_TEST,
  texasConnector,
} from "~/lib/state-grants/connectors/texas";

await runLiveSourceValidation({
  connector: texasConnector,
  approvedHosts: TEXAS_APPROVED_HOSTS,
  sourceName: TEXAS_SOURCE_NAME,
  validationTestFile: TEXAS_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The Commission's own page text is what we read (marker + publishing body
    // in the source's own words — neither is inferred).
    expect(liveText).toContain(TEXAS_CONTENT_MARKER);
    expect(liveText).toContain(TEXAS_AGENCY);
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      // Every record comes from the DEAAG page itself, and its dates come from
      // the one paragraph that publishes this programme's round.
      expect(o.url).toBe(texasConnector.sourceUrl);
      expect(o.raw.datesReadOnlyFromThisProgramsOwnParagraph).toBe(true);
      expect(o.raw.orderedOpenThenDueSentence).toBe(true);
      // The published round is DATED: the Commission publishes an opening day and
      // a due day, so a live record is never an undated or rolling one.
      expect(o.closeDate).not.toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      expect(["open", "upcoming", "closed"]).toContain(o.status as string);
      // An opening day the source published is never after its own due day.
      if (o.postedDate !== null && o.closeDate !== null) {
        expect(o.postedDate <= o.closeDate).toBe(true);
      }
      // The award timing is captured for review and is NEVER a date: the record's
      // close date is the application due day, not an award announcement.
      expect(o.raw.awardAnnouncementIsNeverADeadline).toBe(true);
      expect(o.closeDate).not.toBe(o.raw.awardAnnouncementText);
    }
  },
});
