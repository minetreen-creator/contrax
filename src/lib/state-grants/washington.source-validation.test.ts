/**
 * WASHINGTON SOURCE-VALIDATION TEST — the LIVE gate that lets Washington report a
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
 * Washington: the state may only hold its tier on a PASSING explicit run of this
 * file against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to ArtsWA's grants page.
 */
import { NOT_SPECIFIED } from "~/lib/state-grants/connector";
import {
  WASHINGTON_APPROVED_HOSTS,
  WASHINGTON_SOURCE_VALIDATION_TEST,
  washingtonConnector,
} from "~/lib/state-grants/connectors/washington";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: washingtonConnector,
  approvedHosts: WASHINGTON_APPROVED_HOSTS,
  sourceName: "Washington",
  validationTestFile: WASHINGTON_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // The "Open and upcoming grants" region lists the agency's current cycle
    // cards; the region boundary (the iconbox rows below it) must still hold, or
    // the card count collapses and this gate fails loudly instead of shipping a
    // truncated corpus.
    expect(opportunities.length).toBeGreaterThanOrEqual(5);
    // The page publishes real year-bearing days, so at least one record resolves
    // a date — the window's END as a close date, or a lone opening date.
    expect(
      opportunities.filter((o) => o.closeDate !== null || o.postedDate !== null).length,
    ).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      // Every link is on ArtsWA's own hosts; the off-allowlist card (wacultures.org)
      // falls back to the listing.
      expect(new URL(o.url).host).toBe("www.arts.wa.gov");
      // The page publishes the source's own status sentence per card, and no
      // categories/eligibility/awards at all.
      expect(String(o.raw.statusText).length).toBeGreaterThan(5);
      expect(o.categories).toEqual([]);
      expect(o.eligibleApplicants).toBe(NOT_SPECIFIED);
      expect(o.eligibleGeography).toBe(NOT_SPECIFIED);
      expect(o.awardRange).toBe(NOT_SPECIFIED);
      expect(o.matchingRequirement).toBe(NOT_SPECIFIED);
      // A year-less range start can never appear as a date.
      expect(o.postedDate === null || /^\d{4}-\d{2}-\d{2}$/.test(o.postedDate)).toBe(true);
      expect(o.closeDate === null || /^\d{4}-\d{2}-\d{2}$/.test(o.closeDate)).toBe(true);
    }
  },
});
