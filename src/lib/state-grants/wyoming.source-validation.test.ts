/**
 * WYOMING SOURCE-VALIDATION TEST (LIVE) — the required gate before Wyoming's
 * coverage tier changes (owner rollout order 2026-09-18/19). Opt-IN: nothing here
 * touches the network unless `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (i.e.
 * `bun run validate:live-sources`); the default run prints a loud SKIPPED notice
 * and the fixture suite stays the deterministic half.
 *
 * The shared half is `connectors/live-validation-harness.test.ts`. What is
 * Wyoming-specific: this is a MULTI-PAGE source (the Business Council's grants
 * catalogue plus 10 pinned programme pages) and it publishes NO year-bearing
 * application deadline anywhere — so the honest live outcome is that every record
 * has NO date, and every date-like token the pages carry is REFUSED verbatim into
 * `raw.refusedDates` where a reviewer can re-derive the decision.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  WYOMING_AGENCY,
  WYOMING_APPROVED_HOSTS,
  WYOMING_CHILD_PAGES,
  WYOMING_SOURCE_NAME,
  WYOMING_SOURCE_VALIDATION_TEST,
  wyomingConnector,
} from "~/lib/state-grants/connectors/wyoming";

await runLiveSourceValidation({
  connector: wyomingConnector,
  approvedHosts: WYOMING_APPROVED_HOSTS,
  sourceName: WYOMING_SOURCE_NAME,
  validationTestFile: WYOMING_SOURCE_VALIDATION_TEST,
  // This source publishes no year-bearing application deadline at all, so the
  // gate must NOT require one from it — the honest outcome is all dates null.
  expectParsedDates: false,
  // The site renders its copy inside Elementor widgets, so a verbatim plain-text
  // title match is not a fair check here; the live checks that matter are below.
  spotCheckTitles: false,
  expectLive(opportunities, liveText) {
    // The publishing body names itself on its own pages (agency is not inferred).
    expect(liveText).toContain(WYOMING_AGENCY);
    // 10 programme pages are pinned; the live corpus must yield the catalogue.
    expect(opportunities.length).toBeGreaterThanOrEqual(10);
    for (const o of opportunities) {
      // Every record is attributed to ONE of the pages this connector fetches.
      expect(WYOMING_CHILD_PAGES).toContain(o.url);
      expect(new URL(o.url).host).toBe("wyomingbusiness.org");
      expect(o.sourceUrl).toBe(wyomingConnector.sourceUrl);
      expect(o.agency).toBe(WYOMING_AGENCY);
      // NO record carries a date: this source publishes no readable application
      // deadline, and nothing here is ever invented or estimated.
      expect(o.closeDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.estimatedCloseDate).toBeNull();
      // The five statuses only; `forecast` is gone (owner 2026-09-19) — and this
      // source can only ever be closed / rolling / unverified.
      expect(["closed", "rolling", "unverified"]).toContain(o.status);
      expect(o.status as string).not.toBe("forecast");
      expect(o.raw.readOnlyFromThisProgrammesOwnPage).toBe(true);
      expect(o.raw.indexDatesNeverRead).toBe(true);
      expect(o.raw.noAcceptedDeadlineReader).toBe(true);
      // Every date-like token is refused, verbatim, and never a close date.
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
      expect(Array.isArray(o.raw.refusedDates)).toBe(true);
    }
    // The agency's OWN two status sentences are what the statuses come from.
    const closed = opportunities.filter((o) => o.status === "closed");
    expect(closed.length).toBeGreaterThanOrEqual(1);
    for (const o of closed) {
      expect(o.raw.sourceClosedDeclaredBySource).toBe(true);
      expect(String(o.raw.closedSentence)).toMatch(/currently paused|not accepting applications/i);
    }
    expect(closed.some((o) => String(o.raw.closedSentence).match(/currently paused/i))).toBe(true);
    const rolling = opportunities.filter((o) => o.status === "rolling");
    expect(rolling.length).toBeGreaterThanOrEqual(1);
    for (const o of rolling) {
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(String(o.raw.rollingSentence)).toMatch(/year-round|rolling basis/i);
      expect(o.closeDate).toBeNull();
    }
    // The refused days seen live: the STEP page's PERIOD OF PERFORMANCE, the
    // rural page's YEAR-LESS pair, and the BRC table's year-less cells — all
    // recorded for a reviewer rather than promoted to a deadline.
    const refused = opportunities.flatMap((o) =>
      Array.isArray(o.raw.refusedDates) ? (o.raw.refusedDates as string[]) : [],
    );
    expect(refused.length).toBeGreaterThanOrEqual(1);
    const joined = refused.join(" | ");
    expect(joined).toContain("July 1, 2026, to September 29, 2027");
    expect(joined).toContain("March 1 and September 1");
    expect(joined).toMatch(/February 1st|June 1st|August 1st/);
    expect(joined).toContain("Application deadline (Day 90)");
    expect(joined).toMatch(/2019-2020 Community Development Grant and Loan Application/);
    for (const o of opportunities) {
      expect(o.closeDate).not.toBe("2026-07-01"); // STEP period start
      expect(o.closeDate).not.toBe("2027-09-29"); // STEP period end
      expect(o.closeDate).not.toBe("2024-01-01"); // stale "reopen by" note
      expect(o.closeDate).not.toBe("2026-03-01"); // year-less rural rule
      expect(o.closeDate).not.toBe("2026-09-01"); // year-less rural rule
    }
  },
});
