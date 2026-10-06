/**
 * TEXAS ESBD SOURCE-VALIDATION TEST — the LIVE gate for the `tx_esbd` connector
 * (Texas Comptroller Electronic State Business Daily; owner guardrail
 * 2026-09-19: ordinary CI must never depend on a live external website).
 *
 * OPT-IN BY DESIGN. This file does NOTHING unless it is explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/tx-esbd.source-validation.test.ts
 *
 * With `BIDS_RUN_LIVE_SOURCE_TESTS` unset — the default `bun test`, and therefore
 * every CI run — the tests are SKIPPED and a loud notice is printed, so the skip
 * can never be silent. The default suite stays 100% deterministic: the fixtures in
 * fixtures/tx-esbd/ prove the parser with ZERO network (that is tx-esbd.test.ts).
 * A skipped run proves NOTHING about the live board: the connector may only be
 * reported as covering Texas on a PASSING explicit run of this file.
 *
 * WHAT IT PROVES against the real service:
 *   1. `ESBD.Service.ss` still answers the connector's EXACT request shape with the
 *      shape the parser expects (HTTP 200, a `lines` array, a positive
 *      `recordsPerPage` and a positive `totalRecordsFound`), for the two open
 *      status filters AND for statuses 4 and 5. Those shape facts are HARD
 *      assertions: a restructured service FAILS the gate. It never degrades to a
 *      skip and never to an honest-empty.
 *   2. the connector's real paged fetch (`fetchTxEsbdBids`) runs end to end against
 *      the live service — the entire production read path, not a re-implementation.
 *   3. every accepted row is honest and verifiable: `source_url` on the official
 *      host with the `/esbd/<solicitationId>` path, `location` "Texas", and
 *      `set_aside` / `naics_code` / `psc` NULL (ruling f — ESBD's list publishes
 *      none of them, so nothing may be inferred); every `due_date` is null or a
 *      parseable instant that is not already past (the connector drops past-due
 *      rows, so a past instant would be a defect, not a source fact).
 *   4. the open-set DEFINITION holds: only statuses 1 (Posted) and 6 (Addendum
 *      Posted) are read, and status 4 (New — scheduled, not public yet) and status
 *      5 (Closed) are never admitted. This is asserted against live bytes, so a
 *      future service change that relabels them fails here.
 *   5. parsing the same live bytes twice yields identical rows — a re-run cannot
 *      rewrite a row it already has (the no-churn property).
 *
 * Once invoked, a failure to READ the source FAILS the test — it does not skip.
 */
import { describe, expect, test } from "bun:test";
import {
  ESBD_HEADERS,
  ESBD_OPEN_STATUS_FILTERS,
  ESBD_PUBLIC_PAGE,
  ESBD_SERVICE,
  esbdDetailUrl,
  fetchTxEsbdBids,
  parseEsbdLines,
  type EsbdLine,
} from "./tx-esbd";

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
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/tx-esbd.source-validation.test.ts\`) to ` +
      `verify the Texas ESBD service against the real source.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live source.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${ESBD_SERVICE} for real (opt-in).${RESET}\n`,
  );
}
const LIVE_TIMEOUT_MS = 45_000;

/**
 * One page from the live service, using the connector's OWN exported constants and
 * the exact JSON body its `fetchPage` sends. Deliberately NOT swallowed into a
 * skip: a source we cannot read fails the gate.
 */
