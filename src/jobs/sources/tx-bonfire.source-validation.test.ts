/**
 * TEXAS BONFIRE TENANTS — SOURCE-VALIDATION TEST (the LIVE gate for
 * `tx_txdot_bonfire` + `tx_uttyler_bonfire`, batch 3a; owner guardrail
 * 2026-09-19: ordinary CI must never depend on a live external website).
 *
 * OPT-IN BY DESIGN. This file does NOTHING unless it is explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/tx-bonfire.source-validation.test.ts
 *
 * With `BIDS_RUN_LIVE_SOURCE_TESTS` unset — the default `bun test`, and therefore
 * every CI run — the tests are SKIPPED and a loud notice is printed, so the skip
 * can never be silent. The default suite stays 100% deterministic (the committed
 * captures in fixtures/tx-txdot-bonfire/ + fixtures/tx-uttyler-bonfire/ prove the
 * parser with ZERO network; that is tx-bonfire.test.ts). A skipped run proves
 * NOTHING about the live tenants: these two sources may only be reported as
 * readable on a PASSING explicit run of this file.
 *
 * WHAT IT PROVES against the real tenants:
 *   1. both tenants answer the connector's exact request shape on the official
 *      host, with `success:1` and a projects object (a shape change fails loudly);
 *   2. the connector's real fetch runs end to end on each tenant and every
 *      accepted row is verifiable and honest: tenant-scoped `external_id` prefix,
 *      official-host `source_url`, `location` "Texas", non-empty title/agency,
 *      `set_aside`/`naics_code`/`psc`/`notice_type` NULL (ruling f — a Bonfire
 *      public list publishes none of them and nothing may be inferred), and a
 *      `due_date` that is a parseable instant not already past (the reader drops
 *      past-due rows, so a past instant here would be a defect);
 *   3. the OPEN SET holds against live bytes: every row the tenant's own section
 *      returns is `ProjectStatusID` "2", and the same bytes carry no closed row
 *      that the reader silently accepted;
 *   4. THE TIME-ZONE RULE holds on the wire: every `DateClose` is a zone-less
 *      `YYYY-MM-DD HH:mm:ss` string and every emitted `due_date` is exactly that
 *      value read as UTC (never shifted by 5–6 h into America/Chicago) — the live
 *      counterpart of the pinned rule in bonfire-public.ts;
 *   5. parsing the same live bytes twice yields identical rows (no churn).
 *
 * Once invoked, a failure to READ a tenant FAILS the test — it does not skip.
 */
import { describe, expect, test } from "bun:test";
import { bonfireCloseMs, bonfireDataUrl, bonfirePortalUrl, parseBonfire, type BonfirePayload } from "./bonfire-public";
import { TX_TXDOT_BONFIRE_CONFIG, fetchTxTxdotBonfireBids } from "./tx-txdot-bonfire";
import { TX_UTTYLER_BONFIRE_CONFIG, fetchTxUttylerBonfireBids } from "./tx-uttyler-bonfire";

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
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/tx-bonfire.source-validation.test.ts\`) to ` +
      `verify the TxDOT and UT Tyler Bonfire tenants against the real sources.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live tenants.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${bonfireDataUrl(TX_TXDOT_BONFIRE_CONFIG)} and ` +
      `${bonfireDataUrl(TX_UTTYLER_BONFIRE_CONFIG)} for real (opt-in).${RESET}\n`,
  );
}
const LIVE_TIMEOUT_MS = 60_000;

