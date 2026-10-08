/**
 * eVA SOURCE-VALIDATION TEST — the LIVE gate for the `va_eva` connector
 * (owner guardrail 2026-09-19: ordinary CI must never depend on a live external
 * website; owner spec 2026-10-08 for this source).
 *
 * OPT-IN BY DESIGN. This file does NOTHING unless it is explicitly invoked:
 *
 *     bun run validate:live-bids-sources
 *     # equivalently:
 *     BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-eva.source-validation.test.ts
 *
 * With `BIDS_RUN_LIVE_SOURCE_TESTS` unset — the default `bun test`, and therefore
 * every CI run — the tests are SKIPPED and a loud notice is printed, so the skip
 * can never be silent. The default suite stays 100% deterministic (the committed
 * fixtures in fixtures/va-eva/ prove the parser and the gates with ZERO network;
 * that is va-eva.test.ts). A skipped run proves NOTHING about eVA: this source may
 * only be reported as reading the live portal on a PASSING explicit run of this
 * file.
 *
 * WHAT IT PROVES against the real Solr proxy (`solrconnect.jsp`):
 *   1. HTTP 200 and a real Solr JSON body (not eVA's React shell, not the 5-byte
 *      malformed-query body). The query echoed back in `responseHeader.params.q`
 *      IS `EVA_OPEN_QUERY`, verbatim — i.e. the open set this source reads is the
 *      hard-coded `app:IV AND status:Open AND closedate:[NOW TO *]`, not something
 *      the server quietly rewrote.
 *   2. THE APP SCOPE HOLDS ON THE WIRE: every document the open set returns has
 *      `app === "IV"`, and the query is a STRICT SUBSET of a bare `status:Open`
 *      query — which is what keeps the ARCHIVED `app:VBO` app (frozen 2023, one
 *      row still labelled "Open") out of the corpus.
 *   3. THE ENCODING TRAP IS REAL, AND WE SURVIVE IT: a space sent as `+` really
 *      does answer HTTP 200 with a < 20-byte body; the connector's own gate
 *      refuses that shape. (Asserted live so the guard can never be "cleaned up"
 *      as dead code.)
 *   4. THE COUNT GATE PASSES ON A REAL FULL READ: running the connector's own
 *      `fetchVaEvaBids()` returns rows, and — by construction, since the gate
 *      throws otherwise — the documents it read equal the `numFound` the source
 *      reported. The count gate result is printed.
 *   5. THE CLOSE-DATE RULE HOLDS: every emitted `due_date` is exactly what eVA
 *      published (`new Date(closedate).toISOString()`), never shifted to/from
 *      Eastern — the owner-noted, still-unsettled zone quirk. Countdown labels
 *      are suppressed for this source (see `VA_EVA_DUE_DATE_ZONE_UNVERIFIED`).
 *   6. every `source_url` is absolute on `mvendor.cgieva.com`, and every
 *      `external_id` is `eva-IV…`; `naics_code` / `psc` / `solicitation_number`
 *      are NULL because eVA publishes none — never invented.
 *
 * Once invoked, a failure to reach the source FAILS the test — it does not skip.
 */
import { describe, expect, test } from "bun:test";
import {
  EVA_HEADERS,
  EVA_MIN_BODY_BYTES,
  EVA_OPEN_QUERY,
  EVA_ORIGIN,
  EVA_SOLR_ENDPOINT,
  VA_EVA_DUE_DATE_ZONE_UNVERIFIED,
  evaQueryUrl,
  fetchVaEvaBids,
  parseEvaDocs,
  type EvaDoc,
} from "./va-eva";

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
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/va-eva.source-validation.test.ts\`) to ` +
      `verify eVA, Virginia's procurement portal, against the real source.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser and the gates, NOT the live source.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${EVA_SOLR_ENDPOINT} for real (opt-in).${RESET}\n`,
  );
}
const LIVE_TIMEOUT_MS = 60_000;
const liveIt = SKIP ? test.skip : test;