async function liveProbe(status: string, page = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(ESBD_SERVICE, {
      method: "POST",
      headers: ESBD_HEADERS,
      body: JSON.stringify({ lines: [], page, urlRoot: "esbd", status }),
      signal: controller.signal,
    });
    const text = await resp.text();
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for status ${status}`);
    let body: { lines?: EsbdLine[]; recordsPerPage?: number; totalRecordsFound?: number };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`status ${status} response was not JSON (${text.length} bytes)`);
    }
    if (!Array.isArray(body.lines)) throw new Error(`status ${status} response shape changed: no lines array`);
    return {
      status,
      httpStatus: resp.status,
      lines: body.lines,
      recordsPerPage: body.recordsPerPage ?? 0,
      totalRecordsFound: body.totalRecordsFound ?? 0,
    };
  } catch (e) {
    throw new Error(`live Texas ESBD source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** One live read of the whole open set through the connector's real paged path. */
const live = SKIP
  ? null
  : await (async () => {
      // The connector itself throws SourceUnreachableError for an unreadable
      // board; that becomes a hard failure below, never a skip.
      const result = await fetchTxEsbdBids();
      const probes = {
        "1": await liveProbe("1"),
        "6": await liveProbe("6"),
        "5": await liveProbe("5"),
        "4": await liveProbe("4"),
      };
      return { result, probes };
    })();

const OPEN_NAMES = ["posted", "addendum posted"];

describe.skipIf(SKIP)("tx_esbd source validation (live)", () => {
  test("the service is reachable and still returns the shape the connector parses", () => {
    for (const status of ["1", "6", "5", "4"]) {
      const p = live!.probes[status as "1" | "6" | "5" | "4"];
      expect(p.httpStatus).toBe(200);
      // A missing `lines` array already threw in liveProbe; here the page has to be
      // a real page, not an empty shell.
      expect(p.lines.length).toBeGreaterThan(0);
      expect(p.recordsPerPage).toBeGreaterThan(0);
      expect(p.totalRecordsFound).toBeGreaterThan(0);
      // The paging loop needs a sane page size; a page never exceeds it.
      expect(p.lines.length).toBeLessThanOrEqual(p.recordsPerPage);
    }
    // The public page the connector cites as the Referer still exists.
    expect(ESBD_PUBLIC_PAGE).toBe("https://www.txsmartbuy.gov/esbd");
    console.log(
      `  tx_esbd live: ` +
        Object.values(live!.probes)
          .map((p) => `status ${p.status} total=${p.totalRecordsFound} perPage=${p.recordsPerPage}`)
          .join("; ") +
        `; connector accepted ${live!.result.rows.length} open rows`,
    );
  });

  test("every row the connector accepted is verifiable and honest", () => {
    const now = Date.now();
    const rows = live!.result.rows;
    // Honest-empty is possible in principle; the shape test above already proved
    // the source answered, so a vacuous pass here cannot hide a broken service.
    for (const b of rows) {
      // Identity + the official detail link, byte-compared against the helper's
      // own URL so an encoding change cannot slip through.
      expect(b.external_id).toMatch(/^esbd-\d+$/);
      const u = new URL(b.source_url);
      expect(u.protocol).toBe("https:");
      expect(u.host).toBe("www.txsmartbuy.gov");
      expect(u.pathname).toBe(new URL(esbdDetailUrl(b.solicitation_number!)).pathname);
      expect(u.pathname.startsWith("/esbd/")).toBe(true);
      expect(b.location).toBe("Texas");
      expect(b.title.length).toBeGreaterThan(0);
      expect(b.agency.length).toBeGreaterThan(0);
      // Only the two open status names may be admitted.
      expect(OPEN_NAMES).toContain(String(b.notice_type).toLowerCase());
      // Null-or-parseable, never invented — and never already past (the connector
      // drops past-due rows, so a past instant here is a defect).
      if (b.due_date != null) {
        expect(Number.isNaN(Date.parse(b.due_date))).toBe(false);
        expect(Date.parse(b.due_date)).toBeGreaterThan(now - 60_000);
      }
      // Nothing is claimed about fields this source does not publish (ruling f).
      expect(b.set_aside).toBeNull();
      expect(b.naics_code).toBeNull();
      expect(b.psc).toBeNull();
    }
    const ids = rows.map((b) => b.external_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the open set is statuses 1+6 only — status 4 (New) and 5 (Closed) are never admitted", () => {
    // The definition itself is pinned, not just its current behaviour.
    expect([...ESBD_OPEN_STATUS_FILTERS]).toEqual(["1", "6"]);
    const now = Date.now();
    const excluded = new Set<string>();
    for (const status of ["5", "4"] as const) {
      const lines = live!.probes[status].lines;
      // The service really is returning rows for these filters…
      expect(lines.length).toBeGreaterThan(0);
      // …none of which is ever labelled "Posted" / "Addendum Posted" — so the
      // exclusion is a source fact, not an accident of our filter string.
      for (const l of lines) {
        expect(OPEN_NAMES).not.toContain(String(l.statusName ?? "").toLowerCase());
        if (l.internalid) excluded.add(`esbd-${String(l.internalid).trim()}`);
      }
      // …and none of which the parser admits.
      const parsed = parseEsbdLines(lines, now);
      expect(parsed.rows.length).toBe(0);
      expect(parsed.skipped.not_open ?? 0).toBe(lines.length);
    }
    // No accepted row may be an id the closed / not-yet-public filters returned.
    for (const b of live!.result.rows) expect(excluded.has(b.external_id)).toBe(false);
  });

  test("parsing the same live bytes twice gives the same rows (no churn on re-run)", () => {
    const now = Date.now();
    const openLines = [...live!.probes["1"].lines, ...live!.probes["6"].lines];
    expect(openLines.length).toBeGreaterThan(0);
    const print = (lines: readonly EsbdLine[]) =>
      parseEsbdLines(lines, now).rows.map((r) => JSON.stringify(r));
    expect(print(openLines)).toEqual(print(openLines));
    // Same property for the excluded filters — an excluded row must stay excluded.
    expect(print(live!.probes["5"].lines)).toEqual(print(live!.probes["5"].lines));
    expect(print(live!.probes["4"].lines)).toEqual(print(live!.probes["4"].lines));
  });
});
