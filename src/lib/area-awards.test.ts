import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { areaAwardScopes, medianAmount, shortDollars, typicalRange, typicalRangeText } from "./area-awards";

describe("areaAwardScopes", () => {
  test("a bid with its own NAICS code matches the code, then the industry group", () => {
    const s = areaAwardScopes("561730", "Landscaping", (c) => (c === "561730" ? "Landscaping Services" : undefined));
    expect(s.map((x) => x.prefixes)).toEqual([["561730"], ["5617"]]);
    expect(s[0].label).toBe("landscaping services");
  });

  test("a city or county bid with no code matches through its category", () => {
    expect(areaAwardScopes(null, "Janitorial")).toEqual([{ prefixes: ["561720"], label: "janitorial" }]);
    expect(areaAwardScopes("", "Construction")[0].prefixes).toEqual(["236", "237", "238"]);
    expect(areaAwardScopes(null, "Construction/Construction Services")[0].label).toBe("construction");
  });

  test("mixed categories get no federal match rather than a guess", () => {
    expect(areaAwardScopes(null, "Transportation")).toEqual([]);
    expect(areaAwardScopes(null, "Other")).toEqual([]);
    expect(areaAwardScopes("12", null)).toEqual([]);
  });
});

test("medianAmount", () => {
  expect(medianAmount([])).toBeNull();
  expect(medianAmount([300, 100, 200])).toBe(200);
  expect(medianAmount([100, 200, 300, 400])).toBe(250);
});

test("shortDollars", () => {
  expect(shortDollars(25_000)).toBe("$25K");
  expect(shortDollars(1_250_000)).toBe("$1.3M");
  expect(shortDollars(2_000_000)).toBe("$2M");
  expect(shortDollars(48_000_000)).toBe("$48M");
});

// Owner 2026-11-11 ("add the budget estimate"): a size estimate from real federal contracts, shown to
// everyone, and only when there are enough contracts for it to mean something.
describe("typical contract size", () => {
  test("is the middle half of the awards, and nothing when there are too few", () => {
    expect(typicalRange(37, 80_400.4, 419_600)).toEqual({ low: 80_400, high: 419_600 });
    expect(typicalRange(5, 30_000, 150_000)).toEqual({ low: 30_000, high: 150_000 });
    expect(typicalRange(4, 30_000, 150_000)).toBeNull(); // four contracts is a guess
    expect(typicalRange(20, null, 150_000)).toBeNull();
    expect(typicalRange(20, 0, 150_000)).toBeNull();
    expect(typicalRange(20, 200_000, 150_000)).toBeNull();
  });

  test("reads as a range, or one figure when both ends round the same", () => {
    expect(typicalRangeText({ low: 80_400, high: 419_600 })).toBe("$80K to $420K");
    expect(typicalRangeText({ low: 1_200_000, high: 1_240_000 })).toBe("about $1.2M");
  });

  test("the page says it is an estimate and not the bid's budget; winners stay for members", () => {
    const box = readFileSync("src/components/AreaAwardsBox.tsx", "utf8");
    expect(box).toContain("Typical contract size");
    expect(box).toContain("It is not this bid&apos;s budget.");
    expect(box.indexOf("data.typical &&")).toBeLessThan(box.indexOf("data.detail ? ("));
    const page = readFileSync("src/routes/bid.$bidId.tsx", "utf8");
    expect(page).toContain("Similar jobs: {typicalRangeText(areaAwards.typical)} (estimate)");
    expect(page).toContain("!valueLabel(bid.estimated_value) && areaAwards?.typical"); // a stated value wins
    const server = readFileSync("src/lib/area-awards.server.ts", "utf8");
    expect(server).toContain("percentile_cont(0.25)");
    expect(server.indexOf("if (paid) {")).toBeLessThan(server.indexOf("recipient_name")); // winners only inside the paid branch
  });
});
