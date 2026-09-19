/**
 * MAINE SOURCE-VALIDATION TEST — the LIVE gate that lets Maine report a validated
 * coverage tier (`limited`: ONE agency's listing, never statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless
 * `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (or `bun run validate:live-sources`).
 * Otherwise every test is SKIPPED with a loud notice and CI stays fixture-only and
 * deterministic (ZERO network).
 */
import {
  MAINE_APPROVED_HOSTS,
  MAINE_SOURCE_VALIDATION_TEST,
  maineConnector,
} from "~/lib/state-grants/connectors/maine";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: maineConnector,
  approvedHosts: MAINE_APPROVED_HOSTS,
  sourceName: "Maine",
  validationTestFile: MAINE_SOURCE_VALIDATION_TEST,
  expectParsedDates: true,
  expectLive(opportunities, liveText) {
    const text = liveText.replace(/\s+/g, " ");
    expect(opportunities.length).toBeGreaterThanOrEqual(3);
    const today = new Date().toISOString().slice(0, 10);
    let closedBySource = 0;
    for (const o of opportunities) {
      // The agency's own status word wins where it publishes one: a program it
      // files as Closed is never re-served as open, however live the page is.
      if (o.raw.sourceStatusValue === "Closed") {
        closedBySource += 1;
        expect(o.sourceClosed).toBe(true);
        expect(o.status).toBe("closed");
      }
      // A status that is neither open nor closed, with no published date, stays
      // `unverified` rather than being guessed either way.
      if (o.raw.statusIsNeitherOpenNorClosed === true) {
        expect(o.status).toBe("unverified");
        expect(o.closeDate).toBeNull();
        expect(o.sourceClosed).toBe(false);
      }
      if (o.closeDate !== null) {
        expect(o.status).toBe(o.closeDate < today ? "closed" : "open");
        if (typeof o.raw.closingText === "string") expect(text).toContain(o.raw.closingText);
      }
      // The page publishes one program in two places; the record identity is the
      // agency's own page path, so a re-run can never split it into two rows.
      expect(o.externalId.length).toBeGreaterThan(0);
    }
    expect(closedBySource).toBeGreaterThanOrEqual(1);
  },
});
