/**
 * TENNESSEE SOURCE-VALIDATION TEST — the LIVE gate that lets Tennessee report a
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
 * Tennessee: the state may only hold its tier on a PASSING explicit run of this
 * file against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the Tennessee Arts Commission's Apply for a Grant cycle list.
 */
import {
  TENNESSEE_APPROVED_HOSTS,
  TENNESSEE_SOURCE_VALIDATION_TEST,
  tennesseeConnector,
} from "~/lib/state-grants/connectors/tennessee";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: tennesseeConnector,
  approvedHosts: TENNESSEE_APPROVED_HOSTS,
  sourceName: "Tennessee",
  validationTestFile: TENNESSEE_SOURCE_VALIDATION_TEST,
  // The list publishes year-bearing deadlines, so the live source must resolve at
  // least one real day today.
  expectParsedDates: true,
  expectLive(opportunities, liveText) {
    const text = liveText.replace(/\s+/g, " ");
    // The FY28 cycle list publishes dated deadlines; if its shape changes the
    // parse collapses to zero and fails loudly rather than shipping an empty
    // corpus.
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      // Every record is a line whose own words say "Due": a deadline, never an
      // opening announcement and never a panel meeting.
      expect(String(o.raw.closingText)).toMatch(/\bdue\b/i);
      expect(o.raw.sourceLine).toBe(o.raw.closingText);
      // The cycle label is the source's own ("FY28" today); a future fiscal year
      // is a content change, not a failure — but it must stay a real FY label.
      expect(String(o.raw.cycle)).toMatch(/^FY\d{2}$/);
      expect(o.closeDate).not.toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.sourceClosed).toBe(false);
      expect(o.raw.rollingDeclaredBySource).toBe(false);
      // Parse-back: the closing day really is published on the live page, and the
      // cycle's opening line is the source's own bullet (never invented).
      expect(text).toContain(o.raw.closingText as string);
      if (o.raw.cycleOpeningText !== null) {
        expect(text).toContain(o.raw.cycleOpeningText as string);
        expect(o.postedDate).toBe(o.raw.cycleOpeningDayUsedAsOpeningDate);
      }
      // The status follows the source's own dates, not a page's liveness: an
      // annual-grant deadline whose cycle has not opened yet is `upcoming`.
      const today = new Date().toISOString().slice(0, 10);
      if (o.postedDate !== null && o.postedDate > today) expect(o.status).toBe("upcoming");
      else if (o.closeDate !== null && o.closeDate >= today) expect(o.status).toBe("open");
      else expect(o.status).toBe("closed");
    }
    // No record of this milestone calendar is ever a program directory entry.
    for (const o of opportunities) {
      expect(o.raw.listPublishesProgramDetail).toBe(false);
      expect(o.eligibleApplicants).toBe("Not specified");
    }
  },
});
