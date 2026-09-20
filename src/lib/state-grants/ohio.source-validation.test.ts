/**
 * Ohio — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. What is
 * Ohio-specific is that this source is a PROGRAMME CATALOGUE whose timelines are
 * lifecycle tables: the only date that may ever be published is the source's own
 * latest labelled `Application Deadline …` row, and every other date-like token
 * on every page must be refused verbatim into `raw.refusedDates`.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  OHIO_APPROVED_HOSTS,
  OHIO_INDEX_MARKER,
  OHIO_PROGRAMME_PATHS,
  OHIO_SOURCE_NAME,
  OHIO_SOURCE_VALIDATION_TEST,
  ohioConnector,
} from "~/lib/state-grants/connectors/ohio";

await runLiveSourceValidation({
  connector: ohioConnector,
  approvedHosts: OHIO_APPROVED_HOSTS,
  sourceName: OHIO_SOURCE_NAME,
  validationTestFile: OHIO_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The catalogue's own words are on the page we read.
    expect(liveText).toContain(OHIO_INDEX_MARKER);
    expect(liveText).toContain("Ohio Arts Council");
    // The labelled rows this connector depends on are on the pages we read.
    expect(liveText).toContain("Application Deadline");
    // Every pinned programme page still resolves to a record.
    expect(opportunities.length).toBeGreaterThanOrEqual(OHIO_PROGRAMME_PATHS.length);
    for (const o of opportunities) {
      // Every record's link stays on the Council's own host.
      expect(o.url).toContain("oac.ohio.gov");
      expect(o.raw.closeDateReadFromThisProgrammesOwnPage).toBe(true);
      expect(o.raw.timelineHeadingNeverUsedAsScope).toBe(true);
      expect(o.raw.openingDateNeverRead).toBe(true);
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
      expect(o.raw.indexDatesNeverRead).toBe(true);
      // No posting date and no estimate is ever produced by this source.
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      if (o.status === "unverified" || o.status === "rolling") {
        expect(o.closeDate).toBeNull();
      }
      if (o.closeDate !== null) {
        expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // A published close date is the source's own labelled row, verbatim.
        expect(String(o.raw.closeDateLabelText)).toContain("Application Deadline");
        expect(String(o.raw.closeDateLabelDayText).length).toBeGreaterThan(3);
      }
      const refused = o.raw.refusedDates as { kind: string; text: string; reason: string }[];
      expect(Array.isArray(refused)).toBe(true);
      for (const r of refused) {
        expect(r.text.length).toBeGreaterThan(0);
        expect(r.reason.length).toBeGreaterThan(20);
        // A refused token is never the day that was published as the deadline.
        expect(r.text).not.toBe(o.raw.closeDateLabelText);
      }
    }
    // At least one programme on the live catalogue publishes a real deadline.
    expect(opportunities.filter((o) => o.closeDate !== null).length).toBeGreaterThanOrEqual(1);
    // The Agency's own lifecycle rows (grant agreement / final report / off-year)
    // are refused by kind on the live corpus — they are never a close date.
    const refusedKinds = new Set(
      opportunities.flatMap((o) =>
        (o.raw.refusedDates as { kind: string }[]).map((r) => r.kind),
      ),
    );
    expect(refusedKinds.has("grant-agreement-deadline")).toBe(true);
  },
});
