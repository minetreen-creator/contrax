import { describe, expect, test } from "bun:test";
import { FEDERAL_TRADE_NAICS } from "./federal-trade-data";
import { coinLabel, coinValue, distinctTrades, perSecond } from "./money-jar";

describe("homepage money jar", () => {
  test("cybersecurity's codes sit inside IT services, so it is not added twice", () => {
    const trades = distinctTrades(FEDERAL_TRADE_NAICS);
    expect(trades).toContain("it-services");
    expect(trades).not.toContain("cybersecurity");
    expect(trades).toContain("janitorial");
    expect(distinctTrades({ a: ["1", "2"], b: ["2", "3"] })).toEqual(["a", "b"]);
  });

  test("an even pace over the year", () => {
    expect(perSecond(31_557_600)).toBeCloseTo(1, 6);
    expect(perSecond(0)).toBe(0);
  });

  test("coins are round numbers near one every second and a half", () => {
    expect(coinValue(6_000)).toBe(10_000); // 9,000 → 10,000
    expect(coinValue(1_500)).toBe(2_000); // 2,250 → 2,000
    expect(coinValue(3_000)).toBe(5_000); // 4,500 → 5,000
    expect(coinValue(0)).toBe(0);
    expect(coinLabel(10_000)).toBe("$10,000");
    expect(coinLabel(2_000_000)).toBe("$2 million");
  });
});
