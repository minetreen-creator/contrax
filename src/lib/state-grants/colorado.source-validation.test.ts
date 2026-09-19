/**
 * COLORADO SOURCE-VALIDATION TEST — the LIVE gate that lets Colorado report a
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
 * Colorado: the state may only hold its tier on a PASSING explicit run of this
 * file against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to OEDIT's Advanced Industries Accelerator Programs page.
 */
import {
  COLORADO_APPROVED_HOSTS,
  COLORADO_SOURCE_VALIDATION_TEST,
  coloradoConnector,
} from "~/lib/state-grants/connectors/colorado";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: coloradoConnector,
  approvedHosts: COLORADO_APPROVED_HOSTS,
  sourceName: "Colorado",
  validationTestFile: COLORADO_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // The page lists this program family's programs; if the program headings
    // disappear the parse collapses to zero and fails loudly rather than shipping
    // an empty or a furniture-only corpus.
    expect(opportunities.length).toBeGreaterThanOrEqual(3);
    // The page's "Overview" block is programme FAMILY furniture ("Application
    // deadline: Varies by program"), never a program of its own.
    for (const o of opportunities) {
      expect(o.raw.programFamily).toBe("Advanced Industries Accelerator Programs");
      expect(COLORADO_APPROVED_HOSTS).toContain(new URL(o.url).host);
      expect(o.title).not.toMatch(/overview|varies by program/i);
      expect(o.eligibleApplicants).toBe("Not specified");
      expect(o.categories).toEqual([]);
      // A day is only ever a deadline when the block's own words say so.
      expect(o.closeDate === null || o.raw.blockPublishesAClosingLabel === true).toBe(true);
      expect(o.estimatedCloseDate).toBeNull();
    }
    // At least one block uses the page's own closing wording ("… due August 27,
    // 2026 …"), so at least one record resolves a real published day.
    expect(
      opportunities.filter((o) => typeof o.raw.closingText === "string").length,
    ).toBeGreaterThanOrEqual(1);
  },
});
