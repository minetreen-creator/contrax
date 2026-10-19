import { describe, expect, test } from "bun:test";
import {
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
  test("51 tiles, each state once, no two on the same square", async () => {
    const { STATE_TILES } = await import("./live-console");
    expect(STATE_TILES.length).toBe(51);
    expect(new Set(STATE_TILES.map((t) => t[0])).size).toBe(51);
    expect(new Set(STATE_TILES.map((t) => `${t[1]}:${t[2]}`)).size).toBe(51);
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
});
