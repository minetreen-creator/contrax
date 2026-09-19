/**
 * NEW MEXICO SOURCE-VALIDATION TEST — the LIVE gate that lets New Mexico report a
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
 * fixture-only and deterministic (ZERO network). A skip proves NOTHING about New
 * Mexico: the state may only hold its tier on a PASSING explicit run of this file
 * against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to New Mexico Arts' "Apply for a Grant" page.
 */
import {
  NEW_MEXICO_APPROVED_HOSTS,
  NEW_MEXICO_SOURCE_VALIDATION_TEST,
  newMexicoConnector,
} from "~/lib/state-grants/connectors/new-mexico";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: newMexicoConnector,
  approvedHosts: NEW_MEXICO_APPROVED_HOSTS,
  sourceName: "New Mexico",
  validationTestFile: NEW_MEXICO_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // The page publishes its labelled application milestones; if the section
    // headings change the parse collapses and fails loudly.
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      // The day is read from the page's own labelled phrase — "must be submitted
      // by the published deadline of … <Month D, YYYY>" — and from nothing else.
      expect(o.raw.labelledDeadlineResolvedToExactlyOneDay).toBe(true);
      expect(String(o.raw.closingText)).toContain("published deadline of");
      expect(String(o.raw.milestoneLabel).length).toBeGreaterThan(3);
      expect(NEW_MEXICO_APPROVED_HOSTS).toContain(new URL(o.url).host);
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.closeDate === null || /^\d{4}-\d{2}-\d{2}$/.test(o.closeDate)).toBe(true);
    }
    // A resolved milestone inside its window is `open`; a passed one is `closed`
    // via its own published day. Either way a labelled deadline was read.
    expect(opportunities.filter((o) => o.closeDate !== null).length).toBeGreaterThanOrEqual(1);
  },
});
