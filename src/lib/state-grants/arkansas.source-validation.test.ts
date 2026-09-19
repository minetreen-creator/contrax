/**
 * ARKANSAS SOURCE-VALIDATION TEST — the LIVE gate that lets Arkansas report a
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
 * Arkansas: the state may only hold its tier on a PASSING explicit run of this
 * file against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the Arkansas Arts Council's grants listing.
 */
import {
  ARKANSAS_APPROVED_HOSTS,
  ARKANSAS_SOURCE_VALIDATION_TEST,
  arkansasConnector,
} from "~/lib/state-grants/connectors/arkansas";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: arkansasConnector,
  approvedHosts: ARKANSAS_APPROVED_HOSTS,
  sourceName: "Arkansas",
  validationTestFile: ARKANSAS_SOURCE_VALIDATION_TEST,
  // The listing publishes NO per-program deadline (the page's dated "When To
  // Apply" list does not map 1:1 onto these cards), so an honest parse yields
  // zero parsed days on live data — exactly like Rhode Island.
  expectParsedDates: false,
  expectLive(opportunities) {
    // The accordion listing lists the Council's current programs; the region
    // boundary (the staff block after it) must still hold, or the card count
    // collapses and this gate fails loudly instead of shipping a truncated corpus.
    expect(opportunities.length).toBeGreaterThanOrEqual(8);
    expect(opportunities.some((o) => o.externalId === "arts-on-tour-grant")).toBe(true);
    // The page's own ongoing wording is the ONE rolling program here.
    const rolling = opportunities.filter((o) => o.status === "rolling");
    expect(rolling.map((o) => o.externalId)).toEqual(["arts-on-tour-grant"]);
    // The page's own closed wording is read as closed.
    expect(opportunities.some((o) => o.status === "closed")).toBe(true);
    for (const o of opportunities) {
      // Every record links to the agency's own domain; a card linking to a real
      // sub-page keeps it, anything else falls back to the listing.
      expect(ARKANSAS_APPROVED_HOSTS).toContain(new URL(o.url).host);
      // No per-program deadline is published, so no date may ever appear.
      expect(o.closeDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.raw.pagePublishesNoPerProgramDeadline).toBe(true);
      expect(o.categories).toEqual([]);
    }
  },
});
