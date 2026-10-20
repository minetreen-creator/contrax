import { describe, expect, test } from "bun:test";

import { HEAD_START_HOURS } from "./head-start";
import { formatDollars, headStartSummary, medianAward, MIN_AWARDS_FOR_MEDIAN, tradePlace } from "./upgrade-pitch";

describe("medianAward", () => {
  test("needs enough awards, ignores zero and bad amounts", () => {
    const few = Array.from({ length: MIN_AWARDS_FOR_MEDIAN - 1 }, (_, i) => (i + 1) * 100);
    expect(medianAward(few)).toBeNull();
    expect(medianAward([0, -5, NaN, ...few])).toBeNull();
    expect(MIN_AWARDS_FOR_MEDIAN).toBe(20);
  });

  test("odd and even counts", () => {
    const odd = Array.from({ length: 21 }, (_, i) => (21 - i) * 10);
    expect(medianAward(odd)).toBe(110);
    const even = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(medianAward(even)).toBe(105);
  });
});

describe("formatDollars", () => {
  test("whole dollars below a million, millions with one decimal", () => {
    expect(formatDollars(85000.4)).toBe("$85,000");
    expect(formatDollars(1_250_000)).toBe("$1.3M");
    expect(formatDollars(2_000_000)).toBe("$2M");
  });
});

describe("headStartSummary", () => {
  test("counts only bids still inside the head start and finds the soonest to open", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
    const s = headStartSummary(
      [{ createdAt: hoursAgo(10) }, { createdAt: hoursAgo(100) }, { createdAt: hoursAgo(HEAD_START_HOURS + 1) }],
      now,
    );
    expect(s.count).toBe(2);
    expect(s.nextOpens).toBe(new Date(now + (HEAD_START_HOURS - 100) * 3_600_000).toISOString());
    expect(headStartSummary([], now)).toEqual({ count: 0, nextOpens: null });
  });
});

describe("tradePlace", () => {
  test("reads naturally with and without a trade or place", () => {
    expect(tradePlace({ tradeLabel: "janitorial", placeLabel: "Virginia" })).toBe("janitorial in Virginia");
    expect(tradePlace({ tradeLabel: null, placeLabel: "Virginia" })).toBe("your trade in Virginia");
    expect(tradePlace({ tradeLabel: "trucking", placeLabel: null })).toBe("trucking");
  });
});
