import { describe, expect, test } from "bun:test";
import {
  BID_VALUE_DEFAULTS,
  STARTER_YEARLY_COST,
  computeBidValue,
  formatDollars,
  formatJobs,
  normalizeBidValueInputs,
} from "./bid-value-calculator";

describe("computeBidValue", () => {
  test("defaults: 2 extra bids a month, $40,000 jobs, 25% wins", () => {
    const r = computeBidValue(BID_VALUE_DEFAULTS);
    expect(r.extraBidsPerYear).toBe(24);
    expect(r.extraWinsPerYear).toBe(6);
    expect(r.extraRevenuePerYear).toBe(240_000);
    expect(r.timesStarterCost).toBe(Math.floor(240_000 / STARTER_YEARLY_COST));
  });

  test("zero inputs give zero, never NaN", () => {
    const r = computeBidValue({ extraBidsPerMonth: 0, avgJobValue: 0, winRatePct: 0 });
    expect(r).toEqual({ extraBidsPerYear: 0, extraWinsPerYear: 0, extraRevenuePerYear: 0, timesStarterCost: 0 });
  });

  test("bad and out-of-range inputs are clamped", () => {
    expect(normalizeBidValueInputs({ extraBidsPerMonth: NaN, avgJobValue: -5, winRatePct: 250 })).toEqual({
      extraBidsPerMonth: 0,
      avgJobValue: 0,
      winRatePct: 100,
    });
  });

  test("fractional wins round revenue to whole dollars", () => {
    const r = computeBidValue({ extraBidsPerMonth: 1, avgJobValue: 15_333, winRatePct: 15 });
    expect(r.extraWinsPerYear).toBeCloseTo(1.8);
    expect(r.extraRevenuePerYear).toBe(Math.round(1.8 * 15_333));
  });
});

describe("formatting", () => {
  test("dollars", () => {
    expect(formatDollars(240000)).toBe("$240,000");
    expect(formatDollars(0)).toBe("$0");
  });
  test("jobs", () => {
    expect(formatJobs(1)).toBe("1 job");
    expect(formatJobs(6)).toBe("6 jobs");
    expect(formatJobs(1.8)).toBe("1.8 jobs");
    expect(formatJobs(0)).toBe("0 jobs");
  });
});
