/**
 * CITY OF DAYTON SOURCE-VALIDATION TEST — the LIVE gate for the `oh_dayton`
 * connector (Ohio Phase 3; owner guardrail 2026-09-19: ordinary CI must never
 * depend on a live external website).
 *
 * OPT-IN BY DESIGN. This file does NOTHING unless it is explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/oh-dayton.source-validation.test.ts
 *
 * With `BIDS_RUN_LIVE_SOURCE_TESTS` unset — the default `bun test`, and therefore
 * every CI run — the tests are SKIPPED and a loud notice is printed, so the skip
 * can never be silent. The default suite stays 100% deterministic (the saved
 * fixtures in fixtures/dayton/ prove the parser with ZERO network; that is
 * oh-dayton.test.ts). A skipped run proves NOTHING about the live board: a
 * connector may only be reported as covering Dayton on a PASSING explicit run of
 * this file.
 *
 * WHAT IT PROVES against the real page:
 *   1. HTTP 200 and the item-region anchor is still present. A MISSING anchor is
 *      a FAIL (the board was restructured); an anchor present with ZERO rows is a
 *      PASS — the City can legitimately have no open bids, and honest-empty is a
 *      correct outcome, not a broken connector.
 *   2. every parsed bidID really appears in the fetched bytes (spot-check against
 *      the live payload, not just against our own parser);
 *   3. every `source_url` is an absolute URL on the official host;
 *   4. every `due_date` is null or parseable — never an invented instant;
 *   5. parsing the same bytes twice yields the same fingerprint, so a re-run
 *      cannot rewrite a row it already has (the no-churn property).
 *
 * Once invoked, a failure to reach the source FAILS the test — it does not skip.
 */
import { describe, expect, test } from "bun:test";
import { DAYTON_ENDPOINT, DAYTON_HEADERS, parseDaytonBoard } from "./oh-dayton";

/** The live validation is OPT-IN — see the header for why. */
const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
/** Bold/coloured so a skip cannot scroll past unnoticed in a CI log. */
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/oh-dayton.source-validation.test.ts\`) to ` +
      `verify the City of Dayton board against the real source.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live source.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${DAYTON_ENDPOINT} for real (opt-in).${RESET}\n`,
  );
}
const LIVE_TIMEOUT_MS = 60_000;

/** One live fetch, shared by the assertions below (a public page, read only).
 *  Uses the connector's own bare-URL request shape (no query params, ever). */
const live = SKIP
  ? null
  : await (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
      try {
        const resp = await fetch(DAYTON_ENDPOINT, { headers: DAYTON_HEADERS, signal: controller.signal });
        const html = await resp.text();
        // Deliberately NOT swallowed into a skip: a source we cannot verify fails
        // the gate.
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return { status: resp.status, html };
      } catch (e) {
        throw new Error(`live City of Dayton source validation could not run: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    })();

const ANCHOR = '<div class="bidItems listItems">';

describe.skipIf(SKIP)("oh_dayton source validation (live)", () => {
  test("the source is reachable and still has the shape the connector parses", () => {
    expect(live!.status).toBe(200);
    // A missing anchor = the board was restructured → FAIL. An anchor with zero
    // rows is honest-empty → PASS (see the file header).
    expect(live!.html).toContain(ANCHOR);
    expect(live!.html).toContain("function submitBidForm");
  });

  test("every parsed row is verifiable against the fetched bytes", () => {
    const { rows, parsed, skipped } = parseDaytonBoard(live!.html);
    // Honest-empty is allowed; a shape failure already failed the test above.
    expect(skipped.shape_change ?? 0).toBe(0);
    expect(parsed.length).toBeGreaterThanOrEqual(0);
    for (const p of parsed) {
      expect(live!.html).toContain(`bids.aspx?bidID=${p.bidID}`);
      expect(p.status.trim().toLowerCase()).toBe("open"); // the board is open-only
    }
    for (const b of rows) {
      const u = new URL(b.source_url);
      expect(u.host).toBe("www.daytonohio.gov");
      expect(u.pathname.toLowerCase()).toBe("/bids.aspx");
      expect(u.searchParams.get("bidID")).toBe(b.external_id.replace("dayton-", ""));
      expect(b.location).toBe("Dayton, OH");
      expect(b.agency).toBe("City of Dayton");
      // Null-or-parseable, never invented.
      if (b.due_date != null) expect(Number.isNaN(Date.parse(b.due_date))).toBe(false);
      // Nothing is claimed about fields this source does not publish.
      expect(b.naics_code).toBeNull();
      expect(b.psc).toBeNull();
      expect(b.notice_type).toBeNull();
      expect(b.solicitation_number).toBeNull();
    }
  });

  test("parsing the same bytes twice gives the same fingerprint (no churn on re-run)", () => {
    const print = (html: string) =>
      parseDaytonBoard(html).parsed.map((p) =>
        [p.group, p.bidID, p.bidNo, p.title, p.status, p.closes].join(" | "),
      );
    expect(print(live!.html)).toEqual(print(live!.html));
  });
});
