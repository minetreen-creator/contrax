/**
 * ANONYMOUS RADAR FREE-SEARCH LIMIT — DUAL DIMENSION (owner directive 2026-10-08).
 *
 * DETERMINISTIC, NETWORK-FREE and DATABASE-FREE: every case drives the REAL
 * gate/consume functions from ~/lib/radar-free-search-limit.server against an
 * in-memory store, exactly the way radar.tsx wires them (pre-check before the
 * scan, one consumed search per SUCCESSFUL scan). No DATABASE_URL, no clock, no
 * mock.module (bun's mock registry is process-global and leaks across files in
 * one run).
 *
 * The regression this file locks down: the anonymous Radar allowance used to be
 * keyed by whichever identity came first — the client IP, FALLING BACK to the
 * visitor cookie — so switching VPN servers handed out a fresh quota. It is now
 * counted by network address AND browser id, and whichever runs out first
 * blocks. The allowance itself is unchanged (2 searches, ≤3 matches each).
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FREE_ANONYMOUS_RADAR_RESULTS, FREE_RADAR_PREVIEW_SCANS } from "./radar-config";
import {
  FREE_RADAR_SEARCH_LIMIT,
  RADAR_SEARCH_HASH_PREFIX,
  RADAR_SEARCH_IP_PREFIX,
  RADAR_SEARCH_VISITOR_PREFIX,
  checkAnonymousRadarSearch,
  consumeAnonymousRadarSearch,
  evaluateRadarSearchGate,
  neonRadarSearchStore,
  radarSearchKeyHash,
  radarSearchKeys,
  type RadarSearchStore,
} from "./radar-free-search-limit.server";

/** In-memory stand-in for the Neon `radar_preview_usage` table. */
function memoryStore(initial: Record<string, number> = {}): RadarSearchStore {
  const rows = new Map<string, number>(Object.entries(initial));
  return {
    async getUsed(key) {
      return rows.get(key) ?? 0;
    },
    async increment(key) {
      rows.set(key, (rows.get(key) ?? 0) + 1);
    },
  };
}

const IP_A = "203.0.113.9"; // TEST-NET-3 (documentation range)
const IP_B = "198.51.100.7"; // TEST-NET-2
const BROWSER_1 = "11111111-2222-4333-8444-555555555555";
const BROWSER_2 = "99999999-8888-4777-8666-555555555555";

/**
 * EXACT mirror of radar.tsx's anonymous path: gate BEFORE the scan, then spend
 * one search in both dimensions ONLY when the scan completed successfully.
 * `fails: true` models a scan that errored/failed (never consumes).
 */
async function attemptRadarScan(
  store: RadarSearchStore,
  ip: string | null,
  visitorId: string | null,
  opts: { fails?: boolean } = {},
): Promise<"scanned" | "blocked" | "failed"> {
  const gate = await checkAnonymousRadarSearch(ip, visitorId, store);
  if (!gate.allowed) return "blocked";
  if (opts.fails) return "failed"; // no consumption on the failure path
  await consumeAnonymousRadarSearch(ip, visitorId, store);
  return "scanned";
}

async function attemptTimes(
  store: RadarSearchStore,
  ip: string | null,
  visitorId: string | null,
  times: number,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(await attemptRadarScan(store, ip, visitorId));
  return out;
}

describe("allowance is unchanged", () => {
  test("2 free searches, 3 matches each (the owner's offer)", () => {
    expect(FREE_RADAR_SEARCH_LIMIT).toBe(2);
    expect(FREE_RADAR_SEARCH_LIMIT).toBe(FREE_RADAR_PREVIEW_SCANS);
    expect(FREE_ANONYMOUS_RADAR_RESULTS).toBe(3);
  });
});

