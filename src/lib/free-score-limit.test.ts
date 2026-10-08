/**
 * ANONYMOUS FREE-SCORE LIMIT — DUAL DIMENSION (owner directive 2026-10-06).
 *
 * DETERMINISTIC, NETWORK-FREE and DATABASE-FREE: every case drives the REAL
 * gate/consume functions from ~/lib/free-score-limit.server against an
 * in-memory store, exactly the way score.tsx wires them (pre-check, then
 * consume on the success path). No DATABASE_URL, no clock, no mock.module
 * (bun's mock registry is process-global and leaks across files in one run).
 *
 * The regression this file locks down: the anonymous allowance used to be
 * keyed by the client IP ALONE, so switching VPN servers handed out a fresh
 * quota. It is now counted by network address AND browser id, and either one
 * running out blocks.
 */
import { describe, expect, test } from "bun:test";
import {
  FREE_SCORE_IP_PREFIX,
  FREE_SCORE_LIMIT,
  FREE_SCORE_VISITOR_PREFIX,
  checkAnonymousFreeScore,
  consumeAnonymousFreeScore,
  evaluateFreeScoreGate,
  freeScoreKeys,
  neonFreeScoreStore,
  visitorIdFromCookieHeader,
  type FreeScoreCreditStore,
} from "./free-score-limit.server";

/** In-memory stand-in for the Neon `score_credits` table. */
function memoryStore(initial: Record<string, number> = {}): FreeScoreCreditStore {
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
 * EXACT mirror of score.tsx's anonymous path: check both dimensions before the
 * (expensive) analysis, then consume one credit in both dimensions only when it
 * succeeded. Returns what the visitor sees.
 */
async function attemptAnonymousScore(
  store: FreeScoreCreditStore,
  ip: string | null,
  visitorId: string | null,
): Promise<"scored" | "blocked"> {
  const gate = await checkAnonymousFreeScore(ip, visitorId, store);
  if (!gate.allowed) return "blocked";
  await consumeAnonymousFreeScore(ip, visitorId, store);
  return "scored";
}

async function attemptTimes(
  store: FreeScoreCreditStore,
  ip: string | null,
  visitorId: string | null,
  times: number,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(await attemptAnonymousScore(store, ip, visitorId));
  return out;
}

describe("dual-dimension credit keys", () => {
  test("both dimensions produce one prefixed key each, in a stable order", () => {
    expect(freeScoreKeys(IP_A, BROWSER_1)).toEqual([
      `${FREE_SCORE_IP_PREFIX}${IP_A}`,
      `${FREE_SCORE_VISITOR_PREFIX}${BROWSER_1}`,
    ]);
  });

  test("a missing dimension is skipped, never faked", () => {
    expect(freeScoreKeys(IP_A, null)).toEqual([`${FREE_SCORE_IP_PREFIX}${IP_A}`]);
    expect(freeScoreKeys(null, BROWSER_1)).toEqual([
      `${FREE_SCORE_VISITOR_PREFIX}${BROWSER_1}`,
    ]);
    expect(freeScoreKeys("", "")).toEqual([]);
    expect(freeScoreKeys(undefined, undefined)).toEqual([]);
    expect(freeScoreKeys("   ", "  ")).toEqual([]);
  });

  test("keys are deduped and bounded (TEXT column, short keys)", () => {
    expect(freeScoreKeys(IP_A, IP_A)).toHaveLength(2); // distinct dimensions
    const long = "a".repeat(400);
    for (const key of freeScoreKeys("9".repeat(400), long)) {
      expect(key.length).toBeLessThanOrEqual(256);
    }
  });
});

describe("visitor id read from the first-party cookie", () => {
  test("reads contrax_vid out of a multi-cookie header (and decodes it)", () => {
    expect(visitorIdFromCookieHeader(`a=1; contrax_vid=${BROWSER_1}; b=2`)).toBe(BROWSER_1);
    // Percent-encoded values are decoded the same way radar.tsx reads them.
    expect(visitorIdFromCookieHeader(`contrax_vid=${encodeURIComponent("abc-123-xyz")}`)).toBe(
      "abc-123-xyz",
    );
  });

  test("absent / empty / malformed → \"\" (that dimension is simply dropped)", () => {
    expect(visitorIdFromCookieHeader("")).toBe("");
    expect(visitorIdFromCookieHeader(null)).toBe("");
    expect(visitorIdFromCookieHeader("contrax_session=abc")).toBe("");
    expect(visitorIdFromCookieHeader("contrax_vid=")).toBe("");
    expect(visitorIdFromCookieHeader("contrax_vid=short")).toBe(""); // < 8 chars
    expect(visitorIdFromCookieHeader("contrax_vid=has space")).toBe("");
    expect(visitorIdFromCookieHeader("contrax_vid=<script>")).toBe("");
  });
});

describe("(a) same IP + same browser: N allowed, N+1 blocked", () => {
  test(`${FREE_SCORE_LIMIT} free analyses, then the block`, async () => {
    const store = memoryStore();
    expect(await attemptTimes(store, IP_A, BROWSER_1, FREE_SCORE_LIMIT)).toEqual(
      Array.from({ length: FREE_SCORE_LIMIT }, () => "scored"),
    );
    expect(await attemptAnonymousScore(store, IP_A, BROWSER_1)).toBe("blocked");
    // Both dimensions moved together — this is the unchanged normal visitor.
    expect(await store.getUsed(`${FREE_SCORE_IP_PREFIX}${IP_A}`)).toBe(FREE_SCORE_LIMIT);
    expect(await store.getUsed(`${FREE_SCORE_VISITOR_PREFIX}${BROWSER_1}`)).toBe(
      FREE_SCORE_LIMIT,
    );
  });

  test("the block is the unchanged FREE_LIMIT_REACHED sentinel path (not a new error)", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_SCORE_LIMIT);
    const gate = await checkAnonymousFreeScore(IP_A, BROWSER_1, store);
    expect(gate).toEqual({ allowed: false, used: FREE_SCORE_LIMIT, limit: FREE_SCORE_LIMIT });
  });
});

