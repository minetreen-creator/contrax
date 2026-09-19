/**
 * ARIZONA SOURCE-VALIDATION TEST — the LIVE gate that lets Arizona report a
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
 * Arizona: the state may only hold its tier on a PASSING explicit run of this
 * file against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the Arizona Commission on the Arts' grants page.
 */
import {
  ARIZONA_APPROVED_HOSTS,
  ARIZONA_SOURCE_VALIDATION_TEST,
  arizonaConnector,
} from "~/lib/state-grants/connectors/arizona";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: arizonaConnector,
  approvedHosts: ARIZONA_APPROVED_HOSTS,
  sourceName: "Arizona",
  validationTestFile: ARIZONA_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // The page publishes its own dated application cycles, so at least one
    // record carries the source's own deadline (and the classifier used it).
    expect(opportunities.some((o) => o.closeDate !== null)).toBe(true);
    // The "Found 6 Results of 6" strip is page furniture, not a program.
    expect(opportunities.some((o) => /found \d+ results/i.test(o.title))).toBe(false);
    for (const o of opportunities) {
      // The page publishes no per-card categories — an empty list, never a
      // list inferred from the filter widget.
      expect(o.categories).toEqual([]);
      expect(new URL(o.url).host).toMatch(/^(www\.)?azarts\.gov$/);
    }
  },
});
