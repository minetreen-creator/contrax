/**
 * Wisconsin DOA VendorNet Bids (`wi_vendornet`) — LIVE SOURCE VALIDATION (opt-in).
 *
 * This gate runs the connector's REAL headless path: it spawns
 * `.github/scripts/vendornet-bids-fetch.mjs` (puppeteer-core against the host's
 * Chrome), drives the open-only filter on the LIVE board, pages the whole open set
 * and parses the payload. That is deliberately NOT the default suite: it needs a
 * browser and a driver dependency, and ordinary CI must never depend on a live
 * external site (owner test-determinism guardrail 2026-09-19).
 *
 * Run it deliberately, on a machine with Chrome + `puppeteer-core` installed in the
 * driver's directory (or `WI_VENDORNET_FETCH_SCRIPT` pointing at one):
 *   BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/wi-vendornet.source-validation.test.ts
 * or `bun run validate:live-bids-sources` (which runs this file too).
 *
 * Once invoked, a failure to READ the source FAILS the test — it never skips, and it
 * never degrades to "zero rows": the connector itself throws `SourceUnreachableError`
 * for an unreadable board, which the assertion below turns into a hard failure.
 */
import { describe, expect, test } from "bun:test";
import {
  fetchWiVendornetBids,
  parseWiVendornetPayload,
  resolveWiVendornetDriverConfig,
  WI_VENDORNET_ENDPOINT,
  WI_VENDORNET_HOST,
  WI_VENDORNET_LOCATION,
} from "./wi-vendornet";

const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run ` +
      `\`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/wi-vendornet.source-validation.test.ts\` ` +
      `(needs Chrome + puppeteer-core in the driver's directory) to verify the Wisconsin DOA VendorNet board ` +
      `against the real source.${RESET}\n  The default run is fixture-only and deterministic: it proves the ` +
      `parser logic, NOT the live source.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — driving a real browser against ${WI_VENDORNET_ENDPOINT} (opt-in).${RESET}\n`,
  );
}

/** One live read, shared by the assertions below (public data, read only). */
const live = SKIP
  ? null
  : await (async () => {
      const cfg = resolveWiVendornetDriverConfig();
      try {
        const result = await fetchWiVendornetBids();
        const payload = JSON.parse(
          (await import("node:fs")).readFileSync(cfg.outFile, "utf8"),
        ) as Parameters<typeof parseWiVendornetPayload>[0];
        return { result, payload };
      } catch (e) {
        // Deliberately NOT swallowed into a skip: a source we cannot read fails.
        throw new Error(`live VendorNet source validation could not run: ${(e as Error).message}`);
      }
    })();

describe.skipIf(SKIP)("wi_vendornet source validation (live)", () => {
  test("the board is reachable, the grid rendered rows, and the open set was fully read", () => {
    const { payload } = live!;
    // The 3.8 KB shell alone renders nothing: rows arriving at all is the
    // WebSocket proof, and it is asserted explicitly rather than assumed.
    expect(Number(payload.rowsSeen)).toBeGreaterThan(0);
    expect(Number(payload.countFromSource)).toBeGreaterThan(0);
    expect(Number(payload.rowsSeen)).toBeGreaterThanOrEqual(Number(payload.countFromSource));
    const blazor = payload.blazor as { webSocketCreated?: number; webSocketFramesReceived?: number } | undefined;
    expect(blazor?.webSocketCreated ?? 0).toBeGreaterThan(0);
    expect(blazor?.webSocketFramesReceived ?? 0).toBeGreaterThan(0);
    // Every page's own footer text is present (the audit trail for the count).
    for (const page of payload.pages) expect(String(page.footerText)).toContain("items");
  });

  test("every parsed row is verifiable, honest, and uses only `bids` columns", () => {
    const { result } = live!;
    // Honest-empty is allowed; a shape/count failure already failed the gate above
    // (the connector throws for it instead of returning zero rows).
    for (const b of result.rows) {
      const u = new URL(b.source_url);
      expect(u.host).toBe(WI_VENDORNET_HOST);
      expect(u.pathname.toLowerCase()).toBe("/bids");
      expect(b.location).toBe(WI_VENDORNET_LOCATION);
      expect(b.title.length).toBeGreaterThan(0);
      expect(b.agency.length).toBeGreaterThan(0);
      // Null-or-parseable, never invented.
      if (b.due_date != null) expect(Number.isNaN(Date.parse(b.due_date))).toBe(false);
      // Nothing claimed about fields this source does not publish (ruling f).
      expect(b.set_aside).toBeNull();
      expect(b.naics_code).toBeNull();
      expect(b.psc).toBeNull();
      expect(b.notice_type).toBeNull();
    }
    // No duplicate identity inside one read (the payload-level collision rule is
    // counted in the diagnostics, and every emitted id is unique).
    const ids = result.rows.map((b) => b.external_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("parsing the same live payload twice gives the same rows (no churn on a re-run)", () => {
    const first = parseWiVendornetPayload(live!.payload);
    const second = parseWiVendornetPayload(live!.payload);
    expect(JSON.stringify(first.rows)).toBe(JSON.stringify(second.rows));
  });
});
