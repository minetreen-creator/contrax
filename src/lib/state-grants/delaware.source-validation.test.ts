/**
 * DELAWARE SOURCE-VALIDATION TEST — the LIVE gate that lets Delaware report a
 * validated coverage tier (`limited`: one validated source, never statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless it
 * is explicitly invoked:
 *
 *     bun run validate:live-sources
 *     STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants
 *
 * With that variable unset every test is SKIPPED with a loud notice and the
 * default suite stays fixture-only and deterministic (ZERO network). A skip
 * proves NOTHING about Delaware. The shared gate lives in
 * `connectors/live-validation-harness.ts`; the assertions below are what is
 * specific to the Delaware Division of the Arts' Grant Programs Overview.
 */
import {
  DELAWARE_APPROVED_HOSTS,
  DELAWARE_SOURCE_VALIDATION_TEST,
  delawareConnector,
} from "~/lib/state-grants/connectors/delaware";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness";

await runLiveSourceValidation({
  connector: delawareConnector,
  approvedHosts: DELAWARE_APPROVED_HOSTS,
  sourceName: "Delaware",
  validationTestFile: DELAWARE_SOURCE_VALIDATION_TEST,
  contentMarker: "wp-block-gic-tabs",
  expectLive(opportunities) {
    // The page publishes real year-bearing deadlines ("Next Deadline: March 1,
    // 2027 at 4:30pm"), so several records must carry one.
    expect(opportunities.filter((o) => o.closeDate !== null).length).toBeGreaterThanOrEqual(2);
    // …and it declares some programs rolling ("Rolling deadlines until funding
    // expires") — the source's own words, which is the only way to `rolling`.
    expect(opportunities.some((o) => o.ongoing)).toBe(true);
    for (const o of opportunities) {
      // The year-less "Applications open December 1" prose must never be read as
      // a closing date: no record may carry a December 1 deadline.
      expect(o.closeDate ?? "").not.toMatch(/-12-01$/);
      // One record per program page, even though two programs are listed twice
      // under different audience tabs.
      expect(new URL(o.url).host).toMatch(/^(www\.)?arts\.delaware\.gov$/);
    }
    const urls = opportunities.map((o) => o.url);
    expect(new Set(urls).size).toBe(urls.length);
  },
});
