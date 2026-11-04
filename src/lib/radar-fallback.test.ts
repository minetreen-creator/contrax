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
  test("NAICS codes with nothing open fall back to their broad trade (owner 2026-11-04)", () => {
    expect(broaderRadarTrade("238150")).toBe("construction"); // glass and glazing
    expect(broaderRadarTrade("238220")).toBe("construction");
    expect(broaderRadarTrade("236118")).toBe("construction");
    expect(broaderRadarTrade("561730")).toBe("landscaping");
    expect(broaderRadarTrade("561720")).toBe("janitorial");
    expect(broaderRadarTrade("484110")).toBe("trucking");
  });
  test("no fallback for broad trades themselves, other NAICS codes, or unknown trades", () => {
    expect(broaderRadarTrade("construction")).toBe(null);
    expect(broaderRadarTrade("janitorial")).toBe(null);
    expect(broaderRadarTrade("541512")).toBe(null);
    expect(broaderRadarTrade("catering")).toBe(null);
    expect(broaderRadarTrade("")).toBe(null);
  });
});
