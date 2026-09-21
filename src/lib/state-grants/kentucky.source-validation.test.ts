/**
 * KENTUCKY SOURCE-VALIDATION TEST — the LIVE gate that lets Kentucky report a
 * validated coverage tier (`limited`: ONE agency's listing, never statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless
 * `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (or `bun run validate:live-sources`).
 * Otherwise every test is SKIPPED with a loud notice and CI stays fixture-only and
 * deterministic (ZERO network).
 *
 * THIS FILE ALSO RE-VERIFIES THE ARCHIVE TRAP LIVE. The listing's WordPress title
 * reads "Grants Archives", the shape that made the Tennessee page unusable. The
 * live assertions below pin the CURRENT-vs-past semantics that made it usable
 * here: the page must still publish a machine-readable per-program
 * `<time datetime>` deadline, its rendered deadline text must still appear in the
 * page, and the programs' own pages must still be linked — while the status of
 * each record still follows the date the source published, not the page's title.
 */
import {
  KENTUCKY_APPROVED_HOSTS,
  KENTUCKY_SOURCE_VALIDATION_TEST,
  kentuckyConnector,
} from "~/lib/state-grants/connectors/kentucky";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: kentuckyConnector,
  approvedHosts: KENTUCKY_APPROVED_HOSTS,
  sourceName: "Kentucky",
  validationTestFile: KENTUCKY_SOURCE_VALIDATION_TEST,
  expectParsedDates: true,
  expectLive(opportunities, liveText) {
    const text = liveText.replace(/\s+/g, " ");
    expect(opportunities.length).toBeGreaterThanOrEqual(5);
    const today = new Date().toISOString().slice(0, 10);
    let datedFuture = 0;
    for (const o of opportunities) {
      // The archive-trap re-check: the deadline is still the source's own
      // machine-readable value, and it is still rendered on the page.
      expect(o.raw.deadlineValueIsMachineReadableTimeElement).toBe(true);
      expect(o.raw.deadlineValue).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
      expect(o.closeDate).toBe(o.raw.closingDayPublishedBySource);
      if (o.raw.closingText !== null && typeof o.raw.closingText === "string") {
        expect(text).toContain(o.raw.closingText);
      }
      // The record's status follows the DATE, not the page's title.
      if (o.closeDate !== null) {
        expect(o.status).toBe(o.closeDate < today ? "closed" : "open");
        if (o.closeDate >= today) datedFuture += 1;
      } else {
        expect(o.status).not.toBe("open");
      }
      // Prose can never have flipped a record to rolling.
      expect(o.ongoing).toBe(false);
    }
    // A listing whose every deadline were in the past would be the closed-cycle
    // history the archive trap warns about — that is not this page today, and its
    // own program pages publish the same live deadlines.
    expect(datedFuture).toBeGreaterThanOrEqual(1);
  },
});
