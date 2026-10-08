/**
 * COUNTY OF LOUDOUN SOURCE-VALIDATION TEST — the LIVE gate for `va_loudoun`
 * (owner guardrail 2026-09-19: ordinary CI must never depend on a live external
 * website; owner green-light 2026-10-08 for the Virginia locality boards).
 *
 * OPT-IN BY DESIGN. This file does NOTHING unless explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-loudoun.source-validation.test.ts
 *
 * With `BIDS_RUN_LIVE_SOURCE_TESTS` unset — the default `bun test`, and therefore
 * every CI run — the tests are SKIPPED and a loud notice is printed, so the skip
 * can never be silent. The default suite stays 100% deterministic (the committed
 * fixtures in fixtures/loudoun/ prove the parser and the gates with ZERO network;
 * that is loudoun.test.ts). A skipped run proves NOTHING about this board: the
 * source may only be reported as reading it live on a PASSING explicit run.
 *
 * WHAT IT PROVES against `https://www.loudoun.gov/bids.aspx`:
 *   1. the board is REACHABLE and the connector's own read covered AT LEAST the
 *      number of items the board published at capture time (2026-10-08: 10). The
 *      floor is the CAPTURE, never an exact count — boards churn — and a row that
 *      has CLOSED since the capture is counted as READ (it was on the board) while
 *      still being reported separately, so churn can never masquerade as a
 *      truncated read;
 *   2. every emitted row is honest and verifiable (per-board id prefix, absolute
 *      per-bid `source_url` on the board's own host, the board's literal
 *      `agency`/`location`, `due_date` NULL-or-parseable, and NULL for every field
 *      the board does not publish — never invented);
 *   3. the live bytes still carry the item-region anchors, and re-parsing the SAME
 *      live bytes twice gives the SAME rows (no churn);
 *   4. the query-param URL (`?showAllBids=true&Status=all`) is STILL not the open
 *      board, so the connector's bare-URL rule is still the correct one.
 *
 * Once invoked, a failure to READ the source FAILS the test — it does not skip,
 * and it never degrades to "zero rows".
 */
import { describe, expect, test } from "bun:test";
import { CIVICENGAGE_HEADERS, CIVICENGAGE_ITEMS_ANCHOR, CIVICENGAGE_MIN_BODY_BYTES } from "./civicengage-bids";
import {
  fetchVaLoudounBids,
  parseVaLoudounBoard,
  VA_LOUDOUN_AGENCY,
  VA_LOUDOUN_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_LOUDOUN_COPY,
  VA_LOUDOUN_DUE_DATE_ZONE_UNVERIFIED,
  VA_LOUDOUN_ENDPOINT,
  VA_LOUDOUN_ID_PREFIX,
  VA_LOUDOUN_LOCATION,
  VA_LOUDOUN_SOURCE,
} from "./va-loudoun";

