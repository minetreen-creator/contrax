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
import {
  CONNECTED_MIN_SOURCES,
  DEFAULT_REGISTRY_INPUTS,
  VALIDATED_REGISTRY_STATUSES,
  getStateEntry,
  isStateValidated,
} from "~/lib/state-grants/registry";
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
   * The exact string this source expects to find on the live page as the
   * publishing body's own name.
   *
   * WHY THIS IS AN OPTION AND NOT A DELETION (owner-approved 2026-09-20, QA
   * MED-1): a connector's `agency` is sometimes a COMPOSED publishing-body
   * label — "New York State — Statewide Financial System (SFS) Vendor Portal"
   * names the publisher and its portal in one human-readable string, and no
   * page ever prints that sentence. The check below is about honesty: the
   * publishing body must name itself on the page we read, and `agency` must not
   * be invented. So a source whose label is composed states the string it
   * really does print here, and the gate asserts THAT string on the page —
   * whitespace-collapsed, because the rendered page breaks lines. The fallback
   * (option unset) is unchanged `toContain(connector.agency)`, so no other
   * state's gate gets weaker, and nothing here allows skipping the check.
   */
  agencyTextOnPage?: string;
  /**
   * Source-specific live realities: what this listing is expected to show today
   * (a rolling program, a closed cycle, the source's own wording). Kept in the
   * state's own file so the shared gate stays generic.
   */
  expectLive?: (opportunities: GrantOpportunity[], liveText: string) => void;
}

/**
 * This harness is deliberately named with a `.test.ts` suffix (even though it
 * only exports helpers): the prod-config typecheck excludes test files from its
 * program, and importing bun:test from a non-test file adds a typecheck delta
 * for no benefit. The harness is never run as its own file's tests — it is
 * invoked by the per-state source-validation test files.
 */

/**
 * Runs the whole live gate for one state. Called at module top level by
 * `<state>.source-validation.test.ts`, so the single live fetch is shared by
 * every assertion in the file.
 */
export async function runLiveSourceValidation(
  options: LiveSourceValidationOptions,
): Promise<void> {
  const { connector, approvedHosts, sourceName, validationTestFile } = options;
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

      // MANIFEST-DRIVEN, NOT HARD-CODED (escalation-pass fix, 2026-09-19).
      //
      // This assertion used to hard-code `limited` + `sourceCount === 1`, which
      // is only true for a ONE-source state. A `curated`/multi-source state, or
      // any state wired with more than one connector, could never pass its own
      // live gate without editing the shared harness — and an edit that WEAKENS a
      // gate is exactly the mistake this harness exists to prevent. So the gate
      // now compares the state's DERIVED registry entry against the state's OWN
      // declared manifest, which still fails on every real dishonesty:
      //   - sources.ts omitted a connector ⇒ `sourcesForState()` is 0 ⇒ the
      //     derived `sourceCount` disagrees and this test fails (the silent-omission
      //     trap the batch checklist calls out);
      //   - a manifest that declares `connected` without the ladder's minimum
      //     number of registered sources ⇒ `deriveStateRegistry()` demotes the
      //     entry to `limited`, so the declared tier and the derived status
      //     disagree and this test fails;
      //   - a state that reached a validated tier with NO source at all ⇒ fails;
      //   - a hand-set status that the derivation would never produce ⇒ fails.
      // A one-source `limited` state passes exactly as it did before.
      const manifest = DEFAULT_REGISTRY_INPUTS.validations[connector.stateCode];
      expect(manifest).not.toBeUndefined();
      expect(manifest!.connectorId).toBe(connector.id);
      const declaredSources = sourcesForState(connector.stateCode).length;
      expect(declaredSources).toBeGreaterThanOrEqual(1);
      // The ladder's own promotion rule, applied to the DECLARED tier: a
      // `connected` claim needs CONNECTED_MIN_SOURCES distinct registered sources.
      const expectedStatus =
        manifest!.tier === "connected" && declaredSources < CONNECTED_MIN_SOURCES
          ? ("limited" as const)
          : manifest!.tier;
      expect(entry.status).toBe(expectedStatus);
      expect(entry.sourceCount).toBe(declaredSources);
      // The tier is always one the manifest may declare — never `unavailable`
      // (this test file only runs for a validated state) and never a status the
      // ladder does not define.
      expect(VALIDATED_REGISTRY_STATUSES).toContain(entry.status);
      // `connected` (statewide, multi-source) is only ever true at the minimum.
      if (entry.status === "connected") {
        expect(entry.sourceCount).toBeGreaterThanOrEqual(CONNECTED_MIN_SOURCES);
      }
      // Every source registered for the state is a real, distinct source with
      // its own key — a duplicate key would be one source wearing two hats.
      const keys = sourcesForState(connector.stateCode).map((s) => s.sourceKey);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toContain(connector.id);
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
      // A COMPOSED label ("State — Portal") is asserted through
      // `agencyTextOnPage` instead — still a verbatim on-page check, never a
      // skipped one; see the option's comment in the interface above.
      const foldedPage = liveText.replace(/\s+/g, " ");
      if (options.agencyTextOnPage !== undefined) {
        expect(foldedPage).toContain(options.agencyTextOnPage.replace(/\s+/g, " ").trim());
      } else {
        expect(liveText).toContain(connector.agency);
      }
      const dateTexts = [
        ...opportunities.map((o) => o.raw.closingText),
        ...opportunities.map((o) => o.raw.applicationDeadline),
        ...opportunities.map((o) => o.raw.enrollmentDatesText),
        ...opportunities.map((o) => o.raw.deadlineValue),
        ...opportunities.map((o) => o.raw.applicationDueDateText),
        // Generic: any connector that keeps the source's own close-date label
        // under one of these two names still shows its date evidence to the
        // gate instead of a "Received: 0". New Jersey and Ohio keep the label
        // as `closeDateLabelText`; New York keeps the published Due Date cell
        // verbatim as `closeDateCellText`. Both are the source's own words, so
        // both are exactly the evidence this assertion asks for.
        ...opportunities.map((o) => o.raw.closeDateLabelText),
        ...opportunities.map((o) => o.raw.closeDateCellText),
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
      // of inventing records from it (each connector names its own marker in the
      // error message).
      expect((thrown as { stage?: string }).stage).toBe("parse");
      expect((thrown as Error).message.length).toBeGreaterThan(10);
    }, LIVE_TIMEOUT_MS);
  });
}