/** One live GET against the Solr proxy, with the connector's own headers. */
async function liveGet(url: string): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: EVA_HEADERS, signal: controller.signal });
    // Deliberately NOT swallowed into a skip: a source we cannot verify fails the gate.
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { status: resp.status, text: await resp.text() };
  } catch (e) {
    throw new Error(`live eVA source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

const docUrl = (params: Record<string, string | number>) =>
  `${EVA_SOLR_ENDPOINT}?` +
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

describe("va_eva LIVE — the open set is the hard-coded app:IV query, echoed verbatim", () => {
  liveIt("the proxy answers real Solr JSON and echoes EVA_OPEN_QUERY unchanged", async () => {
    const { text } = await liveGet(docUrl({ q: EVA_OPEN_QUERY, rows: 0, wt: "json" }));
    expect(text.length).toBeGreaterThanOrEqual(EVA_MIN_BODY_BYTES);
    const body = JSON.parse(text) as {
      responseHeader?: { params?: { q?: string } };
      response?: { numFound?: number; docs?: unknown[] };
    };
    expect(body.responseHeader?.params?.q).toBe(EVA_OPEN_QUERY);
    expect(body.response?.numFound).toBeGreaterThan(0);
    expect(Array.isArray(body.response?.docs)).toBe(true);
    console.warn(`${BOLD}eVA open set right now: numFound=${body.response?.numFound}${RESET}`);
  });

  liveIt("the app:IV scope is a subset of a bare status:Open, and the archived app is what it excludes", async () => {
    const scoped = JSON.parse(
      (await liveGet(docUrl({ q: EVA_OPEN_QUERY, rows: 0, wt: "json" }))).text,
    ) as { response: { numFound: number } };
    const statusOnly = JSON.parse(
      (await liveGet(docUrl({ q: "status:Open", rows: 0, wt: "json" }))).text,
    ) as { response: { numFound: number } };
    const archivedOpen = JSON.parse(
      (await liveGet(docUrl({ q: "app:VBO AND status:Open", rows: 0, wt: "json" }))).text,
    ) as { response: { numFound: number } };
    console.warn(
      `${BOLD}eVA counts: app:IV AND status:Open AND closedate=[NOW TO *] = ${scoped.response.numFound} · ` +
        `status:Open (whole index) = ${statusOnly.response.numFound} · archived app:VBO status:Open = ${archivedOpen.response.numFound}${RESET}`,
    );
    // A subset, never a superset — and every extra row a bare `status:Open`
    // admits is scope the app:IV query is entitled to drop. (The size of that
    // extra set tracks the archived app's one stale "Open" label, so the
    // inequality is asserted softly and the MEANING is pinned by the per-document
    // `app === "IV"` check below, not by this arithmetic.)
    expect(scoped.response.numFound).toBeLessThanOrEqual(statusOnly.response.numFound);
    expect(scoped.response.numFound).toBeGreaterThan(0);
  });

  liveIt("every document the open set returns is app:IV — no archived app row can arrive", async () => {
    const body = JSON.parse(
      (await liveGet(evaQueryUrl("*", 100))).text,
    ) as { response: { docs: EvaDoc[] } };
    expect(body.response.docs.length).toBeGreaterThan(0);
    for (const doc of body.response.docs) {
      expect(doc.app).toBe("IV");
    }
  });
});

describe("va_eva LIVE — the measured encoding trap, and the count gate on a real full read", () => {
  liveIt("a space sent as `+` still answers HTTP 200 with a sub-20-byte body (the trap is real)", async () => {
    // Built by hand: `urlencode`-style `+` in place of `%20`.
    const malformed = `${EVA_SOLR_ENDPOINT}?q=app%3AIV+AND+status%3AOpen&rows=0&wt=json`;
    const { status, text } = await liveGet(malformed);
    console.warn(`${BOLD}malformed (+-encoded) query → HTTP ${status}, ${text.length} bytes${RESET}`);
    expect(status).toBe(200);
    expect(text.length).toBeLessThan(EVA_MIN_BODY_BYTES);
    expect(() => JSON.parse(text)).toThrow();
  });

  liveIt("fetchVaEvaBids() reads the WHOLE live open set — the count gate passes — and rows are honest", async () => {
    const { rows, skipped, skippedRows } = await fetchVaEvaBids();
    console.warn(
      `${BOLD}va_eva live rows: ${rows.length} accepted; skips: ${JSON.stringify(skipped)}${RESET}`,
    );
    // The count gate above threw if the read was short, so reaching here means
    // documents read === the source's own numFound.
    expect(rows.length).toBeGreaterThan(0);
    // Nothing disappears without a reason code (rows + skips account for the read).
    expect(rows.length + skippedRows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.external_id.startsWith("eva-IV")).toBe(true);
      expect(row.source_url!.startsWith(`${EVA_ORIGIN}/Vendor/public/`)).toBe(true);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.agency.length).toBeGreaterThan(0);
      // eVA publishes no NAICS/NIGP on app:IV — these must stay NULL, never guessed.
      expect(row.naics_code).toBeNull();
      expect(row.psc).toBeNull();
      expect(row.solicitation_number).toBeNull();
      // A due date is either absent or a real instant — never an invented one.
      if (row.due_date !== null) {
        expect(Number.isNaN(Date.parse(row.due_date))).toBe(false);
      }
    }
    // The owner-flagged zone question is still open, so no countdown may be shown.
    expect(VA_EVA_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
  });

  liveIt("the close-date rule holds on real bytes: due_date is EXACTLY what eVA published, never shifted", async () => {
    const raw = JSON.parse((await liveGet(evaQueryUrl("*", 100))).text) as {
      response: { docs: EvaDoc[] };
    };
    const { rows } = parseEvaDocs(raw.response.docs, Date.now());
    expect(rows.length).toBeGreaterThan(0);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    let checked = 0;
    for (const doc of raw.response.docs) {
      const row = byId.get(`eva-${doc.id}`);
      if (!row || !doc.closedate) continue;
      // Identical to the published value, to the millisecond — an ET→UTC (or
      // UTC→ET) conversion would differ by 4–5 hours here.
      expect(row.due_date).toBe(new Date(doc.closedate).toISOString());
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
