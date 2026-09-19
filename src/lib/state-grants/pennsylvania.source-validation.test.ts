/**
 * PENNSYLVANIA SOURCE-VALIDATION TEST — the LIVE gate that lets Pennsylvania
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
 * proves NOTHING about Pennsylvania. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to Pennsylvania Creative Industries' "Due Dates for Grants" page.
 */
import {
  PENNSYLVANIA_APPROVED_HOSTS,
  PENNSYLVANIA_SOURCE_VALIDATION_TEST,
  pennsylvaniaConnector,
} from "~/lib/state-grants/connectors/pennsylvania";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: pennsylvaniaConnector,
  approvedHosts: PENNSYLVANIA_APPROVED_HOSTS,
  sourceName: "Pennsylvania",
  validationTestFile: PENNSYLVANIA_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // The programme rows publish application dates and the source's own "Rolling"
    // statement; both shapes must still be visible on the live page.
    expect(opportunities.some((o) => o.closeDate !== null)).toBe(true);
    expect(opportunities.some((o) => o.ongoing)).toBe(true);
    for (const o of opportunities) {
      const dueText = String(o.raw.applicationDueDateText ?? "");
      expect(dueText.length).toBeGreaterThan(0);
      // "TBD" is no date at all — never a close date.
      if (/^tbd\b/i.test(dueText)) expect(o.closeDate).toBeNull();
      // A multi-deadline cell ("Quarterly: -- 06/12/2026 -- 09/11/2026 …") can
      // never resolve to one picked deadline.
      if (/quarterly/i.test(dueText)) expect(o.closeDate).toBeNull();
      expect(new URL(o.url).host).toMatch(/^(www\.)?pa\.gov$/);
      expect(o.url).toContain("/agencies/coa/");
    }
  },
});
