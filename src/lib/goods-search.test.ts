import { describe, expect, test } from "bun:test";
import { expandTrade, isGoodsExpansion, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-16: a visitor searched "Commodity" in California and got 0 matches.
describe("the goods search", () => {
  const goods = expandTrade("Commodity");
  const shown = (title: string, e = goods) => isStrongTradeMatch(title, null, null, null, e);

  test('"commodity", "commodities" and "goods" all mean goods buys', () => {
    for (const q of ["Commodity", "commodities", "Goods"]) expect(isGoodsExpansion(expandTrade(q))).toBe(true);
  });

  test("it shows supply and equipment purchases, including federal product listings", () => {
    expect(shown("Purchase of Two Dump Trucks")).toBe(true);
    expect(shown("Furnish and Deliver Road Salt")).toBe(true);
    expect(shown("Supply and Delivery of Water Meters")).toBe(true);
    expect(shown("16--ACTUATOR, MECHANICAL")).toBe(true);
    expect(shown("NSN 5640013713262; INSULATION BLOCK, THERMAL")).toBe(true);
  });

  test("it does not show service work", () => {
    expect(shown("Janitorial Services for City Hall")).toBe(false);
    expect(shown("J041--HVAC Repair")).toBe(false);
  });

  test("a specific search stays narrow, and other trades still reject product listings", () => {
    expect(isGoodsExpansion(expandTrade("office supplies"))).toBe(false);
    expect(isGoodsExpansion(expandTrade("construction"))).toBe(false);
    expect(shown("16--ACTUATOR, MECHANICAL", expandTrade("hvac"))).toBe(false);
  });
});