const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-loudoun.source-validation.test.ts\`) ` +
      `to verify ${VA_LOUDOUN_SOURCE} against the real board.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser and the gates, NOT the live board.\n`,
  );
} else {
  console.warn(`\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${VA_LOUDOUN_ENDPOINT} for real (opt-in).${RESET}\n`);
}
const LIVE_TIMEOUT_MS = 60_000;
const liveIt = SKIP ? test.skip : test;
/** One live GET, with the connector's own headers. A board we cannot read FAILS. */
async function liveGet(url: string): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: CIVICENGAGE_HEADERS, signal: controller.signal });
    return { status: resp.status, text: await resp.text() };
  } catch (e) {
    throw new Error(`live ${VA_LOUDOUN_SOURCE} source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
/** One live read through the connector, plus the raw bytes and the trap probe. */
const live = SKIP
  ? null
  : await (async () => {
      const now = Date.now();
      try {
        const connector = await fetchVaLoudounBids(now);
        const raw = await liveGet(VA_LOUDOUN_ENDPOINT);
        const trap = await liveGet(`${VA_LOUDOUN_ENDPOINT}?showAllBids=true&Status=all`);
        return { connector, raw, trap, now };
      } catch (e) {
        // Deliberately NOT swallowed into a skip: a board we cannot read fails.
        throw new Error(`live ${VA_LOUDOUN_SOURCE} source validation could not run: ${(e as Error).message}`);
      }
    })();

describe.skipIf(SKIP)(`${VA_LOUDOUN_SOURCE} source validation (live)`, () => {
  liveIt("the board is reachable and AT LEAST the captured number of items was read", () => {
    const { connector } = live!;
    const closedSinceCapture = connector.skipped.closed ?? 0;
    const read = connector.rows.length + closedSinceCapture;
    console.warn(
      `${BOLD}${VA_LOUDOUN_SOURCE} live: rows=${connector.rows.length} · closed-since-capture=${closedSinceCapture} · ` +
        `read=${read} (capture 2026-10-08 was ${VA_LOUDOUN_CAPTURED_OPEN_ROWS_2026_10_08}) · skips=${JSON.stringify(connector.skipped)}${RESET}`,
    );
    // The FLOOR is the capture, not an exact count: boards churn. A board that
    // publishes fewer items than it did is still a passing read, but a read that
    // cannot account for the items the board did publish is not.
    expect(read).toBeGreaterThanOrEqual(VA_LOUDOUN_CAPTURED_OPEN_ROWS_2026_10_08);
    if (connector.rows.length < VA_LOUDOUN_CAPTURED_OPEN_ROWS_2026_10_08) {
      console.warn(
        `${BOLD}NOTE: ${VA_LOUDOUN_SOURCE} now lists fewer OPEN rows than at capture — expected churn, ` +
          `item(s) have closed since 2026-10-08.${RESET}`,
      );
    }
    // Nothing disappeared without a reason code, and no reason is a shape failure
    // (a shape failure throws inside the connector rather than returning rows).
    expect(connector.rows.length + connector.skippedRows.length).toBeGreaterThan(0);
    for (const reason of Object.keys(connector.skipped)) {
      expect(["closed", "not_open", "id_catid_mismatch"]).toContain(reason);
    }
  });
  liveIt("every live row is verifiable and honest (no invented field, no wrong jurisdiction)", () => {
    for (const b of live!.connector.rows) {
      expect(b.external_id.startsWith(`${VA_LOUDOUN_ID_PREFIX}-`)).toBe(true);
      const u = new URL(b.source_url!);
      expect(u.host).toBe(new URL(VA_LOUDOUN_ENDPOINT).host);
      expect(u.pathname.toLowerCase()).toBe("/bids.aspx");
      expect(u.searchParams.get("bidID")).toBe(b.external_id.slice(VA_LOUDOUN_ID_PREFIX.length + 1));
      expect(b.agency).toBe(VA_LOUDOUN_AGENCY);
      expect(b.location).toBe(VA_LOUDOUN_LOCATION);
      expect(b.title.length).toBeGreaterThan(0);
      // Null-or-parseable, never a sentinel mapped to a fabricated instant.
      if (b.due_date != null) expect(Number.isNaN(Date.parse(b.due_date))).toBe(false);
      // Nothing claimed about fields this board does not publish.
      expect(b.set_aside).toBeNull();
      expect(b.naics_code).toBeNull();
      expect(b.psc).toBeNull();
      expect(b.notice_type).toBeNull();
      expect(b.solicitation_number).toBeNull();
    }
    const ids = live!.connector.rows.map((b) => b.external_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  liveIt("the live bytes still carry the item-region anchors, and re-parsing them twice gives the same rows", () => {
    const { raw } = live!;
    expect(raw.status).toBe(200);
    expect(raw.text.length).toBeGreaterThanOrEqual(CIVICENGAGE_MIN_BODY_BYTES);
    expect(raw.text).toContain(CIVICENGAGE_ITEMS_ANCHOR);
    const first = parseVaLoudounBoard(raw.text, live!.now);
    const second = parseVaLoudounBoard(raw.text, live!.now);
    expect(JSON.stringify(first.rows)).toBe(JSON.stringify(second.rows));
    expect(first.skipped.shape_change).toBeUndefined();
  });
  liveIt("the query-param URL is STILL not the open board (the bare URL stays the only request)", () => {
    const { trap } = live!;
    console.warn(`${BOLD}${VA_LOUDOUN_SOURCE} trap probe: HTTP ${trap.status}, ${trap.text.length} bytes${RESET}`);
    // The conclusion, not the status code: whatever the board answers, the
    // response is NOT the open board (Dayton answers 200-empty; these boards 404).
    expect(trap.text.includes(CIVICENGAGE_ITEMS_ANCHOR)).toBe(false);
    expect(trap.status === 200 && trap.text.includes(CIVICENGAGE_ITEMS_ANCHOR)).toBe(false);
  });
  liveIt("the zone question is still open, so no countdown may be rendered for these rows", () => {
    expect(VA_LOUDOUN_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(VA_LOUDOUN_COPY.timeZoneNote).toContain("does not show a countdown");
  });
});