describe("(b) VPN switch — NEW IP, SAME browser id (the regression)", () => {
  test("a fresh address does NOT reset the browser counter", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_SCORE_LIMIT);
    // Same browser, brand-new VPN address, address counter at 0.
    expect(await store.getUsed(`${FREE_SCORE_IP_PREFIX}${IP_B}`)).toBe(0);
    expect(await attemptAnonymousScore(store, IP_B, BROWSER_1)).toBe("blocked");
  });

  test("and the browser keeps the block across many addresses", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_SCORE_LIMIT);
    for (const ip of ["203.0.113.11", "203.0.113.12", "203.0.113.13", IP_B]) {
      expect(await attemptAnonymousScore(store, ip, BROWSER_1)).toBe("blocked");
    }
  });

  test("a visitor with remaining browser credit still scores from a new address", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, 1); // 1 of 3 used
    expect(await attemptAnonymousScore(store, IP_B, BROWSER_1)).toBe("scored");
  });
});

describe("(c) fresh browser — NEW visitor id, SAME address", () => {
  test("clearing the cookie does NOT reset the address counter", async () => {
    const store = memoryStore();
    await attemptTimes(store, IP_A, BROWSER_1, FREE_SCORE_LIMIT);
    expect(await store.getUsed(`${FREE_SCORE_VISITOR_PREFIX}${BROWSER_2}`)).toBe(0);
    expect(await attemptAnonymousScore(store, IP_A, BROWSER_2)).toBe("blocked");
  });

  test("a cookie-less visitor is bounded by the address alone", async () => {
    const store = memoryStore();
    // No cookie at all (blocked/cleared): only the ip:<ip> dimension exists.
    expect(await attemptTimes(store, IP_A, null, FREE_SCORE_LIMIT)).toEqual(
      Array.from({ length: FREE_SCORE_LIMIT }, () => "scored"),
    );
    expect(await attemptAnonymousScore(store, IP_A, null)).toBe("blocked");
  });
});

