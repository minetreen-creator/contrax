/**
 * LIVE source validation for the SAM.gov v1 search `state=` filter (`sam_gov` /
 * `sam_gov_regional`).
 *
 * WHY OPT-IN: ordinary CI must never depend on an external site (owner guardrail
 * 2026-09-19). This file does NOTHING unless `BIDS_RUN_LIVE_SOURCE_TESTS=1` — run by
 *   `bun run validate:live-bids-sources`
 * (or `BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/sam-gov.source-validation.test.ts`).
 * Skipped, it says so loudly.
 *
 * WHAT IT PROVES against the real SAM.gov API, using the connector's own headers
 * (`SAM_HEADERS` — the browser-like Accept the API requires):
 *   1. the state-scoped URL BUILT BY THE CONNECTOR (`buildSamSearchUrl`) is
 *      actually scoped: `state=VA` returns strictly fewer notices than the
 *      unfiltered national pool, and the returned rows really are Virginia
 *      place-of-performance (the v1 item's own `location.states`);
 *   2. the invalid code `state=ZZ` returns ZERO — the filter is real, not a
 *      keyword search that happens to be small;
 *   3. the old, silently-ignored `placeOfPerformance.state=` spelling still
 *      returns the UNSCOPED national total (the bug this connector no longer
 *      has), so the fixed spelling stays distinguishable from it.
 *
 * A missing/unreachable response FAILS the test (it does not skip): a live gate
 * that cannot read the source proves nothing.
 *
 * Live measurement 2026-10-16 (this probe, advisory): baseline 228,710 /
 * placeOfPerformance.state=VA 228,710 / state=VA 539 (25 of 25 rows Virginia) /
 * state=NY 264 (24 of 25 rows New York) / state=ZZ 0.
 */
import { describe, expect, test } from "bun:test";
import { SAM_HEADERS, buildSamSearchUrl } from "./sam-gov";

const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/sam-gov.source-validation.test.ts\`) to ` +
      `verify the SAM.gov state filter against the real API.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the URL logic, NOT the live API.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching the real SAM.gov search API (opt-in).${RESET}\n`,
  );
}

const LIVE_TIMEOUT_MS = 60_000;

type Envelope = {
  total: number | null;
  items: any[];
  status: number;
  untouched: boolean;
};

/** Page 0 of a real SAM.gov search URL — the bytes come from the live API. */
async function fetchUrl(url: string): Promise<Envelope> {
  const resp = await fetch(url, { headers: SAM_HEADERS });
  const untouched = !(await resp.clone().text()).includes("Whitelabel");
  if (!resp.ok) return { total: null, items: [], status: resp.status, untouched };
  const data: any = await resp.json();
  return {
    total: data?.page?.totalElements ?? null,
    items: data?._embedded?.results ?? [],
    status: resp.status,
    untouched,
  };
}

/** The connector's OWN URL for a state value (or none) — the thing under test. */
async function fetchPage(states: string | undefined): Promise<Envelope> {
  return fetchUrl(buildSamSearchUrl(states, 0));
}

/**
 * The PRE-FIX URL: the connector's national URL plus the old, ignored
 * `placeOfPerformance.state=` parameter — i.e. exactly what `sam-gov.ts` sent
 * before this fix. Built here so the bug stays reproducible in the gate.
 */
function preFixUrl(state: string): string {
  return `${buildSamSearchUrl(undefined, 0)}&placeOfPerformance.state=${state}`;
}

/** The place-of-performance states the v1 item itself carries (may be absent). */
function popStates(item: any): string[] {
  return (item?.location?.states ?? [])
    .map((s: any) => String(s?.code ?? "").toUpperCase())
    .filter(Boolean);
}

describe.skipIf(SKIP)("sam_gov LIVE — the state filter is scoped against the real API", () => {
  test(
    "an invalid state code matches NOTHING (the filter is real, not a keyword search)",
    async () => {
      const zz = await fetchPage("ZZ");
      expect(zz.status).toBe(200);
      expect(zz.untouched).toBe(true); // not a Whitelabel error page
      expect(zz.total).toBe(0);
      expect(zz.items.length).toBe(0);
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "state=VA is scoped, and the returned rows really are Virginia place-of-performance",
    async () => {
      const national = await fetchPage(undefined);
      const va = await fetchPage("VA");
      expect(national.status).toBe(200);
      expect(national.total).toBeGreaterThan(0);
      expect(va.status).toBe(200);

      // 1. strictly scoped: far fewer notices than the national pool.
      expect(va.total).toBeGreaterThan(0);
      expect(va.total).toBeLessThan(national.total!);
      expect(va.total!).toBeLessThan(national.total! * 0.2);

      // 2. row-level proof: the rows themselves are Virginia.
      const withPop = va.items.filter((i) => popStates(i).length > 0);
      expect(withPop.length).toBeGreaterThan(0);
      const virginia = withPop.filter((i) => popStates(i).includes("VA"));
      expect(virginia.length / withPop.length).toBeGreaterThanOrEqual(0.8);

      console.log(
        `  live: national ${national.total} / state=VA ${va.total} / ` +
          `${virginia.length} of ${withPop.length} returned rows carry location.states VA`,
      );
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "the OLD placeOfPerformance.state= spelling is still unscoped (the bug stays distinguishable)",
    async () => {
      const national = await fetchPage(undefined);
      const old = await fetchUrl(preFixUrl("VA"));
      const va = await fetchPage("VA");
      expect(national.status).toBe(200);
      expect(old.status).toBe(200);
      // Silently ignored ⇒ the unfiltered national pool, orders of magnitude more
      // than the honest `state=VA` answer for the same state.
      expect(old.total).toBeGreaterThan(national.total! * 0.9);
      expect(old.total).toBeGreaterThan(va.total! * 10);
      console.log(
        `  live: placeOfPerformance.state=VA ${old.total} vs national ${national.total} vs state=VA ${va.total}` +
          ` — the ignored spelling is unscoped`,
      );
    },
    LIVE_TIMEOUT_MS,
  );
});