describe("dual-dimension counter keys", () => {
  test("both dimensions produce one prefixed key each, in a stable order", () => {
    expect(radarSearchKeys(IP_A, BROWSER_1)).toEqual([
      `${RADAR_SEARCH_IP_PREFIX}${IP_A}`,
      `${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`,
    ]);
  });

  test("a missing dimension is skipped, never faked", () => {
    expect(radarSearchKeys(IP_A, null)).toEqual([`${RADAR_SEARCH_IP_PREFIX}${IP_A}`]);
    expect(radarSearchKeys(null, BROWSER_1)).toEqual([
      `${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`,
    ]);
    expect(radarSearchKeys("", "")).toEqual([]);
    expect(radarSearchKeys(undefined, undefined)).toEqual([]);
    expect(radarSearchKeys("   ", "  ")).toEqual([]);
  });

  test("a malformed visitor id is dropped (that dimension only), never denied", () => {
    expect(radarSearchKeys(IP_A, "short")).toEqual([`${RADAR_SEARCH_IP_PREFIX}${IP_A}`]);
    expect(radarSearchKeys(IP_A, "has space")).toEqual([`${RADAR_SEARCH_IP_PREFIX}${IP_A}`]);
    expect(radarSearchKeys(IP_A, "<script>")).toEqual([`${RADAR_SEARCH_IP_PREFIX}${IP_A}`]);
  });

  test("at most one key per dimension — never a duplicate", () => {
    const keys = radarSearchKeys(IP_A, BROWSER_1);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  test("the stored hash keeps the legacy namespace — an address already counted still counts", () => {
    // Pre-2026-10-08 radar.tsx wrote sha256("radar-preview-v1:" + "ip:" + ip).
    // The address dimension must hash to that SAME row, so a visitor who had
    // already used a scan does not get a reset (strictly no extra free search).
    const legacy = createHash("sha256")
      .update("radar-preview-v1:" + "ip:" + IP_A)
      .digest("hex");
    expect(radarSearchKeyHash(`${RADAR_SEARCH_IP_PREFIX}${IP_A}`)).toBe(legacy);
    expect(RADAR_SEARCH_HASH_PREFIX).toBe("radar-preview-v1:");
  });
});

describe("(a) same address + same browser: 2 allowed, 3rd blocked", () => {
  test(`${FREE_RADAR_SEARCH_LIMIT} free searches, then the block`, async () => {
    const store = memoryStore();
    expect(await attemptTimes(store, IP_A, BROWSER_1, FREE_RADAR_SEARCH_LIMIT)).toEqual(
      Array.from({ length: FREE_RADAR_SEARCH_LIMIT }, () => "scanned"),
    );
    expect(await attemptRadarScan(store, IP_A, BROWSER_1)).toBe("blocked");
    // Both dimensions moved together — this is the unchanged normal visitor.
    expect(await store.getUsed(`${RADAR_SEARCH_IP_PREFIX}${IP_A}`)).toBe(FREE_RADAR_SEARCH_LIMIT);
    expect(await store.getUsed(`${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`)).toBe(
      FREE_RADAR_SEARCH_LIMIT,
    );
  });

  test("the block is the unchanged paidRequired sentinel shape (not a new error)", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_RADAR_SEARCH_LIMIT);
    const gate = await checkAnonymousRadarSearch(IP_A, BROWSER_1, store);
    expect(gate).toEqual({
      allowed: false,
      used: FREE_RADAR_SEARCH_LIMIT,
      limit: FREE_RADAR_SEARCH_LIMIT,
    });
  });

  test("'X of 2' is knowable before the block (used counts the advanced dimension)", async () => {
    const store = memoryStore();
    expect(await checkAnonymousRadarSearch(IP_A, BROWSER_1, store)).toEqual({
      allowed: true,
      used: 0,
      limit: FREE_RADAR_SEARCH_LIMIT,
    });
    await attemptRadarScan(store, IP_A, BROWSER_1);
    expect((await checkAnonymousRadarSearch(IP_A, BROWSER_1, store)).used).toBe(1);
  });
});

describe("(b) VPN switch — NEW address, SAME browser id (the regression)", () => {
  test("a fresh address does NOT reset the browser counter", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_RADAR_SEARCH_LIMIT);
    expect(await store.getUsed(`${RADAR_SEARCH_IP_PREFIX}${IP_B}`)).toBe(0);
    expect(await attemptRadarScan(store, IP_B, BROWSER_1)).toBe("blocked");
  });

  test("and the browser keeps the block across many addresses", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_RADAR_SEARCH_LIMIT);
    for (const ip of ["203.0.113.11", "203.0.113.12", "203.0.113.13", IP_B]) {
      expect(await attemptRadarScan(store, ip, BROWSER_1)).toBe("blocked");
    }
  });

  test("a visitor with searches left still scans from a new address", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, 1); // 1 of 2 used
    expect(await attemptRadarScan(store, IP_B, BROWSER_1)).toBe("scanned");
  });
});

