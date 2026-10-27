import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch, termMatches, termNeedsWordStart, termWordStartRegex, tradeTextIncludes } from "./trade-registry";
import { mapCategory } from "./trade-classification";

// Owner 2026-10-06: /contracts-in/virginia/hvac listed French fries ("duct" in
// "products"), and /contracts-in/virginia/it-services listed VDOT snow removal
// (classified "IT Services" because "submit " + "services" contained "it ").
describe("short trade terms must start a word", () => {
  const HVAC = expandTrade("hvac");
  const TRUCKING = expandTrade("trucking");
  const IT = expandTrade("IT services");

  test("substring false positives are gone", () => {
    expect(tradeTextIncludes("Petroleum Products 2026-27", HVAC)).toBe(false);
    expect(tradeTextIncludes("RFI to conduct curriculum review", HVAC)).toBe(false);
    expect(tradeTextIncludes("Annual title search services", TRUCKING)).toBe(false);
    expect(tradeTextIncludes("Credit services for members", IT)).toBe(false);
    expect(tradeTextIncludes("Audit services FY27", IT)).toBe(false);
  });

  test("real matches stay", () => {
    expect(tradeTextIncludes("Ductwork cleaning at City Hall", HVAC)).toBe(true);
    expect(tradeTextIncludes("Fire Station 8 HVAC Replacement", HVAC)).toBe(true);
    expect(tradeTextIncludes("LTL freight to depot", TRUCKING)).toBe(true);
    expect(tradeTextIncludes("IT services support contract", IT)).toBe(true);
    // Long terms still match inside words (owner 09-14: BACKHAULING is trucking).
    expect(termMatches("solid waste disposal and backhauling", "hauling")).toBe(true);
  });

  test("the rule and its SQL form", () => {
    expect(termNeedsWordStart("duct")).toBe(true);
    expect(termNeedsWordStart("it services")).toBe(true);
    expect(termNeedsWordStart("hauling")).toBe(false);
    expect(termWordStartRegex("air-conditioning")).toBe("\\mair-conditioning");
    expect(termWordStartRegex("c++")).toBe("\\mc\\+\\+");
  });
});

describe("IT Services category needs real IT wording", () => {
  test("snow removal notices are not IT", () => {
    const d =
      "NOTICE ONLY - Salem District Bedford Residency Solicitation for 2026-2027 Snow Removal Services via M7B program. Refer to attachment for critical dates, instructions and how to submit via plow4va.vdot.virginia.gov.";
    expect(mapCategory("", "*NOTICE ONLY - 2026-2027 M7B Agreement Bedford Residency", d)).not.toBe("IT Services");
    expect(mapCategory("", "Building permit services", "")).not.toBe("IT Services");
  });
  test("IT work still is", () => {
    expect(mapCategory("", "IT Support Services", "")).toBe("IT Services");
    expect(mapCategory("", "Help desk staffing", "")).toBe("IT Services");
    expect(mapCategory("", "Information Technology Consulting", "")).toBe("IT Services");
  });
});

describe("mapCategory: lawn, tree and repair titles (owner 2026-10-27, county Bonfire boards)", () => {
  const c = (title: string) => mapCategory("", title, "");
  test("lawn, mowing, tree and brush work is Landscaping", () => {
    expect(c("Lawn Care Services")).toBe("Landscaping");
    expect(c("Collegewide Lawncare Services")).toBe("Landscaping");
    expect(c("Landfill Vegetation Mowing and Brush Removal")).toBe("Landscaping");
    expect(c("LOCAL LET MAINTENANCE CONTRACT, COLORADO CO, TREE TRIMMING AND BRUSH REMOVAL")).toBe("Landscaping");
    expect(c("Tate's Hell Roadside Ditch Debrushing 2027")).toBe("Landscaping");
  });
  test("repair and build titles that were Other are Construction", () => {
    expect(c("Post Road South Widening - SR 9/S Atlanta Road to CR 5/Kelly Mill Road")).toBe("Construction");
    expect(c("Countywide Fire Hydrant Replacement - WORCS-5")).toBe("Construction");
    expect(c("Low Pressure Sewer System Installations and Repairs (WORCS-2)")).toBe("Construction");
    expect(c("Indian River Marina Bulkhead Repairs")).toBe("Construction");
    expect(c("Alligator Creek Weir Structure Repairs")).toBe("Construction");
    expect(c("Invitation to Bid: BDC06-26-27 Letchworth - Pavilion - Hurricane Debby")).toBe("Construction");
    expect(c("CFRC Lake Monroe Drawbridge Painting")).toBe("Construction");
  });
  test("Arizona board titles that were Other (2026-10-27)", () => {
    expect(c("Manhole Rehabilitation")).toBe("Construction");
    expect(c("FY2026-27 Chip Seal Program")).toBe("Construction");
    expect(c("Crack Fill and Seal")).toBe("Construction");
    expect(c("Pavement Replacement North End Phase II")).toBe("Construction");
    expect(c("Pavement Marking (2027-2028)")).toBe("Construction");
    expect(c("Centennial Park Restroom Upgrades")).toBe("Construction");
    expect(c("DESERT WELL 25 – EQUIPPING and DESERT WELLS 26 - EQUIPPING")).toBe("Construction");
    expect(c("Glass Repair, Replacement, Tinting and Maintenance Services")).toBe("Construction");
    expect(c("Estrella Mountain Community College Tree Replacement")).toBe("Landscaping");
    // Not trade work: stays Other.
    expect(c("Employee Benefits- Medical/Rx/EAP")).toBe("Other");
    expect(c("Drone Show Services")).toBe("Other");
  });
  test("an electrical job named after its building keeps its trade", () => {
    expect(c("Tenney Pavilion PV Removal and Reinstall")).toBe("Plumbing & Electrical");
    expect(c("Interdisciplinary Research Building Replacement of the Fire Alarm System")).toBe("Plumbing & Electrical");
  });
});

describe("Radar terms: paving, utility, restroom, mowing and tree titles (owner 2026-10-27)", () => {
  const construction = expandTrade("construction");
  const landscaping = expandTrade("landscaping");
  const hit = (title: string, ex: ReturnType<typeof expandTrade>) => isStrongTradeMatch(title, null, "", null, ex);
  test("Arizona board titles now match a construction search", () => {
    for (const t of ["Crack Fill and Seal", "FY2026-27 Chip Seal Program", "Manhole Rehabilitation", "Centennial Park Restroom Upgrades", "Pavement Marking (2027-2028)", "Pavement Replacement North End Phase II"]) {
      expect(hit(t, construction)).toBe(true);
    }
    expect(hit("Employee Benefits- Medical/Rx/EAP", construction)).toBe(false);
  });
  test("mowing, tree and brush titles match a landscaping search", () => {
    for (const t of ["Landfill Vegetation Mowing and Brush Removal", "Estrella Mountain Community College Tree Replacement", "Tree Trimming and Removal Services"]) {
      expect(hit(t, landscaping)).toBe(true);
    }
  });
});
