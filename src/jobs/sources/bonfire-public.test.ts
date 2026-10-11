/**
 * Bonfire rate-limit handling (owner 2026-10-11): consecutive requests are
 * spaced, and a 429 is retried once after the server's Retry-After wait.
 * Zero network: the request, clock and wait are injected.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  BONFIRE_DEFAULT_RETRY_WAIT_MS,
  BONFIRE_MAX_RETRY_WAIT_MS,
  BONFIRE_MIN_GAP_MS,
  bonfireRequestDeps,
  bonfireRetryWaitMs,
  fetchBonfireBids,
  resetBonfirePacing,
  type BonfireConfig,
} from "./bonfire-public";

const CFG: BonfireConfig = {
  source: "test_bonfire",
  host: "https://example.bonfirehub.com",
  idPrefix: "testbonfire",
  stateName: "Illinois",
  agencyName: () => "Test Agency",
};
const OK_BODY = JSON.stringify({ success: true, payload: { projects: {}, departments: {} } });
const original = { ...bonfireRequestDeps };

function fake(responses: Response[]) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const calls: number[] = [];
  bonfireRequestDeps.clock = () => t;
  bonfireRequestDeps.sleep = async (ms: number) => {
    sleeps.push(ms);
    t += ms;
  };
  bonfireRequestDeps.fetch = async () => {
    calls.push(t);
    return responses.shift()!;
  };
  resetBonfirePacing();
  return { sleeps, calls };
}

afterEach(() => {
  Object.assign(bonfireRequestDeps, original);
  resetBonfirePacing();
});

describe("bonfireRetryWaitMs", () => {
  test("seconds, HTTP date, missing, and the cap", () => {
    expect(bonfireRetryWaitMs("20")).toBe(20_000);
    expect(bonfireRetryWaitMs(new Date(60_000).toUTCString(), 30_000)).toBe(30_000);
    expect(bonfireRetryWaitMs(null)).toBe(BONFIRE_DEFAULT_RETRY_WAIT_MS);
    expect(bonfireRetryWaitMs("garbage")).toBe(BONFIRE_DEFAULT_RETRY_WAIT_MS);
    expect(bonfireRetryWaitMs("3600")).toBe(BONFIRE_MAX_RETRY_WAIT_MS);
  });
});

describe("fetchBonfireBids rate limit", () => {
  test("a 429 is retried once after the server's wait, then read", async () => {
    const { sleeps, calls } = fake([
      new Response("", { status: 429, headers: { "Retry-After": "12" } }),
      new Response(OK_BODY, { status: 200 }),
    ]);
    const r = await fetchBonfireBids(CFG, 0);
    expect(r.rows).toEqual([]);
    expect(calls.length).toBe(2);
    expect(sleeps).toEqual([12_000]);
  });

  test("a second 429 is reported, not retried again", async () => {
    const { calls } = fake([new Response("", { status: 429 }), new Response("", { status: 429 })]);
    await expect(fetchBonfireBids(CFG, 0)).rejects.toThrow("429");
    expect(calls.length).toBe(2);
  });

  test("back-to-back tenants are spaced by the minimum gap", async () => {
    const { calls } = fake([new Response(OK_BODY, { status: 200 }), new Response(OK_BODY, { status: 200 })]);
    await fetchBonfireBids(CFG, 0);
    await fetchBonfireBids(CFG, 0);
    expect(calls[1]! - calls[0]!).toBe(BONFIRE_MIN_GAP_MS);
  });
});
