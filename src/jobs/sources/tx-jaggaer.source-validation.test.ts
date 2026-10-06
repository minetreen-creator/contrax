/**
 * TEXAS UNIVERSITY JAGGAER TENANTS — SOURCE-VALIDATION TEST (the LIVE gate for
 * `tx_uh_jaggaer`, `tx_tamu_jaggaer`, `tx_texastech_jaggaer` and
 * `tx_utsa_jaggaer`, batch 3b; owner guardrail 2026-09-19: ordinary CI must
 * never depend on a live external website).
 *
 * OPT-IN BY DESIGN. This file DOES NOTHING unless it is explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/tx-jaggaer.source-validation.test.ts
 *
 * With `BIDS_RUN_LIVE_SOURCE_TESTS` unset — the default `bun test`, and therefore
 * every CI run — the tests are SKIPPED and a loud notice is printed, so the skip
 * can never be silent. The default suite stays 100% deterministic (the committed
 * captures in fixtures/tx-*-jaggaer/ prove the parser with ZERO network; that is
 * tx-jaggaer.test.ts). A skipped run proves NOTHING about the live tenants: these
 * four sources may only be reported as readable on a PASSING explicit run of this
 * file.
 *
 * WHAT IT PROVES against the real tenants:
 *   1. all four answer the connector's exact request shape on the official host
 *      (bids.sciquest.com, each with its own `CustomerOrg`), no login, so a shape
 *      change or a dead tenant fails loudly;
 *   2. the connectors' real fetch path runs end to end on each tenant and every
 *      accepted row is verifiable and honest: tenant-scoped `external_id` prefix,
 *      official-host `source_url`, `location` "Texas", non-empty title/agency,
 *      `set_aside`/`naics_code`/`psc` NULL (a JAGGAER public list publishes none of
 *      them and nothing may be inferred), and a `due_date` not already past;
 *   3. THE COUNT CROSS-CHECK holds on live bytes — with or without a printed
 *      "of N Results" total (TAMU prints one, the other three do not): the rows
 *      the page rendered equal the events parsed, and a printed total equals them
 *      too. This is the live counterpart of the pinned rule in jaggaer-public.ts;
 *   4. THE DATE RULE holds on the wire: every emitted `due_date` is exactly its
 *      event's printed close date read in the zone the page prints beside it;
 *   5. the four tenants never produce the same external_id (per-tenant prefixes),
 *      measured on live ids, and parsing the same bytes twice yields identical
 *      rows (no churn).
 *
 * Once invoked, a failure to READ a tenant FAILS the test — it does not skip.
 */
import { describe, expect, test } from "bun:test";
import {
  countJaggaerCloseRows,
  jaggaerDateToIso,
  jaggaerListUrl,
  parseJaggaerPage,
  type JaggaerConfig,
} from "./jaggaer-public";
import { TX_TAMU_JAGGAER_CONFIG, fetchTxTamuJaggaerBids } from "./tx-tamu-jaggaer";
import { TX_TEXASTECH_JAGGAER_CONFIG, fetchTxTexasTechJaggaerBids } from "./tx-texastech-jaggaer";
import { TX_UH_JAGGAER_CONFIG, fetchTxUhJaggaerBids } from "./tx-uh-jaggaer";
import { TX_UTSA_JAGGAER_CONFIG, fetchTxUtsaJaggaerBids } from "./tx-utsa-jaggaer";

