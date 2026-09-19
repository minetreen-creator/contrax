/**
 * Oklahoma — LIVE source validation (opt-in: `bun run validate:live-sources`).
 *
 * The shared gate lives in `connectors/live-validation-harness.test.ts`. This
 * state reads the Council's TWO program indexes (organizations + schools) as ONE
 * source, so `fetch()` is both pages on every live run and the gate's own
 * title/agency spot-check runs over the joined text.
 */
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";
import {
  oklahomaConnector,
  OKLAHOMA_APPROVED_HOSTS,
  OKLAHOMA_SOURCE_NAME,
  OKLAHOMA_SOURCE_VALIDATION_TEST,
} from "~/lib/state-grants/connectors/oklahoma";

await runLiveSourceValidation({
  connector: oklahomaConnector,
  approvedHosts: OKLAHOMA_APPROVED_HOSTS,
  sourceName: OKLAHOMA_SOURCE_NAME,
  validationTestFile: OKLAHOMA_SOURCE_VALIDATION_TEST,
  expectLive: (opportunities, liveText) => {
    // Both of the Council's program indexes are represented in the one payload.
    // The CMS (AEM) inlines its own page metadata as JSON, where a hyphen is
    // escaped as \u002D — so the slug is matched after undoing that escaping.
    const unescaped = liveText.replace(/\\u002D/g, "-");
    expect(unescaped).toContain("grants-for-organizations");
    expect(unescaped).toContain("grants-for-schools");
    // The legacy host is never used, and no award-record link is ever a page.
    for (const o of opportunities) {
      expect(o.url).not.toContain("arts.ok.gov");
      expect(o.raw.projectActivityDatesIsNeverADeadline).toBe(true);
      if (o.raw.sourceClosedDeclaredBySource === true) expect(o.status).toBe("closed");
    }
  },
});
