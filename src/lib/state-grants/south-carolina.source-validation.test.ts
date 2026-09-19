/**
 * South Carolina — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. This is
 * the state whose whole risk is a CLOSED cycle being served as open (14 of its 19
 * cards carry the Commission's own `Closed` badge), so the live assertions below
 * pin that split on the real page rather than on the fixture.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  southCarolinaConnector,
  SOUTH_CAROLINA_APPROVED_HOSTS,
  SOUTH_CAROLINA_SOURCE_NAME,
  SOUTH_CAROLINA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/south-carolina";

await runLiveSourceValidation({
  connector: southCarolinaConnector,
  approvedHosts: SOUTH_CAROLINA_APPROVED_HOSTS,
  sourceName: SOUTH_CAROLINA_SOURCE_NAME,
  validationTestFile: SOUTH_CAROLINA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The listing really is the mixed current/closed one the map describes.
    expect(liveText).toContain("Application Period");
    expect(opportunities.length).toBeGreaterThanOrEqual(10);
    const closed = opportunities.filter((o) => o.raw.statusBadgeToken === "closed");
    expect(closed.length).toBeGreaterThanOrEqual(1);
    for (const o of closed) expect(o.status).toBe("closed");
    // The Commission's own badge is the ONLY closed input; a badge whose window
    // had passed could never be served open (nothing is served open without a
    // future published end date — the harness checks that too).
    for (const o of opportunities) {
      expect(o.raw.fiveWeeksRuleIsNeverADeadline).toBe(true);
      expect(o.raw.letterOfIntentNoteIsNeverADeadline).toBe(true);
      if (o.status === "open") expect(o.raw.statusBadgeToken).not.toBe("closed");
    }
  },
});
