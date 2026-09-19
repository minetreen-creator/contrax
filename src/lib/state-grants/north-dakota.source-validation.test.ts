/**
 * NORTH DAKOTA SOURCE-VALIDATION TEST — the LIVE gate that lets North Dakota
 * report a validated coverage tier (`limited`: one validated source, never
 * statewide).
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
 * North Dakota: the state may only hold its tier on a PASSING explicit run of this
 * file against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the Council on the Arts' "Grants at a Glance" page.
 */
import {
  NORTH_DAKOTA_APPROVED_HOSTS,
  NORTH_DAKOTA_SOURCE_VALIDATION_TEST,
  northDakotaConnector,
} from "~/lib/state-grants/connectors/north-dakota";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: northDakotaConnector,
  approvedHosts: NORTH_DAKOTA_APPROVED_HOSTS,
  sourceName: "North Dakota",
  validationTestFile: NORTH_DAKOTA_SOURCE_VALIDATION_TEST,
  expectLive(opportunities) {
    // "Grants at a Glance" lists the Council's grant cards; if the card layout
    // changes the parse falls below this floor and fails loudly.
    expect(opportunities.length).toBeGreaterThanOrEqual(8);
    for (const o of opportunities) {
      // Every card publishes its own What:/Deadline: lines, so every record
      // carries the source's own deadline text verbatim.
      expect(String(o.raw.deadlineText).length).toBeGreaterThan(5);
      expect(NORTH_DAKOTA_APPROVED_HOSTS).toContain(new URL(o.url).host);
      expect(o.estimatedCloseDate).toBeNull();
      // A record is `closed` only via the source's own passed-marker or a passed
      // published day — never by inference.
      if (o.status === "closed") {
        expect(o.raw.sourceClosedDeclaredBySource === true || o.closeDate !== null).toBe(true);
      }
    }
    // The five cards that publish a real day AND the source's own "*deadline has
    // passed" marker classify as closed.
    expect(opportunities.filter((o) => o.raw.sourceClosedDeclaredBySource === true).length)
      .toBeGreaterThanOrEqual(3);
    // The two-round card's passed-marker is ROUND-SCOPED: it must never close the
    // whole program, so that card resolves no single day and is never `closed`.
    const twoRound = opportunities.find((o) => o.raw.passedMarkerIsRoundScoped === true);
    if (twoRound) {
      expect(twoRound.status).not.toBe("closed");
      expect(twoRound.closeDate).toBeNull();
      expect(twoRound.sourceClosed).toBe(false);
    }
    // A deadline stated as a RULE ("6 weeks prior to project start date") is never
    // a date and never rolling.
    for (const o of opportunities.filter((r) => r.raw.deadlinesStatedAsARule === true)) {
      expect(o.closeDate).toBeNull();
      expect(o.ongoing).toBe(false);
    }
  },
});
