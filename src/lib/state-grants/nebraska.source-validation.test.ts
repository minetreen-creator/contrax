/**
 * NEBRASKA SOURCE VALIDATION (LIVE) — the required gate before Nebraska's
 * coverage tier changes (owner rollout order 2026-09-18/19). Opt-IN: nothing here
 * touches the network unless `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (i.e.
 * `bun run validate:live-sources`); the default run prints a loud SKIPPED notice.
 *
 * The shared half is `connectors/live-validation-harness.test.ts`. What is
 * Nebraska-specific: this is a MULTI-PAGE source (the DED programme index plus 46
 * pinned programme pages), most of its dated windows are PAST cycles the DED
 * keeps on live pages, and its refusals (anticipated award dates, letters of
 * intent, press-release dates, a year-less `Sept. 15`) must never become dates.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  NEBRASKA_AGENCY,
  NEBRASKA_APPROVED_HOSTS,
  NEBRASKA_CHILD_PAGES,
  NEBRASKA_INDEX_MARKER,
  NEBRASKA_SOURCE_NAME,
  NEBRASKA_SOURCE_VALIDATION_TEST,
  nebraskaConnector,
} from "~/lib/state-grants/connectors/nebraska";
await runLiveSourceValidation({
  connector: nebraskaConnector,
  approvedHosts: NEBRASKA_APPROVED_HOSTS,
  sourceName: NEBRASKA_SOURCE_NAME,
  validationTestFile: NEBRASKA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The index's own h1 and the publishing body both exist on the live pages.
    expect(liveText).toContain(NEBRASKA_INDEX_MARKER);
    expect(liveText).toContain(NEBRASKA_AGENCY);
    // 46 programme pages are pinned; the live corpus must yield a real catalogue.
    expect(opportunities.length).toBeGreaterThanOrEqual(60);
    const statuses = new Set(opportunities.map((o) => o.status));
    for (const status of ["open", "closed", "rolling", "unverified"]) {
      expect([...statuses]).toContain(status as (typeof opportunities)[number]["status"]);
    }
    for (const o of opportunities) {
      // Every record is attributed to ONE of the pages this connector fetches.
      expect(NEBRASKA_CHILD_PAGES).toContain(o.url);
      expect(o.raw.readOnlyFromThisProgrammesOwnWindowBlock).toBe(true);
      expect(o.raw.indexDatesNeverRead).toBe(true);
      // The five statuses only; `forecast` is gone (owner 2026-09-19).
      expect(o.status as string).not.toBe("forecast");
      // No refused label's date ever became this record's date.
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
    }
    // `rolling` only where the source says so in its own words, with no deadline.
    const rolling = opportunities.filter((o) => o.status === "rolling");
    expect(rolling.length).toBeGreaterThanOrEqual(1);
    for (const o of rolling) {
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(String(o.raw.rollingSentence)).toMatch(/open cycle|rolling|ongoing/i);
      expect(o.closeDate).toBeNull();
    }
    // The DED keeps past cycles on live pages: they are served `closed`.
    const closed = opportunities.filter((o) => o.status === "closed");
    expect(closed.length).toBeGreaterThanOrEqual(1);
    // A programme the source says is not taking applications carries no deadline.
    const shovel = opportunities.filter((o) => o.url.endsWith("/business/shovel-ready-grants/"));
    for (const o of shovel) expect(o.closeDate).toBeNull();
    // The Film Office's own invisible marks are read, not guessed.
    const film = opportunities.find((o) => o.url.endsWith("/incentives/film-office-grant/"));
    expect(film).toBeDefined();
    expect(film!.closeDate).toBe("2025-06-08");
    // Nothing on this source is ever an estimate (the DED publishes no estimates).
    for (const o of opportunities) expect(o.estimatedCloseDate).toBeNull();
    // Refused labels seen live are recorded for a reviewer, for example the
    // Letter of Intent deadline on the QCT Recovery Grant page.
    const refused = opportunities.flatMap((o) =>
      Array.isArray(o.raw.refusedDates) ? (o.raw.refusedDates as string[]) : [],
    );
    expect(refused.length).toBeGreaterThanOrEqual(1);
    expect(refused.join(" ")).toContain("Letter of Intent Deadline");
  },
});
