/**
 * CITY OF ALEXANDRIA BONFIRE SOURCE-VALIDATION TEST — the LIVE gate for
 * `va_alexandria_bonfire` (owner guardrail 2026-09-19: ordinary CI must never
 * depend on a live external website; owner green-light 2026-10-08 for the Virginia
 * locality boards, dispatch B).
 *
 * OPT-IN BY DESIGN. This file does NOTHING unless explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-alexandria-bonfire.source-validation.test.ts
 *
 * With `BIDS_RUN_LIVE_SOURCE_TESTS` unset — the default `bun test`, and therefore
 * every CI run — the tests are SKIPPED and a loud notice is printed, so the skip can
 * never be silent. The default suite stays 100% deterministic (the committed
 * captures in fixtures/va-alexandria-bonfire/ prove the parser and the gates with
 * ZERO network; that is va-alexandria-bonfire.test.ts). A skipped run proves NOTHING
 * about this tenant: the source may only be reported as readable live on a PASSING
 * explicit run of this file.
 *
 * WHAT IT PROVES against the real tenant:
 *   1. the tenant is REACHABLE and its own section still returns the shape the
 *      connector parses (`success: 1`, a `projects` object, every row status "2");
 *   2. the connector's real fetch runs end to end and EVERY project the tenant
 *      listed became either an accepted row or a recorded skip — nothing vanishes
 *      silently, and every reason code is a known one;
 *   3. every accepted row is honest and verifiable: per-tenant `external_id` prefix,
 *      official-host `source_url`, the locality literal, department labels kept
 *      verbatim, a `due_date` that is a parseable instant not already past, and NULL
 *      for every field a Bonfire public list does not publish (ruling f);
 *   4. THE TIME-ZONE RULE holds on the wire: every `DateClose` is a zone-less
 *      `YYYY-MM-DD HH:mm:ss` string and every emitted `due_date` is exactly that
 *      value read as UTC — never shifted into the tenant's own America/New_York
 *      display zone;
 *   5. parsing the same live bytes twice yields identical rows (no churn).
 *
 * NOTE ON THE FLOOR (same as the Fairfax gate): this endpoint is server-side
 * open-only, so a project that closed since capture LEAVES the list instead of
 * arriving as a skipped `closed` row — a capture-count floor would fail on honest
 * churn. The hard assertions are therefore reachability + completeness; the capture
 * count (3 on 2026-10-08) is reported and compared, never asserted.
 *
 * Once invoked, a failure to READ the tenant FAILS the test — it does not skip and
 * it never degrades to "zero rows".
 */
import { describe, expect, test } from "bun:test";
import { bonfireCloseMs, bonfireDataUrl, bonfirePortalUrl, parseBonfire, type BonfirePayload } from "./bonfire-public";
import {
  fetchVaAlexandriaBonfireBids,
  parseVaAlexandriaBonfire,
  VA_ALEXANDRIA_BONFIRE_CONFIG,
  VA_ALEXANDRIA_BONFIRE_COPY,
  VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_ALEXANDRIA_ID_PREFIX,
  VA_ALEXANDRIA_LOCATION,
  VA_ALEXANDRIA_BONFIRE_SOURCE,
} from "./va-alexandria-bonfire";

/** The live validation is OPT-IN — see the header for why. */
const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-alexandria-bonfire.source-validation.test.ts\`) ` +
      `to verify ${VA_ALEXANDRIA_BONFIRE_SOURCE} against the real tenant.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser and the gates, NOT the live tenant.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${bonfireDataUrl(VA_ALEXANDRIA_BONFIRE_CONFIG)} for real (opt-in).${RESET}\n`,
  );
}
const LIVE_TIMEOUT_MS = 60_000;

