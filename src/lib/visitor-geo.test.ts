import { describe, expect, test } from "bun:test";
import { countryLabel, isUsVisitor, visitorCountry } from "./visitor-geo";

describe("visitor country (owner 2026-10-06 ad check)", () => {
  test("a recorded country wins", () => {
    expect(visitorCountry("ng", "LA", "Lagos")).toEqual({ code: "NG", exact: true });
    expect(countryLabel(visitorCountry("NG", "LA", "Lagos"))).toBe("Nigeria");
    expect(isUsVisitor("US", "VA", "Ashburn")).toBe(true);
  });
  test("older rows are estimated from the region and say so", () => {
    expect(visitorCountry(null, "VA", "Richmond")).toEqual({ code: "US", exact: false });
    expect(countryLabel(visitorCountry(null, "VA", "Richmond"))).toBe("United States (est.)");
    // Lagos state shares Louisiana's code.
    expect(isUsVisitor(null, "LA", "Lagos")).toBe(false);
    expect(isUsVisitor(null, "LA", "New Orleans")).toBe(true);
    expect(countryLabel(visitorCountry(null, "02", "Jeddah"))).toBe("Outside the US (est.)");
    expect(visitorCountry(null, null, null)).toBeNull();
  });
});
