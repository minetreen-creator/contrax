/**
 * KANSAS SOURCE-VALIDATION TEST — the LIVE gate that lets Kansas report a
 * validated coverage tier (`limited`: one validated source, never statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless it
 * is explicitly invoked (`bun run validate:live-sources`, or
 * `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants`). Unset —
 * the default `bun test`, and therefore every CI run — every test is SKIPPED with
 * a loud notice, and the default suite stays fixture-only and deterministic (ZERO
 * network). A skip proves NOTHING about Kansas: the state may only hold its tier on
 * a PASSING explicit run of this file against the real official source. The shared
 * gate lives in `connectors/live-validation-harness.test.ts`.
 */
import {
  KANSAS_AGENCY,
  KANSAS_APPROVED_HOSTS,
  KANSAS_REQUIRED_HEADER,
  KANSAS_SOURCE_VALIDATION_TEST,
  kansasConnector,
} from "~/lib/state-grants/connectors/kansas";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: kansasConnector,
  approvedHosts: KANSAS_APPROVED_HOSTS,
  sourceName: "Kansas",
  validationTestFile: KANSAS_SOURCE_VALIDATION_TEST,
  // The calendar publishes MONTH RANGES WITH NO YEAR ("Mar.-Apr."), so this source
  // honestly yields NO parsed date at all. Like Rhode Island, its gate asserts
  // that all-null outcome itself instead of pretending a date exists.
  expectParsedDates: false,
  expectLive(opportunities) {
    // The calendar carries ~32 programs; the table must still parse as a real
    // listing rather than a handful of rows.
    expect(opportunities.length).toBeGreaterThanOrEqual(20);
    for (const o of opportunities) {
      expect(o.agency).toBe(KANSAS_AGENCY);
      // No per-program URL exists on the page, so every record points at the listing.
      expect(o.url).toBe(kansasConnector.sourceUrl);
      // The ONE date-bearing column is a year-less month range or the source's own
      // "Rolling": no record may carry a date, and none may be anything other than
      // `unverified` (not yet published in a dated cycle) or `rolling`.
      expect(o.closeDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(["unverified", "rolling"]).toContain(o.status);
      expect(String(o.raw.applicationPeriodText).length).toBeGreaterThan(0);
      // Proof the two month-label columns are never read as deadlines.
      expect(o.raw.ignoredColumns).toEqual(["Announcement", "Awards Given", "Contact"]);
    }
    // "Rolling" is the source's own declaration and must survive live.
    const rolling = opportunities.filter((o) => o.status === "rolling");
    expect(rolling.length).toBeGreaterThanOrEqual(1);
    for (const o of rolling) expect(o.raw.rollingDeclaredBySource).toBe(true);
    // The header the parser keys on is still the source's own wording.
    expect(KANSAS_REQUIRED_HEADER).toBe("Application Period");
    expect(opportunities.length).toBeGreaterThanOrEqual(20);
  },
});
