import { describe, expect, test } from "bun:test";
import { clampWins, parseCalculatorQuery, potentialValue, typicalContract } from "./win-calculator";

describe("parseCalculatorQuery", () => {
  test("accepts a known trade slug and state code (any case)", () => {
    expect(parseCalculatorQuery("janitorial", "va")).toEqual({ trade: "janitorial", state: "VA" });
  });
  test("rejects unknown trades, states and non-strings", () => {
    expect(parseCalculatorQuery("rocket-science", "VA")).toBeNull();
    expect(parseCalculatorQuery("janitorial", "Virginia")).toBeNull();
    expect(parseCalculatorQuery("janitorial", "XX")).toBeNull();
    expect(parseCalculatorQuery(null, undefined)).toBeNull();
  });
});

describe("typicalContract", () => {
  test("is the median of positive amounts", () => {
    expect(typicalContract([300, 100, 200])).toBe(200);
    expect(typicalContract([100, 200, 300, 400])).toBe(250);
  });
  test("ignores zero, negative and non-numbers", () => {
    expect(typicalContract([0, -5, NaN, 100, 200, 300])).toBe(200);
  });
  test("needs at least 3 contracts to call anything typical", () => {
    expect(typicalContract([500_000, 900_000])).toBeNull();
    expect(typicalContract([])).toBeNull();
  });
});

describe("slider", () => {
  test("wins are whole contracts between 1 and 10", () => {
    expect(clampWins(0)).toBe(1);
    expect(clampWins(3.6)).toBe(4);
    expect(clampWins(99)).toBe(10);
    expect(clampWins(NaN)).toBe(1);
  });
  test("potential value multiplies the typical contract, or null without one", () => {
    expect(potentialValue(250_000, 3)).toBe(750_000);
    expect(potentialValue(null, 3)).toBeNull();
  });
});