/** One live read of the tenant's public list, in the connector's own request shape. */
async function livePayload(cfg: typeof VA_ALEXANDRIA_BONFIRE_CONFIG): Promise<BonfirePayload> {
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
    throw new Error(`live ${VA_ALEXANDRIA_BONFIRE_SOURCE} source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

const live = SKIP
  ? null
  : await (async () => {
      try {
        const result = await fetchVaAlexandriaBonfireBids();
        const payload = await livePayload(VA_ALEXANDRIA_BONFIRE_CONFIG);
        return { result, payload, now: Date.now() };
      } catch (e) {
        // Deliberately NOT swallowed into a skip: a tenant we cannot read fails.
        throw new Error(`live ${VA_ALEXANDRIA_BONFIRE_SOURCE} source validation could not run: ${(e as Error).message}`);
      }
    })();

describe.skipIf(SKIP)(`${VA_ALEXANDRIA_BONFIRE_SOURCE} source validation (live)`, () => {
  test("the tenant is reachable, its section is the open-only list, and every listed project is accounted for", () => {
    const listed = Object.keys(live!.payload.projects).length;
    const accepted = live!.result.rows.length;
    const accounted = accepted + live!.result.skippedRows.length;
    console.warn(
      `${BOLD}${VA_ALEXANDRIA_BONFIRE_SOURCE} live: listed=${listed} · rows=${accepted} · ` +
        `skips=${JSON.stringify(live!.result.skipped)} (capture 2026-10-08 listed ` +
        `${VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08})${RESET}`,
    );
    expect(listed).toBeGreaterThan(0);
    for (const p of Object.values(live!.payload.projects)) expect(String(p.ProjectStatusID)).toBe("2");
    // COMPLETENESS: every project the tenant listed became a row or a recorded skip.
    expect(accounted).toBe(listed);
    for (const reason of Object.keys(live!.result.skipped)) {
      expect(["closed", "not_open", "not_competitive", "missing_fields", "bad_date"]).toContain(reason);
    }
    if (listed < VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08) {
      console.warn(
        `${BOLD}NOTE: ${VA_ALEXANDRIA_BONFIRE_SOURCE} now lists fewer open projects than at capture (${listed} < ` +
          `${VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08}) — expected churn on a server-side open-only list ` +
          `(the captured DOT-Paratransit solicitation closes 2026-10-15 20:00Z).${RESET}`,
      );
    }
  });

  test("every live row is verifiable and honest (no invented field, no wrong jurisdiction)", () => {
    const now = Date.now();
    const named = new Set(Object.values(live!.payload.departments ?? {}).map((d) => d.DepartmentName));
    for (const b of live!.result.rows) {
      expect(b.external_id.startsWith(`${VA_ALEXANDRIA_ID_PREFIX}-`)).toBe(true);
      expect(b.external_id).toMatch(new RegExp(`^${VA_ALEXANDRIA_ID_PREFIX}-\\d+$`));
      const u = new URL(b.source_url!);
      expect(u.protocol).toBe("https:");
      expect(u.host).toBe(new URL(VA_ALEXANDRIA_BONFIRE_CONFIG.host).host);
      expect(u.pathname.startsWith("/opportunities/")).toBe(true);
      expect(b.location).toBe(VA_ALEXANDRIA_LOCATION);
      expect(b.title.trim().length).toBeGreaterThan(0);
      expect(b.agency.trim().length).toBeGreaterThan(0);
      // The department label is either the tenant's own published name, verbatim, or
      // the config's fallback buyer — never an expansion of a code.
      expect(named.has(b.agency) || b.agency === VA_ALEXANDRIA_BONFIRE_CONFIG.buyerName).toBe(true);
      expect(b.due_date).not.toBeNull();
      expect(Number.isNaN(Date.parse(b.due_date!))).toBe(false);
      expect(Date.parse(b.due_date!)).toBeGreaterThan(now - 60_000);
      // Nothing is claimed about fields a Bonfire public list does not publish.
      expect(b.set_aside).toBeNull();
      expect(b.naics_code).toBeNull();
      expect(b.psc).toBeNull();
      expect(b.notice_type).toBeNull();
    }
    const ids = live!.result.rows.map((b) => b.external_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("THE TIME-ZONE RULE holds on live bytes: DateClose is UTC, never America/New_York", () => {
    const rowsById = new Map(live!.result.rows.map((b) => [b.external_id, b]));
    let checked = 0;
    for (const p of Object.values(live!.payload.projects)) {
      const b = rowsById.get(`${VA_ALEXANDRIA_ID_PREFIX}-${p.ProjectID}`);
      if (!b) continue; // skipped (past close date / non-competitive) — nothing to compare
      expect(String(p.DateClose)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(b.due_date).toBe(new Date(bonfireCloseMs(p.DateClose)).toISOString());
      checked++;
    }
    expect(checked).toBe(live!.result.rows.length);
  });

  test("parsing the same live bytes twice gives the same rows (no churn on re-run)", () => {
    const now = Date.now();
    const print = () => parseVaAlexandriaBonfire(live!.payload, now).rows.map((r) => JSON.stringify(r));
    expect(print()).toEqual(print());
    expect(live!.result.rows.map((r) => JSON.stringify(r))).toEqual(print());
  });

  test("the locality literal and the copy still hold (the badge is never the buyer string)", () => {
    expect(VA_ALEXANDRIA_BONFIRE_COPY.noClaimsLine).toContain("does not warrant");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.openSetDefinition).toContain("close date that has not passed");
    expect(VA_ALEXANDRIA_BONFIRE_COPY.badge).toBe("Alexandria");
    const now = Date.now();
    for (const r of parseBonfire(VA_ALEXANDRIA_BONFIRE_CONFIG, live!.payload, now).rows) {
      expect(r.location).toBe(VA_ALEXANDRIA_LOCATION);
      expect(r.source_url).toContain("alexandriava.bonfirehub.com");
    }
  });
});
