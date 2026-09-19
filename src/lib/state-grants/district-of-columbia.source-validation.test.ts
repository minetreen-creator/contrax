/**
 * DISTRICT OF COLUMBIA SOURCE-VALIDATION TEST — the LIVE gate that lets DC report
 * a validated coverage tier (`limited`: ONE agency's listing, never statewide).
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
 * fixture-only and deterministic (ZERO network). A skip proves NOTHING about the
 * District: the tier may only be held on a PASSING explicit run against the real
 * page. The shared gate lives in `connectors/live-validation-harness.test.ts`.
 */
import {
  DISTRICT_OF_COLUMBIA_APPROVED_HOSTS,
  DISTRICT_OF_COLUMBIA_SOURCE_VALIDATION_TEST,
  districtOfColumbiaConnector,
} from "~/lib/state-grants/connectors/district-of-columbia";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: districtOfColumbiaConnector,
  approvedHosts: DISTRICT_OF_COLUMBIA_APPROVED_HOSTS,
  sourceName: "District of Columbia",
  validationTestFile: DISTRICT_OF_COLUMBIA_SOURCE_VALIDATION_TEST,
  // The listing's dated cards publish months of the year, so the live page must
  // resolve at least one real day today.
  expectParsedDates: true,
  expectLive(opportunities, liveText) {
    const text = liveText.replace(/\s+/g, " ");
    expect(opportunities.length).toBeGreaterThanOrEqual(5);
    const today = new Date().toISOString().slice(0, 10);
    for (const o of opportunities) {
      // The source's own status token is kept verbatim and is NEVER a date.
      expect(typeof o.raw.sourceStatusText === "string" || o.raw.sourceStatusText === null).toBe(true);
      expect(o.estimatedCloseDate).toBeNull();
      expect(o.ongoing).toBe(false);
      // A card the page marks CLOSED can never be open on the live page.
      if (o.sourceClosed) expect(o.status).toBe("closed");
      // A published closing date decides, whichever way the stale tag points.
      if (o.closeDate !== null) {
        expect(text).toContain(o.raw.closingText as string);
        expect(o.status).toBe(o.closeDate < today ? "closed" : "open");
      } else {
        // No published date ⇒ never open (the CPAF case).
        expect(o.status).not.toBe("open");
      }
    }
    // The listing's trailing award/checklist links are never opportunities.
    for (const o of opportunities) {
      expect(o.title).not.toMatch(/awardees|grant awards|checklist/i);
    }
  },
});
