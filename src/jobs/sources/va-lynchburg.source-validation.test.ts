/**
 * CITY OF LYNCHBURG SOURCE-VALIDATION TEST — the LIVE gate for `va_lynchburg`
 * (owner guardrail 2026-09-19: ordinary CI must never depend on a live external
 * website; owner green-light 2026-10-08 for the Virginia locality boards).
 *
 * OPT-IN BY DESIGN. This file does NOTHING unless explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-lynchburg.source-validation.test.ts
 *
 * With the flag unset — the default `bun test`, and therefore every CI run — the
 * tests are SKIPPED with a loud notice, so the skip can never be silent. The
 * default suite stays 100% deterministic (fixtures/lynchburg/); that is
 * va-lynchburg.test.ts. Once invoked, a failure to READ the source FAILS the test
 * — it never skips and never degrades to "zero rows".
 *
 * Proofs: reachability + a read of AT LEAST the captured item count (2026-10-08:
 * 3; the floor is the CAPTURE, never an exact count, and a row that closed since
 * is counted as read while still reported separately) · honest rows (id prefix,
 * absolute per-bid URL on the board's own host, literal agency/location,
 * due_date NULL-or-parseable, NULL for every unpublished field) · the live bytes
 * still carry the item-region anchors and re-parse identically · the query-param
 * URL is still not the open board · the zone flag still suppresses a countdown.
 */
import { describe, expect, test } from "bun:test";
import { CIVICENGAGE_HEADERS, CIVICENGAGE_ITEMS_ANCHOR, CIVICENGAGE_MIN_BODY_BYTES } from "./civicengage-bids";
import {
  fetchVaLynchburgBids,
  parseVaLynchburgBoard,
  VA_LYNCHBURG_AGENCY,
  VA_LYNCHBURG_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_LYNCHBURG_COPY,
  VA_LYNCHBURG_DUE_DATE_ZONE_UNVERIFIED,
  VA_LYNCHBURG_ENDPOINT,
  VA_LYNCHBURG_ID_PREFIX,
  VA_LYNCHBURG_LOCATION,
  VA_LYNCHBURG_SOURCE,
} from "./va-lynchburg";

const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-lynchburg.source-validation.test.ts\`) ` +
      `to verify ${VA_LYNCHBURG_SOURCE} against the real board.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser and the gates, NOT the live board.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${VA_LYNCHBURG_ENDPOINT} for real (opt-in).${RESET}\n`,
  );
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
    throw new Error(`live ${VA_LYNCHBURG_SOURCE} source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
const live = SKIP
  ? null
  : await (async () => {
      const now = Date.now();
      try {
        const connector = await fetchVaLynchburgBids(now);
        const raw = await liveGet(VA_LYNCHBURG_ENDPOINT);
        const trap = await liveGet(`${VA_LYNCHBURG_ENDPOINT}?showAllBids=true&Status=all`);
        return { connector, raw, trap, now };
      } catch (e) {
        throw new Error(`live ${VA_LYNCHBURG_SOURCE} source validation could not run: ${(e as Error).message}`);
      }
    })();

describe.skipIf(SKIP)(`${VA_LYNCHBURG_SOURCE} source validation (live)`, () => {
  liveIt("the board is reachable and AT LEAST the captured number of items was read", () => {
    const { connector } = live!;
    const closedSinceCapture = connector.skipped.closed ?? 0;
    const read = connector.rows.length + closedSinceCapture;
    console.warn(
      `${BOLD}${VA_LYNCHBURG_SOURCE} live: rows=${connector.rows.length} · closed-since-capture=${closedSinceCapture} · ` +
        `read=${read} (capture 2026-10-08 was ${VA_LYNCHBURG_CAPTURED_OPEN_ROWS_2026_10_08}) · skips=${JSON.stringify(connector.skipped)}${RESET}`,
    );
    expect(read).toBeGreaterThanOrEqual(VA_LYNCHBURG_CAPTURED_OPEN_ROWS_2026_10_08);
    if (connector.rows.length < VA_LYNCHBURG_CAPTURED_OPEN_ROWS_2026_10_08) {
      console.warn(
        `${BOLD}NOTE: ${VA_LYNCHBURG_SOURCE} now lists fewer OPEN rows than at capture — expected churn, ` +
          `item(s) have closed since 2026-10-08.${RESET}`,
      );
    }
    expect(connector.rows.length + connector.skippedRows.length).toBeGreaterThan(0);
    for (const reason of Object.keys(connector.skipped)) {
      expect(["closed", "not_open", "id_catid_mismatch"]).toContain(reason);
    }
  });
  liveIt("every live row is verifiable and honest (no invented field, no wrong jurisdiction)", () => {
    for (const b of live!.connector.rows) {
      expect(b.external_id.startsWith(`${VA_LYNCHBURG_ID_PREFIX}-`)).toBe(true);
      const u = new URL(b.source_url!);
      expect(u.host).toBe(new URL(VA_LYNCHBURG_ENDPOINT).host);
      expect(u.pathname.toLowerCase()).toBe("/bids.aspx");
      expect(u.searchParams.get("bidID")).toBe(b.external_id.slice(VA_LYNCHBURG_ID_PREFIX.length + 1));
      expect(b.agency).toBe(VA_LYNCHBURG_AGENCY);
      expect(b.location).toBe(VA_LYNCHBURG_LOCATION);
      expect(b.title.length).toBeGreaterThan(0);
      if (b.due_date != null) expect(Number.isNaN(Date.parse(b.due_date))).toBe(false);
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
    const first = parseVaLynchburgBoard(raw.text, live!.now);
    const second = parseVaLynchburgBoard(raw.text, live!.now);
    expect(JSON.stringify(first.rows)).toBe(JSON.stringify(second.rows));
    expect(first.skipped.shape_change).toBeUndefined();
  });
  liveIt("the query-param URL is STILL not the open board (the bare URL stays the only request)", () => {
    const { trap } = live!;
    console.warn(`${BOLD}${VA_LYNCHBURG_SOURCE} trap probe: HTTP ${trap.status}, ${trap.text.length} bytes${RESET}`);
    expect(trap.text.includes(CIVICENGAGE_ITEMS_ANCHOR)).toBe(false);
    expect(trap.status === 200 && trap.text.includes(CIVICENGAGE_ITEMS_ANCHOR)).toBe(false);
  });
  liveIt("the zone question is still open, so no countdown may be rendered for these rows", () => {
    expect(VA_LYNCHBURG_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(VA_LYNCHBURG_COPY.timeZoneNote).toContain("does not show a countdown");
  });
});
