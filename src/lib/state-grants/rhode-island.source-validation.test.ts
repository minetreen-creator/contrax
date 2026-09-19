/**
 * RHODE ISLAND SOURCE-VALIDATION TEST — the LIVE gate that lets Rhode Island
 * report a validated coverage tier (`limited`: one validated source, never
 * statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless it
 * is explicitly invoked:
 *
 *     bun run validate:live-sources
 *     STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants
 *
 * With that variable unset every test is SKIPPED with a loud notice and the
 * default suite stays fixture-only and deterministic (ZERO network). A skip
 * proves NOTHING about Rhode Island. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the Rhode Island State Council on the Arts' "Our Grants" page.
 */
import {
  RHODE_ISLAND_APPROVED_HOSTS,
  RHODE_ISLAND_SOURCE_VALIDATION_TEST,
  rhodeIslandConnector,
} from "~/lib/state-grants/connectors/rhode-island";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: rhodeIslandConnector,
  approvedHosts: RHODE_ISLAND_APPROVED_HOSTS,
  sourceName: "Rhode Island",
  validationTestFile: RHODE_ISLAND_SOURCE_VALIDATION_TEST,
  // RISCA publishes no year-bearing date at all today, so the gate must NOT
  // require one from it — the honest outcome is that every date stays null.
  expectParsedDates: false,
  // RISCA renders several card labels inside nested markup, so a verbatim
  // plain-text title match is not a fair check for this source; the live check
  // that matters is below (record count, hosts, and the source's own statuses).
  spotCheckTitles: false,
  expectLive(opportunities) {
    // The listing's own card corpus is what we validated, and it is a real list.
    expect(opportunities.length).toBeGreaterThanOrEqual(10);
    // RISCA's in-card dates are YEAR-LESS ("Opens: Feb. 1. Deadline: April 1."),
    // so NO record may carry a closing date: inventing the year would be exactly
    // the fabrication the rollout forbids. The gate asserts the honest outcome.
    for (const o of opportunities) {
      expect(o.closeDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(new URL(o.url).host).toMatch(/^(www\.)?arts\.ri\.gov$/);
      expect(o.url).not.toContain("rifoundation.org");
    }
    // …while the source's OWN declarations still produce real statuses: programs
    // grouped under "Currently Closed", and programs with rolling deadlines.
    expect(opportunities.some((o) => o.status === "closed")).toBe(true);
    expect(opportunities.some((o) => o.ongoing)).toBe(true);
  },
});
