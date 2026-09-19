/**
 * HAWAII SOURCE-VALIDATION TEST — the LIVE gate that lets Hawaii report a
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
 * proves NOTHING about Hawaii. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the State Foundation on Culture and the Arts' grants page.
 */
import {
  HAWAII_APPROVED_HOSTS,
  HAWAII_SOURCE_VALIDATION_TEST,
  hawaiiConnector,
} from "~/lib/state-grants/connectors/hawaii";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: hawaiiConnector,
  approvedHosts: HAWAII_APPROVED_HOSTS,
  sourceName: "Hawaii",
  validationTestFile: HAWAII_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // Only the "Current and Upcoming Grants and Fellowships" table is coverage:
    // the FY2026 awardee table below it is a list of past recipients, and no
    // record may come from it.
    for (const o of opportunities) {
      expect(o.url.startsWith("https://sfca.hawaii.gov/")).toBe(true);
      expect(o.title).not.toMatch(/^fy20\d\d/i);
      // Every row publishes its own "Grantee Specifications" eligibility text.
      expect(o.eligibleApplicants).not.toBe("Not specified");
    }
    // The cycle column publishes real dated cycles ("closed April 30, 2026";
    // "… open September 1 - October 30, 2026"), so at least one record must
    // carry a parsed closing day, and the source's own "closed" wording must
    // still produce a closed record.
    expect(opportunities.some((o) => o.closeDate !== null)).toBe(true);
    expect(opportunities.some((o) => o.status === "closed")).toBe(true);
  },
});
