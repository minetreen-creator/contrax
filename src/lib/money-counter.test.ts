import { describe, expect, test } from "bun:test";
import { counterFigures, countAt, easeOut } from "./money-counter";
import type { ContractMapAggregate } from "./contract-map";

const map = {
  states: { VA: { code: "VA", count: 120 }, TX: { code: "TX", count: 300 } },
  totals: { totalOpen: 14159 },
} as unknown as ContractMapAggregate;

describe("money counter figures", () => {
  test("nationwide uses the map total and the full USAspending window", () => {
    expect(counterFigures("US", map, { count: 900, total: 5e9 }, {})).toEqual({ openBids: 14159, endingCount: 900, endingTotal: 5e9 });
  });
  test("a state uses only that state's figures", () => {
    expect(counterFigures("VA", map, { count: 900, total: 5e9 }, { VA: { count: 40, total: 2e8 } })).toEqual({ openBids: 120, endingCount: 40, endingTotal: 2e8 });
  });
  test("a state with no data shows zero, never the national figure", () => {
    expect(counterFigures("WY", map, { count: 900, total: 5e9 }, {})).toEqual({ openBids: 0, endingCount: 0, endingTotal: 0 });
  });
  test("missing data is zero, not a crash", () => {
    expect(counterFigures("US", null, null, {})).toEqual({ openBids: 0, endingCount: 0, endingTotal: 0 });
  });
});

describe("count-up animation", () => {
  test("starts at from, lands exactly on to", () => {
    expect(countAt(0, 1000, 0, 1600)).toBe(0);
    expect(countAt(0, 1000, 1600, 1600)).toBe(1000);
    expect(countAt(0, 1000, 5000, 1600)).toBe(1000);
  });
  test("counts down when switching to a smaller state", () => {
    expect(countAt(1000, 200, 1600, 1600)).toBe(200);
    expect(countAt(1000, 200, 800, 1600)).toBeLessThan(1000);
  });
  test("ease-out is clamped to 0..1", () => {
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
  });
});
