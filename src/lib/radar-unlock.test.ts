import { beforeAll, describe, expect, test } from "bun:test";

beforeAll(() => {
  process.env.RADAR_HANDOFF_SECRET = "test-secret-for-radar-unlock";
});

const load = () => import("./radar-handoff.server");

describe("Radar email unlock cookie (owner 2026-10-23)", () => {
  test("valid for the visitor it was signed for, and only that visitor", async () => {
    const h = await load();
    const c = h.signRadarUnlock("vid-123");
    expect(h.verifyRadarUnlock(c, "vid-123")).toBe(true);
    expect(h.verifyRadarUnlock(c, "vid-999")).toBe(false);
  });

  test("a tampered or empty cookie is rejected", async () => {
    const h = await load();
    const c = h.signRadarUnlock("vid-123");
    expect(h.verifyRadarUnlock(c.slice(0, -2) + "xx", "vid-123")).toBe(false);
    expect(h.verifyRadarUnlock("", "vid-123")).toBe(false);
    expect(h.verifyRadarUnlock(null, "vid-123")).toBe(false);
  });

  test("expires after 30 days", async () => {
    const h = await load();
    const t = Date.now() - 31 * 24 * 60 * 60 * 1000;
    expect(h.verifyRadarUnlock(h.signRadarUnlock("vid-123", t), "vid-123")).toBe(false);
  });

  test("an unlock cookie can't pass as a handoff cookie, or the reverse", async () => {
    const h = await load();
    expect(h.verifyRadarHandoff(h.signRadarUnlock("vid-123"))).toBeNull();
    const handoff = h.signRadarHandoff({ v: "vid-123", t: "janitorial", c: "sb", s: "VA", z: "any", m: [1, 2], k: Date.now() });
    expect(h.verifyRadarUnlock(handoff, "vid-123")).toBe(false);
  });

  test("unlocks only the search the handoff cookie was minted for", async () => {
    const h = await load();
    const p = h.verifyRadarHandoff(h.signRadarHandoff({ v: "vid-123", t: "janitorial", c: "sb", s: "VA", z: "any", m: [1, 2], k: Date.now() }));
    const scan = { visitorId: "vid-123", trade: "janitorial", state: "VA", cert: "sb", sizePref: "any" };
    expect(h.handoffMatchesScan(p, scan)).toBe(true);
    expect(h.handoffMatchesScan(p, { ...scan, trade: "roofing" })).toBe(false);
    expect(h.handoffMatchesScan(p, { ...scan, state: "TX" })).toBe(false);
    expect(h.handoffMatchesScan(p, { ...scan, visitorId: "someone-else" })).toBe(false);
    expect(h.handoffMatchesScan(null, scan)).toBe(false);
  });
});