describe("(c) fresh browser — NEW visitor id, SAME address", () => {
  test("clearing the cookie does NOT reset the address counter", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_RADAR_SEARCH_LIMIT);
    expect(await store.getUsed(`${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_2}`)).toBe(0);
    expect(await attemptRadarScan(store, IP_A, BROWSER_2)).toBe("blocked");
  });

  test("a cookie-less visitor is bounded by the address alone", async () => {
    const store = memoryStore();
    expect(await attemptTimes(store, IP_A, null, FREE_RADAR_SEARCH_LIMIT)).toEqual(
      Array.from({ length: FREE_RADAR_SEARCH_LIMIT }, () => "scanned"),
    );
    expect(await attemptRadarScan(store, IP_A, null)).toBe("blocked");
  });
});

describe("(d) a missing dimension never denies", () => {
  test("no ip, browser only → browser dimension still enforced", async () => {
    const store = memoryStore();
    expect(await attemptTimes(store, null, BROWSER_1, FREE_RADAR_SEARCH_LIMIT)).toEqual(
      Array.from({ length: FREE_RADAR_SEARCH_LIMIT }, () => "scanned"),
    );
    expect(await attemptRadarScan(store, null, BROWSER_1)).toBe("blocked");
  });

  test("no browser, ip only → address dimension still enforced", async () => {
    const store = memoryStore();
    expect(await attemptTimes(store, IP_A, "", FREE_RADAR_SEARCH_LIMIT)).toEqual(
      Array.from({ length: FREE_RADAR_SEARCH_LIMIT }, () => "scanned"),
    );
    expect(await attemptRadarScan(store, IP_A, undefined)).toBe("blocked");
  });

  test("neither dimension → allowed, and never denied (fail-open identity)", async () => {
    const store = memoryStore();
    expect(await attemptRadarScan(store, null, null)).toBe("scanned");
    expect(await attemptTimes(store, "", "", 10)).toEqual(
      Array.from({ length: 10 }, () => "scanned"),
    );
    expect(await checkAnonymousRadarSearch(null, null, store)).toEqual({
      allowed: true,
      used: 0,
      limit: FREE_RADAR_SEARCH_LIMIT,
    });
  });

  test("the missing dimension is NOT written on consume (no phantom counter)", async () => {
    const store = memoryStore();
    await attemptRadarScan(store, null, BROWSER_1);
    expect(await store.getUsed(`${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`)).toBe(1);
    expect(radarSearchKeys(null, BROWSER_1)).toEqual([
      `${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`,
    ]);
  });

  test("the strictest dimension wins when they disagree", async () => {
    const store = memoryStore({
      [`${RADAR_SEARCH_IP_PREFIX}${IP_A}`]: FREE_RADAR_SEARCH_LIMIT, // exhausted address
      [`${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_2}`]: 1, // fresh browser
    });
    const gate = await checkAnonymousRadarSearch(IP_A, BROWSER_2, store);
    expect(gate.allowed).toBe(false);
    expect(gate.used).toBe(FREE_RADAR_SEARCH_LIMIT);
  });
});

