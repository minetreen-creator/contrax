/**
 * MINNESOTA SOURCE-VALIDATION TEST — the LIVE gate that lets Minnesota report a
 * validated coverage tier (`limited`: one validated source, never statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless it
 * is explicitly invoked:
 *
 *     bun run validate:live-sources
 *     # equivalently, from anywhere in the repo:
 *     STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants
 *
 * With that variable unset — the default `bun test`, and therefore every CI run —
 * every test is SKIPPED with a loud notice, and the default suite stays
 * fixture-only and deterministic (ZERO network). A skip proves NOTHING about
 * Minnesota: the state may only hold its tier on a PASSING explicit run of this
 * file against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the Arts Board's own calendar page.
 */
import {
  MINNESOTA_APPROVED_HOSTS,
  MINNESOTA_SOURCE_VALIDATION_TEST,
  minnesotaConnector,
} from "~/lib/state-grants/connectors/minnesota";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: minnesotaConnector,
  approvedHosts: MINNESOTA_APPROVED_HOSTS,
  sourceName: "Minnesota",
  validationTestFile: MINNESOTA_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // The calendar's current-cycle table lists the Arts Board's grant programs
    // with their application deadlines; if the table or the column header changes
    // the parse fails loudly instead of shipping a partial corpus.
    expect(opportunities.length).toBeGreaterThanOrEqual(4);
    for (const o of opportunities) {
      // Only the CURRENT cycle's table is read — the prior fiscal-year table is
      // an expired archive and never contributes a row.
      expect(o.raw.calendarCycle).toMatch(/Grant Cycle$/);
      // Only the Application Deadline column is a deadline; the other two columns
      // are recorded as deliberately ignored, never read.
      expect(o.raw.ignoredColumns).toEqual(["Board Approval", "Grant Period (*)"]);
      expect(o.raw.applicationDeadlineText).toBe(o.raw.closingText);
      expect(MINNESOTA_APPROVED_HOSTS).toContain(new URL(o.url).host);
      expect(o.closeDate === null || /^\d{4}-\d{2}-\d{2}$/.test(o.closeDate)).toBe(true);
      expect(o.estimatedCloseDate).toBeNull();
    }
    // The current table publishes real year-bearing deadlines, so at least one
    // record resolves a day — and a passed published deadline is `closed`.
    expect(opportunities.filter((o) => o.closeDate !== null).length).toBeGreaterThanOrEqual(1);
    expect(opportunities.some((o) => o.status === "closed")).toBe(true);
  },
});
