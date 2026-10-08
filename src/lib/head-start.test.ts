import { describe, expect, test } from "bun:test";
import { applyHeadStart, HEAD_START_HOURS, headStartUntil } from "./head-start";
import { hasPaidBidAccess } from "./head-start.server";
import type { GateStores } from "./plan-gates.server";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("paid head start — the rule", () => {
  test("a bid is in its head start for its first 7 days on Contrax (owner 2026-10-08: was 3)", () => {
    expect(HEAD_START_HOURS).toBe(168);
    expect(headStartUntil(new Date(NOW - 1 * HOUR).toISOString(), NOW)).toBe(new Date(NOW + 167 * HOUR).toISOString());
    expect(headStartUntil(new Date(NOW - 167 * HOUR).toISOString(), NOW)).toBe(new Date(NOW + 1 * HOUR).toISOString());
    expect(headStartUntil(new Date(NOW - 169 * HOUR).toISOString(), NOW)).toBeNull();
    expect(headStartUntil(null, NOW)).toBeNull();
    expect(headStartUntil("not a date", NOW)).toBeNull();
  });

  test("free viewers lose the source link during the head start; paid viewers never do", () => {
    const fresh = { id: 1, source_url: "https://example.gov/bid/1", created_at: new Date(NOW - 2 * HOUR).toISOString() };
    const old = { ...fresh, created_at: new Date(NOW - 200 * HOUR).toISOString() };
    const locked = applyHeadStart(fresh, false, NOW);
    expect(locked.source_url).toBeNull();
    expect(locked.head_start_until).toBe(new Date(NOW + 166 * HOUR).toISOString());
    expect(applyHeadStart(fresh, true, NOW)).toEqual({ ...fresh, head_start_until: null });
    expect(applyHeadStart(old, false, NOW)).toEqual({ ...old, head_start_until: null });
  });
});

describe("paid head start — who counts as paid", () => {
  const stores = (trial: any, scout = false): GateStores => ({
    trialStatus: { load: async () => trial },
    bidScout: { hasActiveSubscription: async () => scout },
  });
  const active = { active: false, daysLeft: 0, expired: false, endsAt: null, fullAccess: false };

  test("Starter and above, admins and Bid Scout are paid; Basic, expired and anonymous are not", async () => {
    expect(await hasPaidBidAccess(null, stores(null))).toBe(false);
    expect(await hasPaidBidAccess({ id: 1 }, stores({ ...active, planTier: "basic" }))).toBe(false);
    expect(await hasPaidBidAccess({ id: 1 }, stores({ ...active, planTier: "starter" }))).toBe(true);
    expect(await hasPaidBidAccess({ id: 1 }, stores({ ...active, planTier: "professional" }))).toBe(true);
    expect(await hasPaidBidAccess({ id: 1 }, stores({ ...active, planTier: "starter", expired: true }))).toBe(false);
    expect(await hasPaidBidAccess({ id: 1 }, stores({ ...active, planTier: "basic" }, true))).toBe(true);
    expect(await hasPaidBidAccess({ id: 1, is_admin: true }, stores({ ...active, planTier: "basic" }))).toBe(true);
  });

  test("a failed lookup fails closed (never unlocks)", async () => {
    const broken: GateStores = {
      trialStatus: { load: async () => { throw new Error("db down"); } },
      bidScout: { hasActiveSubscription: async () => true },
    };
    expect(await hasPaidBidAccess({ id: 1 }, broken)).toBe(false);
  });
});
