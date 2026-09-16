/**
 * FPDS LOOKUP HARDENING — OWNER 09-16 (Radar scan-latency fix, tests).
 *
 * Covers the three owner-ordered cache/latency changes in ~/lib/fpds:
 *   #2 NEGATIVE-Result caching with a TTL (so "no incumbent found" stops
 *      re-hitting USAspending on every repeat scan),
 *   #3 CACHE KEYS that prefer stable identifiers and normalize titles
 *      (case/whitespace/punctuation can no longer destroy reuse; distinct
 *      opportunities never collide),
 *   #1 (supporting) HARD SERVER-SIDE DEADLINES: every upstream fetch carries an
 *      AbortSignal and a total budget, so a stalled/sick upstream returns
 *      "unavailable" instead of hanging.
 *
 * The pure key tests always run. The cache/deadline tests need a live database
 * (the repo's HAS_DB convention — skipped in CI, which has no secrets) and they
 * write ONLY to test-namespaced keys:
 *   fpds:v2:op:FPDSTESTNS:*            (stable-id path)
 *   fpds:v2:t:fpds test fixture*       (normalized-title fallback path)
 * both deleted in afterAll. No production cache row is ever read or removed.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { sql as dbFactory } from "~/db";
import {
  fpdsLookupKey,
  normalizeFpdsKeyId,
  normalizeFpdsKeyText,
  lookupFPDSIntel,
  FPDS_NEGATIVE_TTL_HOURS,
  FPDS_POSITIVE_TTL_DAYS,
} from "~/lib/fpds";

const HAS_DB = !!process.env.DATABASE_URL;

// ── upstream fake (counts calls + honours AbortSignal like the real fetch) ────
interface FakeResponse { status?: number; body?: any; hang?: boolean; delayMs?: number }
let calls: { path: string; hadSignal: boolean }[] = [];
function installFetch(responder: (path: string) => FakeResponse): () => void {
  const real = globalThis.fetch;
  (globalThis as any).fetch = (url: unknown, init: any = {}) => {
    const href = typeof url === "string" ? url : String((url as any)?.url ?? url);
    // ONLY USAspending traffic is faked: the Neon serverless driver also talks
    // HTTP through globalThis.fetch, and intercepting the DB would fake the
    // database itself.
    if (!href.includes("usaspending.gov")) return (real as any)(url, init);
    const path = href.replace("https://api.usaspending.gov/api/v2", "");
    const signal: AbortSignal | undefined = init?.signal;
    calls.push({ path, hadSignal: !!signal && typeof signal.aborted === "boolean" });
    const r = responder(path);
    return new Promise((resolve, reject) => {
      const aborted = () => { const e = new Error("aborted"); e.name = "AbortError"; return e; };
      if (r.hang) {
        // A hung socket: only the AbortSignal can end this.
        if (!signal) return;
        if (signal.aborted) { reject(aborted()); return; }
        signal.addEventListener("abort", () => reject(aborted()), { once: true });
        return;
      }
      setTimeout(() => {
        const status = r.status ?? 200;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => r.body ?? {},
          text: async () => (r.body == null ? "" : JSON.stringify(r.body)),
        } as any);
      }, r.delayMs ?? 0);
    });
  };
  return () => { (globalThis as any).fetch = real; };
}
const AWARD_ROW = {
  "Award ID": "47PM0024C0031",
  "Recipient Name": "ACME CLEANING LLC",
  "Recipient UEI": "ABC123DEF456",
  "Award Amount": 1_250_000,
  "Start Date": "2024-01-22",
  "End Date": "2026-01-21",
  generated_unique_award_id: "CONT_AWD_47PM0024C0031_4732_47PM0024R0031",
};
const searchOk = (rows: any[]): FakeResponse => ({ body: { results: rows } });

const NS_SOURCE = "fpds-test-ns";          // → key component FPDSTESTNS
const NS_KEY_LIKE = "fpds:v2:op:FPDSTESTNS:%";
const NS_TITLE_PREFIX = "fpds test fixture";
let unique = 0;
const stamp = () => `${Date.now().toString(36)}-${(unique++).toString(36)}`;
const nsKey = () => ({ source: NS_SOURCE, opportunityId: `test-${stamp()}` });

afterAll(async () => {
  if (!HAS_DB) return;
  try {
    await dbFactory()`DELETE FROM fpds_lookups WHERE lookup_key LIKE ${NS_KEY_LIKE}`;
    await dbFactory()`DELETE FROM fpds_lookups WHERE lookup_key LIKE ${`fpds:v2:t:${NS_TITLE_PREFIX}%`}`;
  } catch (err) {
    console.error("[fpds.test] cleanup failed:", err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe("cache keys (owner 09-16 #3) — stable ids preferred, titles normalized", () => {
  test("title differences that are pure case/whitespace/punctuation reuse ONE key", () => {
    const base = { naicsCode: "561720", agency: "GSA", title: "Janitorial Services, Bldg 5" };
    const variants = [
      "Janitorial Services, Bldg 5",
      "  janitorial   SERVICES  bldg 5 ",
      "JANITORIAL SERVICES BLDG 5",
      "Janitorial Services (Bldg 5)",
      "Janitorial Services — Bldg 5.",
    ];
    const keys = variants.map((t) => fpdsLookupKey({ ...base, title: t }));
    for (const k of keys) expect(k).toBe(keys[0]);
    expect(keys[0].startsWith("fpds:v2:t:")).toBe(true);
    // Agency differences are also normalized the same way.
    expect(fpdsLookupKey({ ...base, agency: "GSA ", title: variants[1] })).toBe(keys[0]);
    expect(fpdsLookupKey({ ...base, agency: " gsa", title: variants[2] })).toBe(keys[0]);
  });

  test("DISTINCT opportunities never collide on the fallback key", () => {
    const a = fpdsLookupKey({ naicsCode: "561720", agency: "GSA", title: "Janitorial Services" });
    const b = fpdsLookupKey({ naicsCode: "561720", agency: "GSA", title: "Janitorial Services and Grounds" });
    const c = fpdsLookupKey({ naicsCode: "561740", agency: "GSA", title: "Janitorial Services" });
    const d = fpdsLookupKey({ naicsCode: "561720", agency: "VA", title: "Janitorial Services" });
    expect(new Set([a, b, c, d]).size).toBe(4);
    // "Services" vs " SERVICES " (the owner's example) still reuse ONE row…
    expect(fpdsLookupKey({ title: "Grounds Services", agency: "GSA" })).toBe(
      fpdsLookupKey({ title: " GROUNDS  SERVICES ", agency: "gsa" }),
    );
    // …while a genuinely different title does not.
    expect(fpdsLookupKey({ title: "Grounds Services", agency: "GSA" })).not.toBe(
      fpdsLookupKey({ title: "Grounds Service and Snow Removal", agency: "GSA" }),
    );
  });

  test("a STABLE identifier wins over the title and is separator/case insensitive", () => {
    const byAward = fpdsLookupKey({ awardId: "W91247-23-R-0042", title: "Totally different title A" });
    expect(byAward).toBe(fpdsLookupKey({ awardId: "w9124723r0042", title: "Totally different title B" }));
    expect(byAward.startsWith("fpds:v2:aw:")).toBe(true);
    const bySol = fpdsLookupKey({ solicitation: "36C10X24-R-0018", title: "t1" });
    expect(bySol).toBe(fpdsLookupKey({ solicitation: " 36c10x24 r 0018 ", title: "t2" }));
    expect(bySol.startsWith("fpds:v2:sol:")).toBe(true);
    // priority: award > solicitation > source:opportunityId > title fallback
    const all = fpdsLookupKey({
      awardId: "AW1", solicitation: "SOL1", source: "sam_gov", opportunityId: "OP1",
      title: "T", agency: "A", naicsCode: "1",
    });
    expect(all).toBe(fpdsLookupKey({ awardId: "AW1", title: "anything else" }));
    expect(fpdsLookupKey({ solicitation: "SOL1", title: "x" })).toBe(fpdsLookupKey({ solicitation: "SOL1", source: "s", opportunityId: "o", title: "y" }));
    expect(fpdsLookupKey({ source: "s", opportunityId: "o", title: "z" })).toBe(fpdsLookupKey({ source: "s", opportunityId: "o", title: "different" }));
  });

  test("per-source opportunity ids: same title + different opportunity ⇒ different rows", () => {
    const k1 = fpdsLookupKey({ source: "wv", opportunityId: "wv-aaaa", title: "Standby Generator" });
    const k2 = fpdsLookupKey({ source: "wv", opportunityId: "wv-bbbb", title: "Standby Generator" });
    const k3 = fpdsLookupKey({ source: "sam_gov", opportunityId: "wv-aaaa", title: "Standby Generator" });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3); // the source is part of the stable identity
    expect(k1).toBe(fpdsLookupKey({ source: "WV", opportunityId: "wv_aaaa", title: "irrelevant" }));
  });

  test("normalizers are the documented pure rules", () => {
    expect(normalizeFpdsKeyText("  Janitorial  SERVICES, Bldg. 5 ")).toBe("janitorial services bldg 5");
    expect(normalizeFpdsKeyId("w91247-23-r-0042")).toBe("W9124723R0042");
    expect(normalizeFpdsKeyId(" wv-16198dee ")).toBe("WV16198DEE");
    // keys are versioned so a future rule change can never read old rows
    expect(fpdsLookupKey({ title: "x" }).startsWith("fpds:v2:")).toBe(true);
  });

  test("TTLs are the documented ones (positive 30 days, negative 12 h)", () => {
    expect(FPDS_POSITIVE_TTL_DAYS).toBe(30);
    expect(FPDS_NEGATIVE_TTL_HOURS).toBe(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("negative-result caching (owner 09-16 #2) — repeat scans stop re-hitting upstream", () => {
  test("a NO-incumbent answer is cached and the second lookup performs ZERO upstream calls", async () => {
    if (!HAS_DB) return;
    const key = nsKey();
    const title = `FPDS TEST FIXTURE no-incumbent ${stamp()}`;
    const args = ["561720", "GSA", title] as const;
    const restore = installFetch(() => searchOk([]));
    calls = [];
    try {
      const first = await lookupFPDSIntel(args[0], args[1], args[2], { key, totalTimeoutMs: 5000 });
      expect(first.status).toBe("none"); // upstream answered: no incumbent
      expect(calls.length).toBe(1); // search only — no historical call for a negative
      expect(calls.every((c) => c.hadSignal)).toBe(true); // every fetch is bounded
      const upstreamCallsAfterFirst = calls.length;

      const second = await lookupFPDSIntel(args[0], args[1], args[2], { key, totalTimeoutMs: 5000 });
      expect(second.status).toBe("none");
      expect(calls.length).toBe(upstreamCallsAfterFirst); // ← served from the negative cache
    } finally {
      restore();
    }
  });

  test("the negative cache EXPIRES after FPDS_NEGATIVE_TTL_HOURS (then re-checks upstream)", async () => {
    if (!HAS_DB) return;
    const key = nsKey();
    const title = `FPDS TEST FIXTURE ttl ${stamp()}`;
    const args = ["561720", "GSA", title] as const;
    const restore = installFetch(() => searchOk([]));
    calls = [];
    try {
      expect((await lookupFPDSIntel(args[0], args[1], args[2], { key, totalTimeoutMs: 5000 })).status).toBe("none");
      const afterFirst = calls.length;
      // Age the row PAST the negative TTL → must be treated as a MISS.
      const aged = await dbFactory()`
        UPDATE fpds_lookups SET fetched_at = NOW() - ${`${FPDS_NEGATIVE_TTL_HOURS + 1} hours`}::interval
        WHERE lookup_key = ${fpdsLookupKey({ ...key, naicsCode: args[0], agency: args[1], title: args[2] })}`;
      expect(aged).toBeDefined();
      expect((await lookupFPDSIntel(args[0], args[1], args[2], { key, totalTimeoutMs: 5000 })).status).toBe("none");
      expect(calls.length).toBeGreaterThan(afterFirst); // expired ⇒ upstream consulted again
      // …and a still-FRESH negative row is reused (3rd call = no new upstream call).
      const afterRefresh = calls.length;
      expect((await lookupFPDSIntel(args[0], args[1], args[2], { key, totalTimeoutMs: 5000 })).status).toBe("none");
      expect(calls.length).toBe(afterRefresh);
    } finally {
      restore();
    }
  });

  test("negative rows are per-opportunity: a DIFFERENT opportunity with the same title is not served by it", async () => {
    if (!HAS_DB) return;
    const sharedTitle = `FPDS TEST FIXTURE shared title ${stamp()}`;
    const keyA = nsKey();
    const keyB = nsKey();
    const restore = installFetch(() => searchOk([]));
    calls = [];
    try {
      expect((await lookupFPDSIntel("561720", "GSA", sharedTitle, { key: keyA, totalTimeoutMs: 5000 })).status).toBe("none");
      const afterA = calls.length;
      expect((await lookupFPDSIntel("561720", "GSA", sharedTitle, { key: keyB, totalTimeoutMs: 5000 })).status).toBe("none");
      // different stable id ⇒ a different cache row ⇒ its own (one) upstream call
      expect(calls.length).toBe(afterA + 1);
    } finally {
      restore();
    }
  });

  test("a POSITIVE result is cached for FPDS_POSITIVE_TTL_DAYS and reused (0 upstream calls on repeat)", async () => {
    if (!HAS_DB) return;
    const key = nsKey();
    const title = `FPDS TEST FIXTURE incumbent ${stamp()}`;
    const restore = installFetch(() => searchOk([AWARD_ROW]));
    calls = [];
    try {
      const first = await lookupFPDSIntel("561720", "GSA", title, { key, totalTimeoutMs: 9000 });
      expect(first.status).toBe("ok");
      expect(first.status === "ok" && first.intel.incumbent_name).toBe("ACME CLEANING LLC");
      expect(first.status === "ok" && first.intel.total_obligated).toBe(1_250_000);
      const upstreamAfterFirst = calls.length;
      const second = await lookupFPDSIntel("561720", "GSA", title, { key, totalTimeoutMs: 9000 });
      expect(second.status).toBe("ok");
      expect(second.status === "ok" && second.intel.incumbent_uei).toBe("ABC123DEF456");
      expect(calls.length).toBe(upstreamAfterFirst);
      // the cached row is a POSITIVE row (not mistaken for a negative)
      const rows: any[] = await dbFactory()`SELECT incumbent_name FROM fpds_lookups WHERE lookup_key = ${fpdsLookupKey({ ...key, naicsCode: "561720", agency: "GSA", title })}`;
      expect(rows[0]?.incumbent_name).toBe("ACME CLEANING LLC");
    } finally {
      restore();
    }
  });

  test("an UPSTREAM FAILURE is never cached as 'no incumbent' (honest unavailable, no poisoning)", async () => {
    if (!HAS_DB) return;
    const key = nsKey();
    const title = `FPDS TEST FIXTURE failure ${stamp()}`;
    const keyOf = (t: string) => fpdsLookupKey({ ...key, naicsCode: "561720", agency: "GSA", title: t });
    const restore = installFetch(() => ({ status: 500, body: { error: "boom" } }));
    try {
      const res = await lookupFPDSIntel("561720", "GSA", title, { key, totalTimeoutMs: 4000 });
      expect(res.status).toBe("unavailable");
      const rows: any[] = await dbFactory()`SELECT lookup_key FROM fpds_lookups WHERE lookup_key = ${keyOf(title)}`;
      expect(rows.length).toBe(0); // NOTHING cached — a 500 must not become a 12 h "no incumbent"
    } finally {
      restore();
    }
    // …and once the upstream answers honestly, the negative IS cached.
    const restore2 = installFetch(() => searchOk([]));
    calls = [];
    try {
      expect((await lookupFPDSIntel("561720", "GSA", title, { key, totalTimeoutMs: 4000 })).status).toBe("none");
      const rows: any[] = await dbFactory()`SELECT incumbent_name FROM fpds_lookups WHERE lookup_key = ${keyOf(title)}`;
      expect(rows.length).toBe(1);
      expect(rows[0].incumbent_name).toBeNull();
    } finally {
      restore2();
    }
    // the "no answer" case leaves the previous answer intact
    expect(FPDS_NEGATIVE_TTL_HOURS).toBeLessThan(FPDS_POSITIVE_TTL_DAYS * 24);
  });

  test("a HUNG upstream returns unavailable inside the budget (never hangs the request)", async () => {
    if (!HAS_DB) return;
    const key = nsKey();
    const title = `FPDS TEST FIXTURE hang ${stamp()}`;
    const restore = installFetch(() => ({ hang: true }));
    calls = [];
    const started = Date.now();
    try {
      const res = await lookupFPDSIntel("561720", "GSA", title, { key, totalTimeoutMs: 2500 });
      const elapsed = Date.now() - started;
      expect(res.status).toBe("unavailable");
      expect(elapsed).toBeLessThan(3600); // bounded, not "waits for the platform"
      expect(calls.length).toBe(1); // the hung fetch WAS attempted…
      expect(calls[0].hadSignal).toBe(true); // …with an AbortSignal attached
    } finally {
      restore();
    }
    const rows: any[] = await dbFactory()`SELECT lookup_key FROM fpds_lookups WHERE lookup_key = ${fpdsLookupKey({ ...key, naicsCode: "561720", agency: "GSA", title })}`;
    expect(rows.length).toBe(0); // a timeout is not a negative result
  });
});
