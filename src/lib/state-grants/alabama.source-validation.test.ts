/**
 * ALABAMA SOURCE-VALIDATION TEST — the LIVE gate that lets Alabama report a
 * validated coverage tier (`limited`: ONE agency's listing, never statewide).
 *
 * OPT-IN BY DESIGN (owner guardrail 2026-09-19): this file does NOTHING unless
 * `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (or `bun run validate:live-sources`).
 * Otherwise every test is SKIPPED with a loud notice and CI stays fixture-only and
 * deterministic (ZERO network).
 *
 * `spotCheckTitles: false` IS DELIBERATE HERE: the shared harness asserts the
 * connector's `agency` string appears in the page text, and ADECA's own page calls
 * the agency "ADECA" everywhere rather than spelling out "Alabama Department of
 * Economic and Community Affairs". Rather than weaken the record's agency label to
 * an acronym, this file carries the same title/identity checks itself.
 */
import {
  ALABAMA_APPROVED_HOSTS,
  ALABAMA_SOURCE_VALIDATION_TEST,
  alabamaConnector,
} from "~/lib/state-grants/connectors/alabama";
import { runLiveSourceValidation } from "~/lib/state-grants/connectors/live-validation-harness.test";

await runLiveSourceValidation({
  connector: alabamaConnector,
  approvedHosts: ALABAMA_APPROVED_HOSTS,
  sourceName: "Alabama",
  validationTestFile: ALABAMA_SOURCE_VALIDATION_TEST,
  spotCheckTitles: false,
  expectParsedDates: true,
  expectLive(opportunities, liveText) {
    const text = liveText.replace(/\s+/g, " ");
    expect(opportunities.length).toBeGreaterThanOrEqual(2);
    // The checks the shared spot-check would have made, made here instead.
    expect(text).toContain("ADECA");
    expect(text).toContain("Funding Opportunities");
    for (const o of opportunities) {
      const key = o.title.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
      expect(text).toContain(key);
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const o of opportunities) {
      // The deadline comes from the source's own label, or from its own
      // "accepting applications until" phrase — never from prose generally.
      expect(
        o.raw.deadlineReadFromTheApplicationDeadlineLabel === true ||
          o.raw.deadlineReadFromTheSourcesAcceptingApplicationsUntilPhrase === true,
      ).toBe(true);
      expect(typeof o.raw.deadlineValue).toBe("string");
      if (o.closeDate !== null) {
        // The published date decides, whatever the page's own framing says.
        expect(o.status).toBe(o.closeDate < today ? "closed" : "open");
      } else {
        expect(o.status).not.toBe("open");
      }
      // The dated workshop on a card is an EVENT: it is never a posted or closing
      // date on any record.
      if (typeof o.raw.webinarLine === "string") {
        expect(o.raw.webinarDayIsNeverADeadline).toBe(true);
        // The webinar day itself (e.g. September 1, 2026) may not be either date.
        expect(o.postedDate).not.toBe("2026-09-01");
        expect(o.closeDate).not.toBe("2026-09-01");
      }
      // A downloadable application is never served as the record's page.
      expect(o.url).not.toMatch(/\.(pdf|docx?|xlsx?)$/i);
    }
  },
});