describe("(e) DB errors fail OPEN — never deny on an inability to count", () => {
  const throwingStore: RadarSearchStore = {
    async getUsed() {
      throw new Error("connection terminated unexpectedly");
    },
    async increment() {
      throw new Error("connection terminated unexpectedly");
    },
  };

  test("a store that rejects on read still allows scanning", async () => {
    const gate = await checkAnonymousRadarSearch(IP_A, BROWSER_1, throwingStore);
    expect(gate).toEqual({ allowed: true, used: 0, limit: FREE_RADAR_SEARCH_LIMIT });
    expect(await attemptTimes(throwingStore, IP_A, BROWSER_1, FREE_RADAR_SEARCH_LIMIT + 5)).toEqual(
      Array.from({ length: FREE_RADAR_SEARCH_LIMIT + 5 }, () => "scanned"),
    );
  });

  test("a store that rejects on write does not throw at the caller", async () => {
    await expect(
      consumeAnonymousRadarSearch(IP_A, BROWSER_1, throwingStore),
    ).resolves.toBeUndefined();
  });

  test("junk counts (NaN / negative) read as 0, never as a block", async () => {
    const junkStore: RadarSearchStore = {
      async getUsed() {
        return Number.NaN;
      },
      async increment() {},
    };
    expect(await evaluateRadarSearchGate(radarSearchKeys(IP_A, BROWSER_1), junkStore)).toEqual({
      allowed: true,
      used: 0,
      limit: FREE_RADAR_SEARCH_LIMIT,
    });
    const negative: RadarSearchStore = {
      async getUsed() {
        return -5;
      },
      async increment() {},
    };
    expect((await evaluateRadarSearchGate(radarSearchKeys(IP_A, null), negative)).allowed).toBe(
      true,
    );
  });

  test("one failing key does not skip the other dimension on consume", async () => {
    const seen: string[] = [];
    const halfBroken: RadarSearchStore = {
      async getUsed() {
        return 0;
      },
      async increment(key) {
        seen.push(key);
        if (key.startsWith(RADAR_SEARCH_IP_PREFIX)) throw new Error("boom");
      },
    };
    await consumeAnonymousRadarSearch(IP_A, BROWSER_1, halfBroken);
    expect(seen).toEqual([
      `${RADAR_SEARCH_IP_PREFIX}${IP_A}`,
      `${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`,
    ]);
  });

  test("the REAL Neon store fails open when there is no database to read", async () => {
    // In CI (no DATABASE_URL) sql() throws → the store must swallow it and the
    // gate must allow. Where a DATABASE_URL IS present (the team's sandbox) this
    // case is skipped on purpose: these tests must never touch a live database.
    if (process.env.DATABASE_URL) {
      console.log("SKIP: DATABASE_URL present — not exercising the real store");
      return;
    }
    expect(await neonRadarSearchStore.getUsed(`${RADAR_SEARCH_IP_PREFIX}${IP_A}`)).toBe(0);
    expect(
      await neonRadarSearchStore.increment(`${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`),
    ).toBe(undefined);
    expect((await checkAnonymousRadarSearch(IP_A, BROWSER_1)).allowed).toBe(true);
  });
});

describe("(f) a failed scan never consumes a free search", () => {
  test("a scan that fails leaves both counters untouched", async () => {
    const store = memoryStore();
    expect(await attemptRadarScan(store, IP_A, BROWSER_1, { fails: true })).toBe("failed");
    expect(await store.getUsed(`${RADAR_SEARCH_IP_PREFIX}${IP_A}`)).toBe(0);
    expect(await store.getUsed(`${RADAR_SEARCH_VISITOR_PREFIX}${BROWSER_1}`)).toBe(0);
    // The visitor still has their full allowance.
    expect(await attemptTimes(store, IP_A, BROWSER_1, FREE_RADAR_SEARCH_LIMIT)).toEqual(
      Array.from({ length: FREE_RADAR_SEARCH_LIMIT }, () => "scanned"),
    );
  });

  test("a fail-after-fail visitor is never blocked by failures alone", async () => {
    const store = memoryStore();
    for (let i = 0; i < 6; i++) {
      expect(await attemptRadarScan(store, IP_A, BROWSER_1, { fails: true })).toBe("failed");
    }
    expect((await checkAnonymousRadarSearch(IP_A, BROWSER_1, store)).allowed).toBe(true);
  });

  test("only the COMPLETED scans are counted (2 ok + a failure in between → blocked at 2)", async () => {
    const store = memoryStore();
    expect(await attemptRadarScan(store, IP_A, BROWSER_1)).toBe("scanned");
    expect(await attemptRadarScan(store, IP_A, BROWSER_1, { fails: true })).toBe("failed");
    expect(await attemptRadarScan(store, IP_A, BROWSER_1)).toBe("scanned");
    // Two COMPLETED scans is the whole allowance → the next attempt is blocked,
    // whether or not it would have failed.
    expect(await attemptRadarScan(store, IP_A, BROWSER_1, { fails: true })).toBe("blocked");
    expect(await attemptRadarScan(store, IP_A, BROWSER_1)).toBe("blocked");
    expect(await store.getUsed(`${RADAR_SEARCH_IP_PREFIX}${IP_A}`)).toBe(2);
  });
});
