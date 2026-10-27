import { describe, expect, test } from "bun:test";
import { broaderRadarTrade } from "./radar-fallback";

describe("Radar trade fallback", () => {
  test("niche building trades fall back to construction", () => {
    for (const t of ["siding", "Roofing", "insulation", "spray foam", "painting", "drywall", "well service", "paving", "windows", "home inspection", "handyman"]) {
      expect(broaderRadarTrade(t)).toBe("construction");
    }
  });
  test("grounds, cleaning and hauling map to their own broad trades", () => {
    expect(broaderRadarTrade("lawn care")).toBe("landscaping");
    expect(broaderRadarTrade("tree removal")).toBe("landscaping");
    expect(broaderRadarTrade("pressure washing")).toBe("janitorial");
    expect(broaderRadarTrade("junk removal")).toBe("trucking");
    expect(broaderRadarTrade("towing")).toBe("trucking");
    expect(broaderRadarTrade("tow truck service")).toBe("trucking");
    expect(broaderRadarTrade("wrecker")).toBe("trucking");
    expect(broaderRadarTrade("stowage")).toBeNull();
  });
  test("no fallback for broad trades themselves, NAICS codes, or unknown trades", () => {
    expect(broaderRadarTrade("construction")).toBe(null);
    expect(broaderRadarTrade("janitorial")).toBe(null);
    expect(broaderRadarTrade("238220")).toBe(null);
    expect(broaderRadarTrade("catering")).toBe(null);
    expect(broaderRadarTrade("")).toBe(null);
  });
});
