/**
 * UTAH SOURCE-VALIDATION TEST — the LIVE gate that lets Utah report a validated
 * coverage tier (`limited`: one validated source, never statewide). Utah exited
 * nationwide batch #1 under the checklist §0 exit rule; this is the escalation
 * pass's own page, so the state comes back only if this file passes against the
 * real page.
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
 * Utah: the state may only hold its tier on a PASSING explicit run of this file
 * against the real official source. The shared gate lives in
 * `connectors/live-validation-harness.test.ts`; the assertions below are what is
 * specific to the Utah Division of Arts & Museums' Project Grants page.
 */
import {
  UTAH_APPROVED_HOSTS,
  UTAH_SOURCE_VALIDATION_TEST,
  utahConnector,
} from "~/lib/state-grants/connectors/utah";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: utahConnector,
  approvedHosts: UTAH_APPROVED_HOSTS,
  sourceName: "Utah",
  validationTestFile: UTAH_SOURCE_VALIDATION_TEST,
  // Every program panel in this listing publishes a dated Grant Opens / Grant
  // Closes schedule, so the live page must resolve real days today. (If the
  // Division ever ships a panel with no schedule, that panel is honestly
  // `unverified` and the fixture tests cover it — this flag pins TODAY's page.)
  expectParsedDates: true,
  expectLive(opportunities, liveText) {
    const text = liveText.replace(/\s+/g, " ");
    // The page lists several programs; if the panels disappear the parse collapses
    // to zero and fails loudly rather than shipping an empty corpus.
    expect(opportunities.length).toBeGreaterThanOrEqual(3);
    const days = new Set<string>();
    let sessionsSeen = 0;
    for (const o of opportunities) {
      expect(UTAH_APPROVED_HOSTS).toContain(new URL(o.url).host);
      // The two values are the source's OWN labelled values, read separately, and
      // the parse-back proves both are published on the live page.
      if (o.closeDate !== null) expect(text).toContain(o.raw.closingText as string);
      if (o.raw.openingText !== null) {
        expect(text).toContain(o.raw.openingText as string);
        expect(o.postedDate).toBe(o.raw.openingDayPublishedBySource);
      }
      expect(o.closeDate).toBe(o.raw.closingDayPublishedBySource);
      if (o.closeDate !== null) days.add(o.closeDate);
      // The dated information session is an EVENT: its day must never appear as
      // either of the record's dates, and the session line is kept verbatim.
      const session = o.raw.infoSessionLine;
      if (typeof session === "string") {
        sessionsSeen += 1;
        expect(text).toContain(session);
        expect(o.raw.infoSessionDayIsNeverADeadline).toBe(true);
        expect(o.postedDate === null || !session.includes(o.postedDate)).toBe(true);
      }
      // The status follows the source's own published dates: a passed closing date
      // is `closed`, and a program is never shown as open just because the page is
      // still live.
      const today = new Date().toISOString().slice(0, 10);
      if (o.closeDate !== null && o.closeDate < today) expect(o.status).toBe("closed");
      else if (o.closeDate !== null) expect(o.status).toBe("open");
    }
    // The programs publish distinct cycles; a collapse onto one date would mean
    // the labelled-value read has broken.
    expect(days.size).toBeGreaterThanOrEqual(2);
    // The information-session trap is live on this page (at least one program
    // publishes a dated webinar) and was handled as an event, not a deadline.
    expect(sessionsSeen).toBeGreaterThanOrEqual(1);
  },
});
