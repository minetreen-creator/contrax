/**
 * IOWA SOURCE VALIDATION (LIVE) — the required gate before Iowa's coverage tier
 * changes (owner rollout order 2026-09-18/19). Opt-IN: nothing here touches the
 * network unless `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (i.e.
 * `bun run validate:live-sources`); the default run prints a loud SKIPPED notice.
 *
 * The shared half is `connectors/live-validation-harness.test.ts`. What is
 * Iowa-specific: this is a MULTI-PAGE source (the Arts Council's Grants &
 * Programs catalogue plus 18 pinned programme pages), the catalogue publishes no
 * window of its own, and the days it publishes that are NOT application
 * deadlines (a Final Report Deadline, reviewer milestones, funding periods,
 * fund-availability and expense-window days) must never become close dates.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  IOWA_AGENCY,
  IOWA_APPROVED_HOSTS,
  IOWA_CHILD_PAGES,
  IOWA_SOURCE_NAME,
  IOWA_SOURCE_VALIDATION_TEST,
  iowaConnector,
} from "~/lib/state-grants/connectors/iowa";

await runLiveSourceValidation({
  connector: iowaConnector,
  approvedHosts: IOWA_APPROVED_HOSTS,
  sourceName: IOWA_SOURCE_NAME,
  validationTestFile: IOWA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The publishing body and the catalogue's own programmes are really there.
    expect(liveText).toContain(IOWA_AGENCY);
    expect(liveText).toContain("Iowans Create Community Mural Program");
    expect(liveText).toContain("Iowa Arts Council");
    // 18 programme pages are pinned; the live corpus must yield a real catalogue.
    expect(opportunities.length).toBeGreaterThanOrEqual(18);
    const statuses = new Set(opportunities.map((o) => o.status));
    for (const status of ["open", "closed", "rolling", "unverified"]) {
      expect([...statuses]).toContain(status as (typeof opportunities)[number]["status"]);
    }
    for (const o of opportunities) {
      // Every record is attributed to ONE of the pages this connector fetches.
      expect(IOWA_CHILD_PAGES).toContain(o.url);
      expect(new URL(o.url).host).toBe("opportunityiowa.gov");
      expect(o.sourceUrl).toBe(iowaConnector.sourceUrl);
      expect(o.raw.readOnlyFromThisProgrammesOwnPage).toBe(true);
      expect(o.raw.indexDatesNeverRead).toBe(true);
      // The five statuses only; `forecast` is gone (owner 2026-09-19).
      expect(o.status as string).not.toBe("forecast");
      // No refused label's date ever became this record's date.
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
    }
    // The off-host 301 target is what is read: never iowaculture.gov.
    for (const o of opportunities) expect(o.url).not.toContain("iowaculture.gov");
    // The Mural program's two role-scoped deadlines are published live, verbatim.
    const mural = opportunities.filter((o) => o.externalId.includes("community-mural-program"));
    expect(mural.length).toBe(2);
    expect(mural.map((o) => o.closeDate).sort()).toEqual(["2026-10-28", "2026-10-30"]);
    expect(mural.map((o) => o.raw.applicantRole).sort()).toEqual(["Artists", "Communities"]);
    for (const o of mural) expect(o.raw.windowLabel).toBe("Deadline");
    // `rolling` only where the agency says so in its own words, with no deadline.
    const rolling = opportunities.filter((o) => o.status === "rolling");
    expect(rolling.length).toBeGreaterThanOrEqual(1);
    for (const o of rolling) {
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(String(o.raw.rollingSentence)).toMatch(/rolling basis/i);
      expect(o.closeDate).toBeNull();
    }
    // The agency marks programmes closed in its own words, with no invented date.
    const closedByWords = opportunities.filter(
      (o) => o.status === "closed" && o.raw.sourceClosedDeclaredBySource === true,
    );
    expect(closedByWords.length).toBeGreaterThanOrEqual(1);
    for (const o of closedByWords) expect(o.closeDate).toBeNull();
    // Nothing on this source is ever an estimate (Iowa publishes no estimates).
    for (const o of opportunities) expect(o.estimatedCloseDate).toBeNull();
    // Refused days seen live are recorded for a reviewer, never promoted.
    const refused = opportunities.flatMap((o) =>
      Array.isArray(o.raw.refusedDates) ? (o.raw.refusedDates as string[]) : [],
    );
    expect(refused.length).toBeGreaterThanOrEqual(1);
    const joined = refused.join(" | ");
    expect(joined).toMatch(/Final Report Deadline|Final reports/);
    expect(joined).toMatch(/Funding Period|funding period/);
    for (const o of opportunities) {
      expect(o.closeDate).not.toBe("2027-08-02"); // Final Report Deadline
      expect(o.closeDate).not.toBe("2026-04-23"); // Finalist Applicant Interviews
      expect(o.closeDate).not.toBe("2026-05-12"); // Award Notification
    }
  },
});
