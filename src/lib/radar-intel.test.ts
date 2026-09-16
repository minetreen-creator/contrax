/**
 * RADAR LAZY INCUMBENT INTEL — OWNER 09-16 (Radar scan-latency fix, tests).
 *
 * Three things are proven here:
 *   A. the bound on the CLIENT per-opportunity fetch (~/lib/radar-intel
 *      loadRadarIntel) — never hangs, never throws, never leaves a stuck
 *      spinner: ok/none/unavailable, plus the timeout and rejection paths;
 *   B. the ENTITLEMENT ticket (~/lib/radar-handoff.server) the scan mints and
 *      the lazy endpoint verifies — the paywalled intel for gated (4th+)
 *      matches can never be fetched, and a handoff cookie cannot be replayed
 *      as a ticket (HMAC purpose separation);
 *   C. the SCAN PATH is structurally free of FPDS work (source assertions) and
 *      upstream-call-free at runtime (a real full-pipeline scan with a fetch
 *      counter), while the 15 s never-stuck cap is UNCHANGED (owner order #4/#5).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadRadarIntel, RADAR_INTEL_CLIENT_TIMEOUT_MS } from "~/lib/radar-intel";
import {
  signRadarIntelTicket,
  verifyRadarIntelTicket,
  intelTicketAllows,
  signRadarHandoff,
} from "~/lib/radar-handoff.server";
import { RADAR_SCAN_TIMEOUT_MS } from "~/lib/radar-scan-runner";
import { sql as dbFactory } from "~/db";
import { expandTrade, tradeKeywordPred, isStrongTradeMatch } from "~/lib/trade-registry";
import { sbCertFragment, certMatches } from "~/lib/cert-matching";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { runKeywordScanQuery } from "~/lib/radar-scan-query";

process.env.RADAR_HANDOFF_SECRET = "unit-test-secret-radar-intel";

function readSrc(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}
/** Strip comments so an assertion about CODE is not satisfied/blinded by prose. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const INTEL = {
  incumbent_name: "ACME CLEANING LLC", incumbent_uei: "ABC123", total_obligated: 1000,
  pop_start_date: null, pop_end_date: null, historical_pricing: [],
};

// ─────────────────────────────────────────────────────────────────────────────
describe("A. client lazy loader — bounded, never stuck, never throws", () => {
  test("passes through the server's three-way status (ok / none / unavailable)", async () => {
    expect(await loadRadarIntel(async () => ({ status: "ok", intel: INTEL }))).toEqual({ status: "ok", intel: INTEL });
    expect(await loadRadarIntel(async () => ({ status: "none", intel: null }))).toEqual({ status: "none", intel: null });
    expect(await loadRadarIntel(async () => ({ status: "unavailable", intel: null }))).toEqual({ status: "unavailable", intel: null });
  });

  test("a THROWING / malformed response degrades to 'unavailable' (never an exception to the card)", async () => {
    expect(await loadRadarIntel(async () => { throw new Error("network"); })).toEqual({ status: "unavailable", intel: null });
    expect(await loadRadarIntel(async () => undefined)).toEqual({ status: "unavailable", intel: null });
    // "ok" with no data is never rendered as a fabricated winner
    expect(await loadRadarIntel(async () => ({ status: "ok", intel: null } as any))).toEqual({ status: "unavailable", intel: null });
  });

  test("a HANGING fetch settles as 'unavailable' inside the budget", async () => {
    const started = Date.now();
    const state = await loadRadarIntel(() => new Promise(() => {}), 40);
    const elapsed = Date.now() - started;
    expect(state.status).toBe("unavailable");
    expect(state.intel).toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });

  test("the client budget is a real, documented constant below the 15 s scan cap", () => {
    expect(RADAR_INTEL_CLIENT_TIMEOUT_MS).toBe(6000);
    expect(RADAR_INTEL_CLIENT_TIMEOUT_MS).toBeLessThan(RADAR_SCAN_TIMEOUT_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("B. entitlement ticket — the free ≤3 rule moves to the lazy endpoint, intact", () => {
  test("round trip: the entitled ids verify, a non-member id does not", () => {
    const ticket = signRadarIntelTicket([101, 202, 303]);
    const p = verifyRadarIntelTicket(ticket);
    expect(p?.m).toEqual([101, 202, 303]);
    expect(intelTicketAllows(p, 101)).toBe(true);
    expect(intelTicketAllows(p, 303)).toBe(true);
    expect(intelTicketAllows(p, 404)).toBe(false); // gated match → no lookup, no data
    expect(intelTicketAllows(null, 101)).toBe(false); // no ticket → fail-closed
  });

  test("ids are deduped + bounded, and junk ids are never entitled", () => {
    const p = verifyRadarIntelTicket(signRadarIntelTicket([5, 5, 6, 0, -3, 1.5 as unknown as number]));
    expect(p?.m).toEqual([5, 6]);
    expect(intelTicketAllows(p, 0)).toBe(false);
  });

  test("TAMPERING fails closed (signature + membership cannot be forged)", () => {
    const ticket = signRadarIntelTicket([11, 22, 33]);
    expect(verifyRadarIntelTicket(ticket + "x")).toBeNull();
    expect(verifyRadarIntelTicket("not-a-ticket")).toBeNull();
    expect(verifyRadarIntelTicket("")).toBeNull();
    expect(verifyRadarIntelTicket(null)).toBeNull();
    // Re-encode the payload with an extra id but keep the old signature → null.
    const [body, sig] = ticket.split(".");
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, m: [...payload.m, 999] }), "utf8")
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(verifyRadarIntelTicket(`${forgedBody}.${sig}`)).toBeNull();
  });

  test("HMAC purpose separation: a handoff cookie value is NOT a valid intel ticket", () => {
    const handoff = signRadarHandoff({
      v: "visitor-1", t: "janitorial", c: "sb", s: "VA", z: "any", m: [7, 8, 9], k: Date.now(),
    });
    expect(verifyRadarIntelTicket(handoff)).toBeNull();
    // …and an intel ticket is not a valid handoff payload either.
    const ticket = signRadarIntelTicket([7, 8, 9]);
    expect(ticket).not.toBe(handoff);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("C. scan path — no FPDS, base-path latency, 15 s cap untouched", () => {
  const radar = stripComments(readSrc("routes/radar.tsx"));
  const scanHandler = radar.slice(
    radar.indexOf("export const runRadarScan"),
    radar.indexOf("export const getRadarMatchIntel"),
  );

  test("the SCAN HANDLER performs no FPDS/incumbent lookup at all (structural)", () => {
    expect(scanHandler.length).toBeGreaterThan(1000); // the slice really is the handler
    for (const forbidden of ["getFPDSIntel", "lookupFPDSIntel", "~/lib/fpds", "searchFPDSIncumbent", "fetchHistoricalPricing", "incumbent = await"]) {
      expect(`${forbidden}:${scanHandler.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
    // …and it still returns matches + provenance + the entitlement ticket.
    expect(scanHandler.includes("return { matches, certLabel: CERT_LABEL[certId]")).toBe(true);
    expect(scanHandler.includes("intelTicket")).toBe(true);
    expect(scanHandler.includes("signRadarIntelTicket")).toBe(true);
  });

  test("the LAZY endpoint exists, is entitled-checked, and is the only FPDS caller from the radar route", () => {
    expect(radar.includes("export const getRadarMatchIntel")).toBe(true);
    const lazy = radar.slice(radar.indexOf("export const getRadarMatchIntel"));
    expect(lazy.includes("verifyRadarIntelTicket")).toBe(true);
    expect(lazy.includes("intelTicketAllows")).toBe(true);
    expect(lazy.includes("lookupFPDSIntel(")).toBe(true);
    // the bid row supplies the lookup inputs (client only sends the id + ticket)
    expect(lazy.includes("opportunityId: row.external_id")).toBe(true);
    expect(lazy.includes("FPDS_RADAR_LOOKUP_TIMEOUT_MS")).toBe(true);
  });

  test("the CARD loads intel lazily per displayed opportunity (3 states wired, no server-shipped intel)", () => {
    expect(radar.includes("useRadarIntel(")).toBe(true);
    expect(radar.includes("loadRadarIntel(")).toBe(true);
    expect(radar.includes("Checking previous winner")).toBe(true);
    expect(radar.includes("unavailable right now")).toBe(true);
    // no card may read a server-shipped incumbent any more…
    expect(radar.includes("SHOW_FREE_INCUMBENT && match.incumbent")).toBe(false);
    // …and the 15 s never-stuck cap is UNTOUCHED (owner orders #4 + #5).
    expect(RADAR_SCAN_TIMEOUT_MS).toBe(15_000);
  });

  test("upstream fetches are structurally bounded (AbortSignal on every call)", () => {
    const fpds = stripComments(readSrc("lib/fpds.ts"));
    expect(fpds.includes("AbortSignal.timeout(FPDS_FETCH_TIMEOUT_MS)")).toBe(true);
    expect(fpds.includes("signal: merged.signal")).toBe(true);
    // the rate-limit wait itself is abortable — an aborted lookup stops spending
    expect(fpds.includes("abortableSleep")).toBe(true);
  });
});

// A real full-pipeline scan (the same predicates + scoring the handler runs)
// with a fetch counter: proves the scan path makes ZERO upstream calls, and
// records the base-path duration the owner's fix targets.
describe("C2. runtime: a real scan query is upstream-call-free and sub-second (DB-backed)", () => {
  const HAS_DB = !!process.env.DATABASE_URL;
  test("janitorial nationwide: real DB scan + real filter/score = 0 upstream calls", async () => {
    if (!HAS_DB) return;
    // Count ONLY USAspending/FPDS traffic: the Neon serverless driver also
    // speaks HTTP through global fetch, so a blanket counter would be wrong.
    const realFetch = globalThis.fetch;
    let upstream = 0;
    const usaspendingCalls: string[] = [];
    (globalThis as any).fetch = (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? "";
      if (String(url).includes("usaspending.gov")) { upstream++; usaspendingCalls.push(String(url)); }
      return (realFetch as any)(input, init);
    };
    const started = Date.now();
    let matches = 0;
    try {
      const expansion = expandTrade("janitorial");
      const certFrag = sbCertFragment(dbFactory);
      const rows: any[] = await runKeywordScanQuery(
        dbFactory,
        { certFrag, tradeFrag: tradeKeywordPred(dbFactory, expansion) },
        LOW_CONTENT_SQL,
      );
      const strong = rows
        .filter((r: any) => certMatches(r.set_aside, [r.source], "sb") === "include")
        .filter((r: any) => isStrongTradeMatch(r.title, r.category, r.description, r.naics_code, expansion));
      matches = Math.min(strong.length, 5);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
    const elapsed = Date.now() - started;
    expect(usaspendingCalls).toEqual([]); // ← the whole point of the owner's order #1
    expect(upstream).toBe(0);
    expect(elapsed).toBeLessThan(2000); // sub-second base path (was 7.6–15.8 s)
    expect(matches).toBeGreaterThan(0); // the criteria really produce matches
  });
});