describe("(d) a missing dimension never denies", () => {
  test("no ip, browser only → browser dimension still enforced", async () => {
    const store = memoryStore();
    expect(await attemptTimes(store, null, BROWSER_1, FREE_SCORE_LIMIT)).toEqual(
      Array.from({ length: FREE_SCORE_LIMIT }, () => "scored"),
    );
    expect(await attemptAnonymousScore(store, null, BROWSER_1)).toBe("blocked");
  });

  test("no browser, ip only → address dimension still enforced", async () => {
    const store = memoryStore();
    expect(await attemptTimes(store, IP_A, "", FREE_SCORE_LIMIT)).toEqual(
      Array.from({ length: FREE_SCORE_LIMIT }, () => "scored"),
    );
    expect(await attemptAnonymousScore(store, IP_A, undefined)).toBe("blocked");
  });

  test("neither dimension → allowed, and never denied", async () => {
    const store = memoryStore();
    expect(await attemptAnonymousScore(store, null, null)).toBe("scored");
    expect(await attemptTimes(store, "", "", 10)).toEqual(
      Array.from({ length: 10 }, () => "scored"),
    );
    expect(await checkAnonymousFreeScore(null, null, store)).toEqual({
      allowed: true,
      used: 0,
      limit: FREE_SCORE_LIMIT,
    });
  });

  test("the missing dimension is NOT written on consume (no phantom counter)", async () => {
    const store = memoryStore();
    await attemptAnonymousScore(store, null, BROWSER_1);
    expect(await store.getUsed(`${FREE_SCORE_VISITOR_PREFIX}${BROWSER_1}`)).toBe(1);
    // No `ip:` key was minted for the absent address (only the two dimensions
    // above are ever written), so a later visit from a real address starts
    // from that address's own count.
    expect(freeScoreKeys(null, BROWSER_1)).toEqual([
      `${FREE_SCORE_VISITOR_PREFIX}${BROWSER_1}`,
    ]);
  });

  test("the strictest dimension wins when they disagree", async () => {
    const store = memoryStore({
      [`${FREE_SCORE_IP_PREFIX}${IP_A}`]: FREE_SCORE_LIMIT, // exhausted address
      [`${FREE_SCORE_VISITOR_PREFIX}${BROWSER_2}`]: 1, // fresh browser
    });
    const gate = await checkAnonymousFreeScore(IP_A, BROWSER_2, store);
    expect(gate.allowed).toBe(false);
    expect(gate.used).toBe(FREE_SCORE_LIMIT);
  });
});

describe("(e) DB errors fail OPEN — never deny on an inability to count", () => {
  const throwingStore: FreeScoreCreditStore = {
    async getUsed() {
      throw new Error("connection terminated unexpectedly");
    },
    async increment() {
      throw new Error("connection terminated unexpectedly");
    },
  };

  test("a store that rejects on read still allows scoring", async () => {
    const gate = await checkAnonymousFreeScore(IP_A, BROWSER_1, throwingStore);
    expect(gate).toEqual({ allowed: true, used: 0, limit: FREE_SCORE_LIMIT });
    expect(await attemptTimes(throwingStore, IP_A, BROWSER_1, FREE_SCORE_LIMIT + 5)).toEqual(
      Array.from({ length: FREE_SCORE_LIMIT + 5 }, () => "scored"),
    );
  });

  test("a store that rejects on write does not throw at the caller", async () => {
    await expect(consumeAnonymousFreeScore(IP_A, BROWSER_1, throwingStore)).resolves.toBeUndefined();
  });

  test("junk counts (NaN / negative / null) read as 0, never as a block", async () => {
    const junkStore: FreeScoreCreditStore = {
      async getUsed() {
        return Number.NaN;
      },
      async increment() {},
    };
    expect(await evaluateFreeScoreGate(freeScoreKeys(IP_A, BROWSER_1), junkStore)).toEqual({
      allowed: true,
      used: 0,
      limit: FREE_SCORE_LIMIT,
    });
    const negative: FreeScoreCreditStore = {
      async getUsed() {
        return -5;
      },
      async increment() {},
    };
    expect((await evaluateFreeScoreGate(freeScoreKeys(IP_A, null), negative)).allowed).toBe(true);
  });

  test("one failing key does not skip the other dimension on consume", async () => {
    const seen: string[] = [];
    const halfBroken: FreeScoreCreditStore = {
      async getUsed() {
        return 0;
      },
      async increment(key) {
        seen.push(key);
        if (key.startsWith(FREE_SCORE_IP_PREFIX)) throw new Error("boom");
      },
    };
    await consumeAnonymousFreeScore(IP_A, BROWSER_1, halfBroken);
    expect(seen).toEqual([
      `${FREE_SCORE_IP_PREFIX}${IP_A}`,
      `${FREE_SCORE_VISITOR_PREFIX}${BROWSER_1}`,
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
    expect(await neonFreeScoreStore.getUsed(`${FREE_SCORE_IP_PREFIX}${IP_A}`)).toBe(0);
    expect(await neonFreeScoreStore.increment(`${FREE_SCORE_VISITOR_PREFIX}${BROWSER_1}`)).toBe(
      undefined,
    );
    expect((await checkAnonymousFreeScore(IP_A, BROWSER_1)).allowed).toBe(true);
  });
});
