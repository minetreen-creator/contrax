/**
 * LIVE SOURCE-VALIDATION HARNESS — the shared half of the opt-in live gate that
 * lets a batch-1 state report a validated coverage tier (owner ROLLOUT order
 * 2026-09-18: "source-validation tests REQUIRED before any state goes
 * unavailable→limited"; owner guardrail 2026-09-19: ordinary CI must never
 * depend on a live external website).
 *
 * WHY A HARNESS: all five batch-1 states must pass the SAME gate. Writing that
 * gate once means a state cannot quietly pass a weaker version of it, and the
 * per-state test file is only the source-specific assertions. Each state's file
 * still exists, is still named in the registry manifest, and still does the one
 * thing no shared code can do for it: name its own source, its own approved
 * hosts and its own live realities.
 *
 * OPT-IN BY DESIGN: nothing here touches the network unless
 * `STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1` (`bun run validate:live-sources`). With
 * it unset — the default `bun test`, and therefore every CI run — every test is
 * SKIPPED with a loud notice, so a skip can never be mistaken for verification.
 * The default suite stays fixture-only and deterministic (ZERO network).
 *
 * Once invoked, a source that cannot be reached FAILS the gate; it does not
 * skip. A source we cannot verify is exactly the state that must not be reported
 * as covered.
 */
import { describe, expect, test } from "bun:test";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type GrantOpportunity,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { getStateEntry, isStateValidated } from "~/lib/state-grants/registry";
import { sourcesForState } from "~/lib/state-grants/sources";
import { stripTags } from "~/lib/state-grants/connectors/source-support";

/** The live source validation is OPT-IN — see the header for why. */
export const LIVE_SOURCE_TESTS_ENABLED =
  process.env.STATE_GRANTS_RUN_LIVE_SOURCE_TESTS === "1";

const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

export const LIVE_TIMEOUT_MS = 60_000;

export interface LiveSourceValidationOptions {
  connector: StateGrantConnector<string>;
  /** Hosts a parsed record URL may use (the connector's allowlist). */
  approvedHosts: readonly string[];
  /** Human source label for messages, e.g. "Arizona". */
  sourceName: string;
  /** Repo-relative path of THIS test file (the manifest gate). */
  validationTestFile: string;
  /** The record-level marker a wrong payload must be refused for. */
  contentMarker: string;
  /**
   * Whether the live source publishes at least one parseable day today. Rhode
   * Island deliberately does NOT (its in-card dates are year-less), so its file
   * sets this false and asserts the honest all-null outcome itself.
   */
  expectParsedDates?: boolean;
  /**
   * Whether to spot-check every parsed title verbatim against the page text.
   * False only where the source renders a card title in a way the plain-text
   * pass cannot reproduce (RISCA wraps some labels in nested markup); that
   * state's own `expectLive` then carries the live structural check instead.
   */
  spotCheckTitles?: boolean;
  /**
   * Source-specific live realities: what this listing is expected to show today
   * (a rolling program, a closed cycle, the source's own wording). Kept in the
   * state's own file so the shared gate stays generic.
   */
  expectLive?: (opportunities: GrantOpportunity[], liveText: string) => void;
}

/**
 * Runs the whole live gate for one state. Called at module top level by
 * `<state>.source-validation.test.ts`, so the single live fetch is shared by
 * every assertion in the file.
 */
