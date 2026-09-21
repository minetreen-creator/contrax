/**
 * WEST VIRGINIA SOURCE-VALIDATION TEST — the LIVE gate that lets West Virginia
 * report a validated coverage tier (`limited`: ONE section's listing, never
 * statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless
 * `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (or `bun run validate:live-sources`).
 * Otherwise every test is SKIPPED with a loud notice and CI stays fixture-only and
 * deterministic (ZERO network).
 *
 * `spotCheckTitles: false` IS DELIBERATE HERE: the shared harness asserts the
 * parsed titles AND the connector's `agency` string appear in the page text, and
 * the Arts Section's page does not spell out "West Virginia Division of Culture
 * and History" anywhere in its body (its own `<title>` names it "West Virginia
 * Culture Center"). Rather than weaken the label to an acronym, this file carries
 * the same title/identity checks itself — see `expectLive` below.
 */
import {
  WEST_VIRGINIA_APPROVED_HOSTS,
  WEST_VIRGINIA_SOURCE_VALIDATION_TEST,
  westVirginiaConnector,
} from "~/lib/state-grants/connectors/west-virginia";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: westVirginiaConnector,
  approvedHosts: WEST_VIRGINIA_APPROVED_HOSTS,
  sourceName: "West Virginia",
  validationTestFile: WEST_VIRGINIA_SOURCE_VALIDATION_TEST,
  spotCheckTitles: false,
  expectParsedDates: true,
  expectLive(opportunities, liveText) {
    const text = liveText.replace(/\s+/g, " ");
    expect(opportunities.length).toBeGreaterThanOrEqual(5);
    const today = new Date().toISOString().slice(0, 10);

    // The checks the shared spot-check would have made, made here instead.
    expect(text).toContain("West Virginia");
    expect(text).toContain("Currently Open for Application");
    for (const o of opportunities) {
      const key = o.title.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
      expect(text).toContain(key);
    }

    let rolling = 0;
    let notCurrentlyOpen = 0;
    for (const o of opportunities) {
      // The LABELLED deadline value is the only deadline input.
      expect(typeof o.raw.deadlineValue).toBe("string");
      if (o.raw.deadlineValue === "Rolling") {
        rolling += 1;
        expect(o.ongoing).toBe(true);
        expect(o.status).toBe("rolling");
        expect(o.closeDate).toBeNull();
      }
      if (o.raw.sourceDeclaresNotCurrentlyOpen === true) {
        notCurrentlyOpen += 1;
        // The source's own "Not Currently Open" is a state, never a date.
        expect(o.sourceClosed).toBe(true);
        expect(o.status).toBe("closed");
        expect(o.closeDate).toBeNull();
        expect(o.postedDate).toBeNull();
      }
      if (o.closeDate !== null) {
        expect(text).toContain(o.raw.closingText as string);
        expect(o.status).toBe(o.closeDate < today ? "closed" : "open");
      } else {
        expect(o.status === "rolling" || o.status === "closed" || o.status === "unverified").toBe(true);
      }
      // The page's FINAL-REPORT due date is a reporting date, never an application
      // deadline: no record may carry it.
      expect(o.closeDate).not.toBe("2026-09-28");
      expect(o.postedDate).not.toBe("2026-09-28");
    }
    // The page publishes both shapes today; if either read collapses, the parse
    // has broken rather than the page having changed meaning.
    expect(rolling).toBeGreaterThanOrEqual(1);
    expect(notCurrentlyOpen).toBeGreaterThanOrEqual(1);
    expect(text).toContain("Not Currently Open for Application");
  },
});
