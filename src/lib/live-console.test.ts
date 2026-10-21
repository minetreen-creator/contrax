import { describe, expect, test } from "bun:test";
import {
  firstMonthStats,
  mapPoint,
  FEED_EVENTS,
  agoLabel,
  placeLabel,
  searchFeedText,
  sortFeed,
  sortTrials,
  timeLeftLabel,
  trialEnds,
  trialFractionLeft,
  trialHeat,
  type TrialCard,
} from "./live-console";

const H = 3_600_000;
const NOW = Date.parse("2026-10-19T15:00:00Z");

describe("live console feed", () => {
  test("search rows say what was searched and flag zero results", () => {
    expect(searchFeedText("trucking", "TX", 0)).toEqual({ title: "Searched trucking · TX", detail: "0 matches" });
    expect(searchFeedText("janitorial", "", 1)).toEqual({ title: "Searched janitorial", detail: "1 match" });
  });

  test("places read city, region", () => {
    expect(placeLabel("Denver", "CO")).toBe("Denver, CO");
    expect(placeLabel(null, "Texas")).toBe("Texas");
    expect(placeLabel("", " ")).toBeNull();
  });

  test("checkouts and purchases are the money events", () => {
    expect(FEED_EVENTS.checkout_started.kind).toBe("checkout");
    expect(FEED_EVENTS.bid_scout_purchased.kind).toBe("purchase");
    expect(FEED_EVENTS.signup_success.kind).toBe("signup");
  });

  test("newest first", () => {
    const base = { kind: "search" as const, place: null, title: "", detail: null, money: false };
    const out = sortFeed([
      { ...base, id: "a", at: "2026-10-19T10:00:00Z" },
      { ...base, id: "b", at: "2026-10-19T12:00:00Z" },
    ]);
    expect(out.map((f) => f.id)).toEqual(["b", "a"]);
  });
});

describe("trial board", () => {
  test("heat: hot within a day, warm within 3 days, cold after or never", () => {
    expect(trialHeat(new Date(NOW - 2 * H).toISOString(), NOW)).toBe("hot");
    expect(trialHeat(new Date(NOW - 48 * H).toISOString(), NOW)).toBe("warm");
    expect(trialHeat(new Date(NOW - 100 * H).toISOString(), NOW)).toBe("cold");
    expect(trialHeat(null, NOW)).toBe("cold");
  });

  test("countdown: ends 7 days after start, ring fraction and label", () => {
    expect(trialEnds("2026-10-19T14:11:39.000Z", 7)).toBe("2026-10-26T14:11:39.000Z");
    expect(trialFractionLeft(3.5 * 24 * H, 7)).toBeCloseTo(0.5);
    expect(trialFractionLeft(-1, 7)).toBe(0);
    expect(timeLeftLabel(5 * H)).toBe("5h left");
    expect(timeLeftLabel(50 * H)).toBe("2d 2h left");
    expect(timeLeftLabel(0)).toBe("Ended");
    expect(agoLabel(new Date(NOW - 90_000).toISOString(), NOW)).toBe("1m ago");
  });

  test("ending soonest first, hot before cold on a tie", () => {
    const card = (userId: number, msLeft: number, heat: TrialCard["heat"]): TrialCard => ({
      userId, email: `${userId}@x.com`, startedAt: "", endsAt: "", msLeft, lastSeen: null, heat,
      visits7d: 0, trade: null, stateCount: 0, searches: [],
    });
    expect(sortTrials([card(1, 5 * H, "cold"), card(2, 5 * H, "hot"), card(3, H, "warm")]).map((c) => c.userId)).toEqual([3, 2, 1]);
  });
});