export async function runLiveSourceValidation(
  options: LiveSourceValidationOptions,
): Promise<void> {
  const { connector, approvedHosts, sourceName, validationTestFile, contentMarker } = options;
  const skip = !LIVE_SOURCE_TESTS_ENABLED;

  if (skip) {
    console.warn(
      `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED (${sourceName}) — run \`bun run validate:live-sources\` ` +
        `(or \`STATE_GRANTS_RUN_LIVE_SOURCE_TESTS=1 bun test src/lib/state-grants\`) to verify ${sourceName} against ` +
        `the real official source (required before ${connector.stateCode}'s coverage tier changes).${RESET}\n` +
        `  The default run is fixture-only and deterministic: it proves the parser/classifier logic, NOT the live source.\n`,
    );
  } else {
    console.warn(
      `\n${BOLD}LIVE SOURCE VALIDATION RUNNING (${sourceName}) — fetching ${connector.sourceUrl} for real (opt-in).${RESET}\n`,
    );
  }

  const live = skip
    ? null
    : await connector
        .fetch(new Date())
        .then((html) => ({ html, ...parseGrantOpportunities(connector, html, new Date()) }))
        .catch((e: Error) => {
          // Deliberately NOT swallowed into a skip: a source we cannot verify
          // fails the gate.
          throw new Error(`live ${sourceName} source validation could not run: ${e.message}`);
        });

  const opportunities: GrantOpportunity[] = live?.opportunities ?? [];
  const liveText = live ? stripTags(live.html) : "";
  const liveToday = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  describe.skipIf(skip)(`${sourceName} source validation (live)`, () => {
    test("the gate is registered for this exact test file", () => {
      expect(connector.sourceValidationTest).toBe(validationTestFile);
      const entry = getStateEntry(connector.stateCode)!;
      expect(entry).not.toBeNull();
      expect(entry.sourceValidationTest).toBe(validationTestFile);
      expect(isStateValidated(connector.stateCode)).toBe(true);
      // ONE source, so `limited` — never advertised as statewide.
      expect(entry.status).toBe("limited");
      expect(entry.sourceCount).toBe(sourcesForState(connector.stateCode).length);
      expect(entry.sourceCount).toBe(1);
    });

    test("the live source yields at least one real opportunity", () => {
      expect(opportunities.length).toBeGreaterThanOrEqual(1);
      for (const o of opportunities) {
        expect(o.title.trim().length).toBeGreaterThan(2);
        expect(o.externalId.length).toBeGreaterThan(0);
        expect(o.stateCode).toBe(connector.stateCode);
        expect(o.sourceKey).toBe(connector.id);
        expect(o.sourceUrl).toBe(connector.sourceUrl);
        expect(STATE_GRANT_STATUSES).toContain(o.status);
        expect(o.statusReason.length).toBeGreaterThan(10);
        expect(o.fingerprint).toMatch(/^[0-9a-f]{32}$/);
        // `forecast` is not a status any more (owner 2026-09-19).
        expect(o.status as string).not.toBe("forecast");
      }
    }, LIVE_TIMEOUT_MS);

    test("every URL stays on the approved official hosts", () => {
      for (const o of opportunities) {
        const url = new URL(o.url);
        expect(approvedHosts).toContain(url.host);
        expect(url.protocol).toBe("https:");
        expect(new URL(o.sourceUrl).host).toBe(new URL(connector.sourceUrl).host);
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
        // An unverified or rolling record never carries a deadline.
        if (o.status === "unverified" || o.status === "rolling") expect(o.closeDate).toBeNull();
      }
      expect(datesSeen).toBeGreaterThanOrEqual(options.expectParsedDates === false ? 0 : 1);
    }, LIVE_TIMEOUT_MS);

    test("the owner's status model holds on live data", () => {
      for (const o of opportunities) {
        const sourceClosed = o.raw.sourceClosedDeclaredBySource === true ||
          o.raw.cycleClosedDeclaredBySource === true ||
          o.raw.sectionDeclaresClosed === true;
        const ongoingDeclared = o.raw.ongoingDeclaredBySource === true ||
          o.raw.rollingDeclaredBySource === true;
        const closeDay = o.closeDate ? Date.parse(`${o.closeDate}T00:00:00Z`) : null;
        const openDay = o.postedDate ? Date.parse(`${o.postedDate}T00:00:00Z`) : null;

        switch (o.status) {
          case "open":
            expect(closeDay).not.toBeNull();
            expect(closeDay!).toBeGreaterThanOrEqual(liveToday);
            break;
          case "upcoming":
            expect(closeDay).not.toBeNull();
            expect(openDay).not.toBeNull();
            expect(openDay!).toBeGreaterThan(liveToday);
            expect(o.estimatedCloseDate).toBeNull();
            break;
          case "rolling":
            expect(ongoingDeclared).toBe(true);
            expect(o.closeDate).toBeNull();
            break;
          case "closed":
            expect(sourceClosed || (closeDay !== null && closeDay < liveToday)).toBe(true);
            break;
          case "unverified":
            expect(o.closeDate).toBeNull();
            break;
          default:
            throw new Error(`unexpected status ${o.status} on the live source`);
        }
      }
    }, LIVE_TIMEOUT_MS);

    test("spot-check: every parsed title really appears in the live page text", () => {
      if (options.spotCheckTitles === false) {
        // Covered by this state's own live assertions (see its test file).
        expect(opportunities.length).toBeGreaterThanOrEqual(1);
        return;
      }
      for (const o of opportunities) {
        // The first four words of the record's own title text, whitespace
        // collapsed — punctuation and line breaks in the rendered page must not
        // turn a real title into a failure.
        const key = o.title.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
        expect(liveText.replace(/\s+/g, " ")).toContain(key);
      }
      // The publishing body names itself on the page (agency is not inferred).
      expect(liveText).toContain(connector.agency);
      const dateTexts = [
        ...opportunities.map((o) => o.raw.closingText),
        ...opportunities.map((o) => o.raw.applicationDeadline),
        ...opportunities.map((o) => o.raw.enrollmentDatesText),
        ...opportunities.map((o) => o.raw.deadlineValue),
        ...opportunities.map((o) => o.raw.applicationDueDateText),
      ].filter((v): v is string => typeof v === "string" && v.trim().length > 4);
      expect(dateTexts.length).toBeGreaterThanOrEqual(1);
    }, LIVE_TIMEOUT_MS);

    test("parsing the same live page twice is identical (no churn on re-run)", async () => {
      const again = await connector.fetch(new Date());
      const second = parseGrantOpportunities(connector, again, new Date());
      expect(second.opportunities.map((o) => o.externalId)).toEqual(
        opportunities.map((o) => o.externalId),
      );
      expect(second.opportunities.map((o) => o.fingerprint)).toEqual(
        opportunities.map((o) => o.fingerprint),
      );
    }, LIVE_TIMEOUT_MS);

    test("what this source is expected to show today", () => {
      options.expectLive?.(opportunities, liveText);
    }, LIVE_TIMEOUT_MS);

    test("a payload that is not the source's page fails the gate loudly", () => {
      let thrown: unknown = null;
      try {
        connector.parse("<html><body>nope</body></html>");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      // A parse-stage StateSourceError: the connector refused the payload instead
      // of inventing records from it (the `contentMarker` it looks for is the
      // reason, and each connector names it in its own message).
      expect((thrown as { stage?: string }).stage).toBe("parse");
      expect((thrown as Error).message.length).toBeGreaterThan(10);
    }, LIVE_TIMEOUT_MS);
  });
}
