/**
 * CALIFORNIA SOURCE-VALIDATION TEST — the LIVE gate that lets California report a
 * validated coverage tier (`limited`: one validated source, never `connected`,
 * because this is the portal's own Active listing — page 1 — and nothing else).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless it
 * is explicitly invoked (`bun run validate:live-sources`, or
 * `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants`). Unset —
 * the default `bun test`, and therefore every CI run — every test is SKIPPED with a
 * loud notice, and the default suite stays fixture-only and deterministic (ZERO
 * network). A skip proves NOTHING about California: the state may only hold its
 * tier on a PASSING explicit run of this file against the real official source.
 * The shared gate lives in `connectors/live-validation-harness.test.ts`.
 */
import {
  CALIFORNIA_APPROVED_HOSTS,
  CALIFORNIA_SOURCE_VALIDATION_TEST,
  californiaConnector,
} from "~/lib/state-grants/connectors/california";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: californiaConnector,
  approvedHosts: CALIFORNIA_APPROVED_HOSTS,
  sourceName: "California",
  validationTestFile: CALIFORNIA_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // The portal renders 20 grants per results page.
    expect(opportunities.length).toBeGreaterThanOrEqual(10);
    // The publisher is read PER RECORD, so the page must show several agencies.
    expect(new Set(opportunities.map((o) => o.agency)).size).toBeGreaterThan(1);
    for (const o of opportunities) {
      // The portal's machine-readable deadline is the ONLY date source: every
      // record on the Active listing resolves one.
      expect(o.closeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.estimatedCloseDate).toBeNull();
      // The Open Date cell publishes a TWO-DIGIT year, so `postedDate` is always
      // null by design — and the raw text records why.
      expect(o.postedDate).toBeNull();
      expect(String(o.raw.openDateText)).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}\s/);
      expect(String(o.raw.openDateUnparsedReason)).toContain("two-digit year");
      // The portal's own status word, and its own per-record publisher.
      expect(o.raw.sourceStatusClass).toBe("active");
      expect(o.agency.length).toBeGreaterThan(0);
      // Categories are published only as facet markup / CSS classes.
      expect(o.categories).toEqual([]);
      expect(new URL(o.url).host).toBe("www.grants.ca.gov");
    }
  },
});
