import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { expandTrade, isStrongTradeMatch, MAX_EXPANDED_TERMS } from "./trade-registry";

// Owner 2026-11-03: "we need more construction bids in TX", "max inputs",
// "increase the limit". The Texas construction page showed 184 open bids while
// the map counted 418 construction-stamped Texas bids.
const c = expandTrade("construction");
const strong = (t: string) => isStrongTradeMatch(t, null, null, null, c);

describe("construction finds the jobs Texas buyers post", () => {
  test("the term cap is 128 and construction's phrases all fit", () => {
    expect(MAX_EXPANDED_TERMS).toBe(128);
    for (const t of ["sidewalk", "lift station", "hmac", "fire station", "dredging"]) expect(c.terms).toContain(t);
  });

  test("job titles that used to be missed now match", () => {
    for (const t of [
      "Sidewalk Improvements Phase 3", "Lift Station Improvements", "ADA Improvements", "New Fire Station",
      "Park Improvements", "Concrete Repairs", "Demolition of Old Gym", "Building Addition", "Remodel of Admin Building",
      "Parking Garage Repairs", "HMAC Overlay", "Street Rehabilitation", "Culvert Replacement", "Restroom Facility",
      "Elevated Storage Tank Rehabilitation", "Wastewater Treatment Plant Expansion", "Hike and Bike Trail",
      "Curb and Gutter Replacement", "Interior Finish Out", "Low Water Crossing Improvements",
      "CMAR Services for New Elementary School", "Design-Build Fire Station",
    ]) expect({ t, m: strong(t) }).toEqual({ t, m: true });
  });

  test("goods buys, design/inspection services and other trades stay out", () => {
    for (const t of [
      "Portable Asphalt Recycling Machine", "Asphalt Materials", "Road Building Materials", "Cold Mix Asphalt",
      "Concrete Supplies", "Construction Materials Testing Services", "Construction Inspection Services",
      "Construction Management Software", "Engineering Services for Sidewalk Improvements", "Pavement Condition Assessment",
      "Street Sweeping Services", "Street Light Maintenance", "Vocational Rehabilitation Services", "Weed Abatement",
      "Janitorial Services", "Mowing Services", "Purchase of Dump Trucks", "Rental of Heavy Equipment",
    ]) expect({ t, m: strong(t) }).toEqual({ t, m: false });
  });

  test("the state + trade page narrows to the state before its row limit", () => {
    // Since 2026-11-08 the page uses Radar's matches, whose in-state pass reads up to
    // IN_STATE_SCAN_LIMIT rows of the requested state before any nationwide limit.
    const seo = readFileSync("src/lib/seo-landing.tsx", "utf8");
    expect(seo).toContain("await stateRadarMatches(");
    expect(readFileSync("src/lib/radar-scan-query.ts", "utf8")).toContain("LIMIT ${IN_STATE_SCAN_LIMIT}");
    expect(readFileSync("src/lib/trade-registry.ts", "utf8")).toContain("if (isConstructionExpansion(expansion)) clauses.push(s`category = 'Construction'`);");
  });
});