/** The live validation is OPT-IN — see the header for why. */
const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
/** Bold/coloured so a skip cannot scroll past unnoticed in a CI log. */
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
const TENANT_LABELS = "tx_uh_jaggaer, tx_tamu_jaggaer, tx_texastech_jaggaer, tx_utsa_jaggaer";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/tx-jaggaer.source-validation.test.ts\`) to ` +
      `verify the Texas university JAGGAER tenants (${TENANT_LABELS}) against the real sources.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live tenants.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${TENANT_LABELS} on bids.sciquest.com for real (opt-in).${RESET}\n`,
  );
}
const LIVE_TIMEOUT_MS = 60_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** One live read of a tenant's Open for Bid page with the connector's own request. */
async function liveHtml(cfg: JaggaerConfig): Promise<string> {
  const url = `${jaggaerListUrl(cfg)}&PageSize=200`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
    const html = await resp.text();
    if (!html.includes("PHX_NAV_SourcingOpenForBid")) throw new Error(`${url} is not an Open for Bid page`);
    return html;
  } catch (e) {
    throw new Error(`live JAGGAER source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

const TENANTS = [
  { cfg: TX_UH_JAGGAER_CONFIG, key: "uh" as const },
  { cfg: TX_TAMU_JAGGAER_CONFIG, key: "tamu" as const },
  { cfg: TX_TEXASTECH_JAGGAER_CONFIG, key: "texastech" as const },
  { cfg: TX_UTSA_JAGGAER_CONFIG, key: "utsa" as const },
];

/** One live read per tenant through the connector's real fetch path AND the raw page. */
const live = SKIP
  ? null
  : await (async () => {
      const out: Record<string, { result: Awaited<ReturnType<typeof fetchTxUhJaggaerBids>>; html: string }> = {};
      for (const { cfg, key } of TENANTS) {
        const result =
          key === "uh"
            ? await fetchTxUhJaggaerBids()
            : key === "tamu"
              ? await fetchTxTamuJaggaerBids()
              : key === "texastech"
                ? await fetchTxTexasTechJaggaerBids()
                : await fetchTxUtsaJaggaerBids();
        out[key] = { result, html: await liveHtml(cfg) };
      }
      return out;
    })();

describe.skipIf(SKIP)("Texas university JAGGAER tenants source validation (live)", () => {
  test("all four tenants are reachable and still return the shape the connector parses", () => {
    for (const { cfg, key } of TENANTS) {
      const { result, html } = live![key]!;
      const parsed = parseJaggaerPage(cfg, html);
      expect(parsed.events.length).toBeGreaterThan(0);
      expect(result.rows.length).toBeGreaterThan(0);
      console.log(
        `  ${cfg.source} live: page total ${
          parsed.total ?? "not printed"
        }, ${parsed.events.length} events listed, connector accepted ${result.rows.length}`,
      );
    }
  });

  test("THE COUNT CROSS-CHECK holds on live bytes: rows rendered, rows parsed, printed total", () => {
    for (const { cfg, key } of TENANTS) {
      const { html } = live![key]!;
      const parsed = parseJaggaerPage(cfg, html);
      const rendered = countJaggaerCloseRows(html);
      expect(rendered).toBe(parsed.events.length);
      if (parsed.total !== null) expect(parsed.events.length).toBe(parsed.total);
    }
  });

  test("every row the connectors accepted is verifiable, honest and correctly keyed", () => {
    const now = Date.now();
    for (const { cfg, key } of TENANTS) {
      for (const b of live![key]!.result.rows) {
        expect(b.external_id.startsWith(`${cfg.idPrefix}-`)).toBe(true);
        expect(b.external_id).toMatch(new RegExp(`^${cfg.idPrefix}-\\d+$`));
        const u = new URL(b.source_url);
        expect(u.protocol).toBe("https:");
        expect(u.host).toBe("bids.sciquest.com");
        expect(u.searchParams.get("CustomerOrg")).toBe(cfg.customerOrg);
        expect(b.location).toBe("Texas");
        expect(b.title.trim().length).toBeGreaterThan(0);
        expect(b.agency.trim().length).toBeGreaterThan(0);
        expect(b.due_date).not.toBeNull();
        expect(Number.isNaN(Date.parse(b.due_date!))).toBe(false);
        expect(Date.parse(b.due_date!)).toBeGreaterThan(now - 60_000);
        expect(b.set_aside).toBeNull();
        expect(b.naics_code).toBeNull();
        expect(b.psc).toBeNull();
      }
      const ids = live![key]!.result.rows.map((b) => b.external_id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // The four tenants never produce the same external_id (per-tenant prefixes).
    const all = TENANTS.flatMap(({ key }) => live![key]!.result.rows.map((b) => b.external_id));
    expect(new Set(all).size).toBe(all.length);
  });

  test("THE DATE RULE holds on live bytes: due_date is the printed close time in the printed zone", () => {
    for (const { cfg, key } of TENANTS) {
      const parsed = parseJaggaerPage(cfg, live![key]!.html);
      const rowsById = new Map(live![key]!.result.rows.map((b) => [b.external_id, b]));
      let checked = 0;
      for (const e of parsed.events) {
        const b = rowsById.get(`${cfg.idPrefix}-${e.id}`);
        if (!b) continue; // skipped (past close date / non-competitive) — nothing to compare
        expect(e.close).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2} [AP]M [A-Z]{2,4}$/);
        expect(b.due_date).toBe(jaggaerDateToIso(e.close));
        checked++;
      }
      expect(checked).toBe(live![key]!.result.rows.length);
    }
  });

  test("parsing the same live bytes twice gives the same rows (no churn on re-run)", () => {
    for (const { cfg, key } of TENANTS) {
      const now = Date.now();
      const print = () => parseJaggaerPage(cfg, live![key]!.html, now).rows.map((r) => JSON.stringify(r));
      expect(print()).toEqual(print());
    }
  });
});
