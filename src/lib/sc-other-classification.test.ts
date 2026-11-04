import { describe, expect, test } from "bun:test";
import { mapCategory } from "./trade-classification";

// Owner 2026-11-04: "I'm concerned about the other category 336" (South Carolina).
const cat = (t: string) => mapCategory("", t, "");

describe("South Carolina titles that were filed Other", () => {
  test("construction jobs are filed Construction", () => {
    for (const t of [
      "USC Lancaster MR&R - Roof Replacements Medford Lib",
      "Concrete Installation Project - Blue Ridge High",
      "Courthouse Expansion",
      "Shannon Street Waterline Project",
      "Northwood Estates Pond Improvements",
      "Improvement to Town of Ware Shoals Roads 2026-2027",
      "Generostee Creek WWTP & Rocky River WWTP Geomembrane Liner Replacement",
      "Removal of Asbestos Materials & Demolition of Residential Structure(s) Hayne",
      "Construction Management At Risk - Multiple Projects",
      "SCDPS - Aiken I-20 Eastbound Weigh Station Scale Replacement",
    ]) expect([t, cat(t)]).toEqual([t, "Construction"]);
  });

  test("electrical and mechanical jobs get their own trade", () => {
    expect(cat("David Building - Replace Motor Control Center")).toBe("Plumbing & Electrical");
    expect(cat("Labor & Equipment Rates for Recloser Installation")).toBe("Plumbing & Electrical");
    expect(cat("Waterfront Park Hall Mechanical Package")).toBe("HVAC");
  });

  test("services and goods stay Other", () => {
    for (const t of [
      "Audit Services and Financial Statement Preparation Request for Proposal Rebid",
      "LOBBYING SERVICES",
      "Marching Band Uniforms",
      "Request for Qualifications for Capital Building and Maintenance Program Management Services for Charleston County",
      "District Civil Engineering Services",
      "Comprehensive Plan Update",
      "Vending Services",
      "Construction Management Services",
    ]) expect([t, cat(t)]).toEqual([t, "Other"]);
  });
});
