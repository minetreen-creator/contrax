import { describe, expect, test } from "bun:test";
import { expandTrade, termMatches, termNeedsWordStart, termWordStartRegex, tradeTextIncludes } from "./trade-registry";
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