describe("live search map + on the site now", () => {
  test("the map file draws 50 states + DC, each with a label point", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const map = JSON.parse(readFileSync(new URL("../../public/us-states-albers.json", import.meta.url), "utf8"));
    const codes = Object.keys(map.states);
    expect(codes.length).toBe(51);
    for (const c of ["TX", "CO", "DC", "AK", "HI", "ME"]) expect(codes).toContain(c);
    for (const c of codes) {
      expect(map.states[c].startsWith("M")).toBe(true);
      expect(map.label[c]).toHaveLength(2);
    }
  });

  test("tone: found / mixed / empty / none", async () => {
    const { mapTone } = await import("./live-console");
    const at = "2026-10-19T15:00:00Z";
    expect(mapTone(undefined)).toBe("none");
    expect(mapTone({ state: "TX", searches: 3, zero: 0, lastAt: at })).toBe("found");
    expect(mapTone({ state: "TX", searches: 3, zero: 1, lastAt: at })).toBe("mixed");
    expect(mapTone({ state: "TX", searches: 3, zero: 3, lastAt: at })).toBe("empty");
  });

  test("recent = searched in the last 15 minutes", async () => {
    const { isRecentSearch } = await import("./live-console");
    expect(isRecentSearch({ state: "CO", searches: 1, zero: 1, lastAt: new Date(NOW - 10 * 60_000).toISOString() }, NOW)).toBe(true);
    expect(isRecentSearch({ state: "CO", searches: 1, zero: 1, lastAt: new Date(NOW - 20 * 60_000).toISOString() }, NOW)).toBe(false);
  });

  test("visitor dots: US state only, spread out within a state", async () => {
    const { visitorState, dotOffset } = await import("./live-console");
    expect(visitorState("co", "US")).toBe("CO");
    expect(visitorState("ON", "CA")).toBeNull();
    expect(visitorState("TX", null)).toBeNull();
    expect(visitorState("ZZ", "US")).toBeNull();
    expect(dotOffset(0)).toEqual([0, 0]);
    const spots = new Set([0, 1, 2, 3, 4, 5].map((i) => dotOffset(i).join(",")));
    expect(spots.size).toBe(6);
  });

  test("money panel: trials ending soon, soonest first; steps in order", async () => {
    const { trialsEndingWithin, moneySteps } = await import("./live-console");
    const trial = (userId: number, hoursLeft: number) => ({
      userId, email: `${userId}@x.test`, startedAt: "", endsAt: new Date(NOW + hoursLeft * H).toISOString(), msLeft: hoursLeft * H,
      lastSeen: null, heat: "cold" as const, visits7d: 0, trade: null, stateCount: 0, searches: [],
    });
    expect(trialsEndingWithin([trial(1, 60), trial(2, 5), trial(3, 100), trial(4, -1)], 3, NOW).map((t) => t.userId)).toEqual([2, 1]);
    const steps = moneySteps({ payingNow: 0, sawPlans: 9, clickedBuy: 2, openedCheckout: 1, signinRequired: 1, failed: 0 });
    expect(steps.map((x) => x.value)).toEqual([9, 2, 1]);
  });
});

describe("firstMonthStats", () => {
  test("counts starts, paying, past month one and canceled from Stripe statuses", () => {
    const now = Date.parse("2026-12-01T00:00:00Z");
    const daysAgo = (d: number) => Math.floor((now - d * 86_400_000) / 1000);
    expect(
      firstMonthStats(
        [
          { status: "active", created: daysAgo(3) },
          { status: "active", created: daysAgo(40) },
          { status: "past_due", created: daysAgo(35) },
          { status: "canceled", created: daysAgo(20) },
          { status: "incomplete", created: daysAgo(1) },
        ],
        now,
      ),
    ).toEqual({ started: 4, payingNow: 3, pastMonthOne: 1, canceled: 1 });
    expect(firstMonthStats([], now)).toEqual({ started: 0, payingNow: 0, pastMonthOne: 0, canceled: 0 });
  });
});

describe("mapPoint", () => {
  test("lands cities inside their state on the map drawing", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const map = JSON.parse(readFileSync(new URL("../../public/us-states-albers.json", import.meta.url), "utf8"));
    const bbox = (code: string) => {
      const n = (map.states[code] as string).match(/-?\d+\.?\d*/g)!.map(Number);
      const xs = n.filter((_, i) => i % 2 === 0);
      const ys = n.filter((_, i) => i % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    for (const [code, lat, lon] of [
      ["CA", 37.3, -121.9], // San Jose
      ["WA", 47.6, -122.3], // Seattle
      ["FL", 25.8, -80.2], // Miami
      ["ME", 43.7, -70.3], // Portland
      ["TX", 29.8, -95.4], // Houston
    ] as const) {
      const [x, y] = mapPoint(lat, lon)!;
      const [x0, y0, x1, y1] = bbox(code);
      expect(x).toBeGreaterThanOrEqual(x0);
      expect(x).toBeLessThanOrEqual(x1);
      expect(y).toBeGreaterThanOrEqual(y0);
      expect(y).toBeLessThanOrEqual(y1);
    }
    // San Jose sits west of the old dot at California's center.
    expect(mapPoint(37.3, -121.9)![0]).toBeLessThan(map.label.CA[0]);
  });

  test("Alaska, Hawaii, abroad and missing coordinates fall back", () => {
    expect(mapPoint(61.2, -149.9)).toBeNull();
    expect(mapPoint(21.3, -157.9)).toBeNull();
    expect(mapPoint(51.5, -0.1)).toBeNull();
    expect(mapPoint(null, -100)).toBeNull();
  });
});