/** One live read of a tenant's public list, using the connector's own config. */
async function livePayload(cfg: typeof TX_TXDOT_BONFIRE_CONFIG): Promise<BonfirePayload> {
  const url = bonfireDataUrl(cfg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(`${url}?_=${Date.now()}`, {
      headers: { Accept: "application/json", Referer: bonfirePortalUrl(cfg) },
      signal: controller.signal,
    });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
    const body = (await resp.json()) as { success?: number; payload?: BonfirePayload };
    if (!body?.success || typeof body.payload?.projects !== "object") {
      throw new Error(`${url} response shape changed: no payload.projects`);
    }
    return body.payload;
  } catch (e) {
    throw new Error(`live Bonfire source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** One live read of BOTH tenants through the connectors' real fetch paths. */
const live = SKIP
  ? null
  : await (async () => ({
      txdot: { result: await fetchTxTxdotBonfireBids(), payload: await livePayload(TX_TXDOT_BONFIRE_CONFIG) },
      uttyler: { result: await fetchTxUttylerBonfireBids(), payload: await livePayload(TX_UTTYLER_BONFIRE_CONFIG) },
    }))();

const TENANTS = [
  { cfg: TX_TXDOT_BONFIRE_CONFIG, key: "txdot" as const },
  { cfg: TX_UTTYLER_BONFIRE_CONFIG, key: "uttyler" as const },
];

describe.skipIf(SKIP)("Texas Bonfire tenancy source validation (live)", () => {
  test("both tenants are reachable and still return the shape the connector parses", () => {
    for (const { cfg, key } of TENANTS) {
      const payload = live![key].payload;
      expect(Object.keys(payload.projects).length).toBeGreaterThan(0);
      expect(cfg.host.endsWith(".bonfirehub.com")).toBe(true);
      // The tenant's own section really is the open-only list.
      for (const p of Object.values(payload.projects)) expect(String(p.ProjectStatusID)).toBe("2");
      console.log(
        `  ${cfg.source} live: listed ${Object.keys(payload.projects).length}, ` +
          `connector accepted ${live![key].result.rows.length}`,
      );
    }
  });

  test("every row the connectors accepted is verifiable, honest and correctly keyed", () => {
    const now = Date.now();
    for (const { cfg, key } of TENANTS) {
      const rows = live![key].result.rows;
      for (const b of rows) {
        expect(b.external_id.startsWith(`${cfg.idPrefix}-`)).toBe(true);
        expect(b.external_id).toMatch(new RegExp(`^${cfg.idPrefix}-\\d+$`));
        const u = new URL(b.source_url);
        expect(u.protocol).toBe("https:");
        expect(u.host).toBe(new URL(cfg.host).host);
        expect(u.pathname.startsWith("/opportunities/")).toBe(true);
        expect(b.location).toBe("Texas");
        expect(b.title.trim().length).toBeGreaterThan(0);
        expect(b.agency.trim().length).toBeGreaterThan(0);
        expect(b.due_date).not.toBeNull();
        expect(Number.isNaN(Date.parse(b.due_date!))).toBe(false);
        expect(Date.parse(b.due_date!)).toBeGreaterThan(now - 60_000);
        // Nothing is claimed about fields a Bonfire public list does not publish.
        expect(b.set_aside).toBeNull();
        expect(b.naics_code).toBeNull();
        expect(b.psc).toBeNull();
        expect(b.notice_type).toBeNull();
      }
      const ids = rows.map((b) => b.external_id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // The two tenants never produce the same external_id (per-tenant prefixes).
    const all = [...live!.txdot.result.rows, ...live!.uttyler.result.rows].map((b) => b.external_id);
    expect(new Set(all).size).toBe(all.length);
  });

  test("THE TIME-ZONE RULE holds on live bytes: DateClose is UTC, never shifted to Central", () => {
    for (const { key, cfg } of TENANTS) {
      const payload = live![key].payload;
      const rowsById = new Map(live![key].result.rows.map((b) => [b.external_id, b]));
      let checked = 0;
      for (const p of Object.values(payload.projects)) {
        const b = rowsById.get(`${cfg.idPrefix}-${p.ProjectID}`);
        if (!b) continue; // skipped (past close date / non-competitive) — nothing to compare
        expect(String(p.DateClose)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(b.due_date).toBe(new Date(bonfireCloseMs(p.DateClose)).toISOString());
        // A Central-local read would be 5 h later (17:00Z vs 22:00Z); a Chicago-shifted
        // value would fail this identity. The rule is UTC — see bonfire-public.ts.
        checked++;
      }
      expect(checked).toBe(live![key].result.rows.length);
    }
  });

  test("parsing the same live bytes twice gives the same rows (no churn on re-run)", () => {
    const now = Date.now();
    for (const { cfg, key } of TENANTS) {
      const print = () => parseBonfire(cfg, live![key].payload, now).rows.map((r) => JSON.stringify(r));
      expect(print()).toEqual(print());
    }
  });
});
