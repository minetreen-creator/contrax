import { describe, expect, test } from "bun:test";
import { areaAwardScopes, medianAmount, shortDollars } from "./area-awards";

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
