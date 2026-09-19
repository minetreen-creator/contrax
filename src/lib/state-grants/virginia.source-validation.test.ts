/**
 * VIRGINIA SOURCE-VALIDATION TEST — the gate that lets Virginia report
 * `connected` (owner ROLLOUT order 2026-09-18: "source-validation tests REQUIRED
 * before any state goes unavailable→connected").
 *
 * This is the ONLY place in the rollout that talks to the real official source.
 * It proves, against the live page:
 *   1. the source is reachable and still has the shape the connector parses;
 *   2. it yields at least one REAL opportunity with a title, an official URL and
 *      a source URL that is the official listing;
 *   3. every parsed URL stays on the approved official hosts;
 *   4. every date either parses exactly or is null — nothing is invented;
 *   5. classification obeys the honesty contract (no forecast carries a
 *      close_date, and no record is open without a deadline the source published
 *      or an explicit ongoing declaration);
 *   6. every parsed title really appears in the fetched page (spot-check against
 *      the live payload, not just against our own parser);
 *   7. parsing the same page twice gives the SAME fingerprint for every record,
 *      so a re-run cannot rewrite a row it already has.
 *
 * SKIPPING. The owner's brief: skippable ONLY via an explicit env var, never
 * silently. `STATE_GRANTS_SKIP_LIVE_SOURCE_TESTS=1` skips it and says so loudly.
 * Any failure to reach the source FAILS the test — it does not skip — because a
 * source we cannot verify is exactly the state that must not be `connected`.
 */
import { describe, expect, test } from "bun:test";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type GrantOpportunity,
} from "~/lib/state-grants/connector";
import {
  VIRGINIA_APPROVED_HOSTS,
  VIRGINIA_SOURCE_URL,
  VIRGINIA_SOURCE_VALIDATION_TEST,
  stripTags,
  virginiaConnector,
} from "~/lib/state-grants/connectors/virginia";
import { getStateEntry, isStateConnected } from "~/lib/state-grants/registry";

const SKIP = process.env.STATE_GRANTS_SKIP_LIVE_SOURCE_TESTS === "1";
if (SKIP) {
  console.warn(
    "[virginia source validation] SKIPPED via STATE_GRANTS_SKIP_LIVE_SOURCE_TESTS=1 — " +
      "Virginia's connected status is NOT proven by this run.",
  );
}

const LIVE_TIMEOUT_MS = 60_000;

/** One live fetch, shared by the assertions below (a public page, read only). */
const live = SKIP
  ? null
  : await virginiaConnector
      .fetch(new Date())
      .then((html) => ({ html, ...parseGrantOpportunities(virginiaConnector, html, new Date()) }))
      .catch((e: Error) => {
        // Deliberately NOT swallowed into a skip: a source we cannot verify
        // fails the gate.
        throw new Error(`live Virginia source validation could not run: ${e.message}`);
      });

const opportunities: GrantOpportunity[] = live?.opportunities ?? [];
const liveText = live ? stripTags(live.html) : "";
const liveToday = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

describe.skipIf(SKIP)("virginia source validation (live)", () => {
  test("the gate is registered for this exact test file", () => {
    expect(VIRGINIA_SOURCE_VALIDATION_TEST).toBe(
      "src/lib/state-grants/virginia.source-validation.test.ts",
    );
    const entry = getStateEntry("VA")!;
    expect(entry.sourceValidationTest).toBe(VIRGINIA_SOURCE_VALIDATION_TEST);
    expect(isStateConnected("VA")).toBe(true);
  });

  test("the live source yields at least one real opportunity", () => {
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const o of opportunities) {
      expect(o.title.trim().length).toBeGreaterThan(2);
      expect(o.externalId.length).toBeGreaterThan(0);
      expect(o.stateCode).toBe("VA");
      expect(o.sourceUrl).toBe(VIRGINIA_SOURCE_URL);
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      expect(o.statusReason.length).toBeGreaterThan(10);
      expect(o.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    }
  }, LIVE_TIMEOUT_MS);

  test("every URL stays on the approved official hosts", () => {
    for (const o of opportunities) {
      const url = new URL(o.url);
      expect(VIRGINIA_APPROVED_HOSTS).toContain(url.host);
      expect(url.protocol).toBe("https:");
      expect(new URL(o.sourceUrl).host).toBe(new URL(VIRGINIA_SOURCE_URL).host);
    }
  }, LIVE_TIMEOUT_MS);

  test("every date either parses exactly or is null — nothing is invented", () => {
    let datesSeen = 0;
    for (const o of opportunities) {
      for (const day of [o.postedDate, o.closeDate, o.estimatedCloseDate]) {
        if (day === null) continue;
        datesSeen += 1;
        expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(`${day}T00:00:00Z`))).toBe(false);
      }
      // An estimate and a deadline can never coexist on one record.
      expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
    }
    // The source is a dated listing; if it suddenly yields no dates at all, the
    // connector is blind and the gate should not pass.
    expect(datesSeen).toBeGreaterThanOrEqual(1);
  }, LIVE_TIMEOUT_MS);

  test("the honesty contract holds on live data", () => {
    for (const o of opportunities) {
      if (o.status === "forecast") {
        expect(o.closeDate).toBeNull(); // an estimate is never a deadline
      }
      if (o.status === "open") {
        const ongoing = o.raw.ongoingDeclaredBySource === true;
        const hasLiveDeadline =
          o.closeDate !== null && Date.parse(`${o.closeDate}T00:00:00Z`) >= liveToday;
        expect(ongoing || hasLiveDeadline).toBe(true);
      }
      if (o.status === "closed" && o.closeDate !== null) {
        const sourceSaidClosed = o.raw.sourceClosedDeclaredBySource === true;
        const passed = Date.parse(`${o.closeDate}T00:00:00Z`) < liveToday;
        expect(sourceSaidClosed || passed).toBe(true);
      }
    }
  }, LIVE_TIMEOUT_MS);

  test("spot-check: every parsed title really appears in the live page text", () => {
    for (const o of opportunities) {
      expect(liveText).toContain(o.title.replace(/\s+/g, " ").trim());
    }
    // The publishing body names itself on the page (agency is not inferred).
    expect(liveText).toContain("Virginia Tourism Corporation");
    // At least one stored date label+value is visible verbatim in the page, which
    // is what makes a stored date traceable to the source instead of computed.
    const closingTexts = opportunities
      .map((o) => o.raw.closingText)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 4);
    expect(closingTexts.length).toBeGreaterThanOrEqual(1);
    expect(closingTexts.some((d) => liveText.includes(d.replace(/\s+/g, " ").trim()))).toBe(true);
  }, LIVE_TIMEOUT_MS);

  test("parsing the same live page twice is identical (no churn on re-run)", async () => {
    const again = await virginiaConnector.fetch(new Date());
    const second = parseGrantOpportunities(virginiaConnector, again, new Date());
    expect(second.opportunities.map((o) => o.externalId)).toEqual(
      opportunities.map((o) => o.externalId),
    );
    expect(second.opportunities.map((o) => o.fingerprint)).toEqual(
      opportunities.map((o) => o.fingerprint),
    );
  }, LIVE_TIMEOUT_MS);

  test("a payload that is not the source's page fails the gate loudly", () => {
    // Proves the gate is real: a changed or blocked page cannot silently pass.
    expect(() => virginiaConnector.parse("<html><body>nope</body></html>")).toThrow(/entry-content/);
  }, LIVE_TIMEOUT_MS);
});
