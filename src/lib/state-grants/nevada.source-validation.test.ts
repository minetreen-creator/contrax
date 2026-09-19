/**
 * Nevada — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`; this file
 * does the one thing no shared code can do for Nevada: name its own source, its
 * own approved hosts, and its own live realities. Registration is asserted by the
 * manifest gate inside the harness (the derived registry row must match this
 * state's declared manifest), so `sources.ts` omission fails here.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  nevadaConnector,
  NEVADA_APPROVED_HOSTS,
  NEVADA_SOURCE_NAME,
  NEVADA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/nevada";

await runLiveSourceValidation({
  connector: nevadaConnector,
  approvedHosts: NEVADA_APPROVED_HOSTS,
  sourceName: NEVADA_SOURCE_NAME,
  validationTestFile: NEVADA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // The Council's own two sections are both read live.
    expect(liveText).toContain("Open and Upcoming Grants:");
    expect(liveText).toContain("Closed Grants:");
    // Nothing the Council files as closed is ever served open, and no record
    // carries an invented date from the ACTIVITY period.
    for (const o of opportunities) {
      if (o.raw.sectionDeclaresClosed === true) expect(o.status).toBe("closed");
      expect(o.raw.grantActivityPeriodIsNeverADeadline).toBe(true);
    }
  },
});
