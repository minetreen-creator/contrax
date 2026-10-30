import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-10-30: zero-result searches on the Mission Control map.
describe("query shapes that used to match nothing", () => {
  test("several NAICS codes in one box each count", () => {
    const e = expandTrade("423840 423850 423710");
    expect(e.isNaics).toBe(false);
    expect(e.naicsCodes).toEqual(["423840", "423850", "423710"]);
    expect(isStrongTradeMatch("Industrial supplies", null, null, "423850", e)).toBe(true);
    expect(expandTrade("423840, 423850").naicsCodes).toEqual(["423840", "423850"]);
    // One code is unchanged: exact NAICS equality.
    expect(expandTrade("423840").isNaics).toBe(true);
  });

  test("two trades joined by a slash or 'and' expand each part", () => {
    const e = expandTrade("it / software");
    expect(e.terms).toContain("software");
    expect(e.terms).toContain("information technology");
    expect(e.naicsCodes).toContain("541511");
    // A bare "it" is never a match term (it would hit "item", "unit"...).
    expect(e.terms).not.toContain("it");
    expect(expandTrade("janitorial and landscaping").naicsCodes).toEqual(expect.arrayContaining(["561720", "561730"]));
  });

  test("a phrase the registry knows is never split", () => {
    expect(expandTrade("IT services").terms[0]).toBe("it services");
    expect(expandTrade("drywall").naicsCodes).toEqual(["238310"]);
  });

  test("concrete polishing finds concrete work", () => {
    const e = expandTrade("concrete polishing");
    expect(e.naicsCodes).toContain("238110");
    expect(e.terms).toContain("polished concrete");
  });
});
