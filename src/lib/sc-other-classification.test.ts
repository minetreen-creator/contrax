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
      "2027 CLARENDON PAVEMENT IMPROVEMENT",
      "S-29 @ S-167 INT. IMPROVEMENT",
      "MIDWAY RD (S-76)/HARRIETT CR/CRESTVIEW RD INTERSECTION IMPR",
      "I-95 SAFETY IMPROVEMENTS MM 90 - MM 120",
      "S-278 (CALKS FERRY ROAD) ROAD DEPARTURE MITIGATION",
      "CCR PHASE 3A - FRONTANG ROADS AND UTILITIES",
      "US 25 (Georgia Avenue) Traffic Calming",
      "Paslay Drive Right-Of-Way Improvements",
      "District Office New Driveway Extension to Battleship Road",
      "Rehabilitation of 182 Congress Street",
      "Remove, Haul-off and, Replace (8) Residential Roofs",
      "Georgetown - Cat Meeting House Foundation Improvements",
      "Fire Rescue Headquarters Improvements",
      "YTC - Welding Expansion - Building D",
      "TOC - GTC - General Contracting Services 2026-2029",
      "RFQ-SC Licensed Residential Contractors",
      "CLASS 2 LANDFILL PARTIAL CLOSURE",
      "FY26 Clouter Creek Middle and Highway Cell Diking",
      "Berkeley – Bonneau Ferry Pole Shed",
      "Residential Bathroom Modification",
      "CONCRETE PAD AND SOIL IMPROVEMENT PROJECT",
      "City of Aiken Chimney Work for The Center for African American History, Art and Culture",
      "Carpet Replacement - Conway Campus Building 100 1st Floor",
      "Preventative Roof Maintenance",
    ]) expect([t, cat(t)]).toEqual([t, "Construction"]);
  });

  test("electrical and mechanical jobs get their own trade", () => {
    expect(cat("David Building - Replace Motor Control Center")).toBe("Plumbing & Electrical");
    expect(cat("Labor & Equipment Rates for Recloser Installation")).toBe("Plumbing & Electrical");
    expect(cat("Waterfront Park Hall Mechanical Package")).toBe("HVAC");
    expect(cat("Hampton Regional Medical Center Air Handler Replacement")).toBe("HVAC");
    expect(cat("SC Data Center - Replace VAV Boxes and Controls")).toBe("HVAC");
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
      "Eastside Corner Store Operator",
      "SC Housing-Property Preservation Service",
      "Investment Broker Services",
    ]) expect([t, cat(t)]).toEqual([t, "Other"]);
  });
});

// Found while measuring the change nationwide: services and goods that named
// a plant, a station or a bridge were moving to Construction.
describe("plant, station and bridge words in a service or goods title", () => {
  test("stay Other", () => {
    for (const t of [
      "Supplemental Water Treatment Operator Labor Services",
      "Water Treatment Maintenance and Analysis Services",
      "WATER TREATMENT CHEMICALS: FLUOROSILICIC ACID",
      "Wastewater Treatment Laboratory Services for the City of Franklin, TN Water Management Department",
      "Secondary Music Instruments and Furniture for New Schools and Ongoing Needs",
      "Public Art for OKC Will Rogers International Airport Parking Garage",
      "Fire Station Alerting System",
      "OVERHEAD BRIDGE CRANE",
    ]) expect([t, cat(t)]).not.toEqual([t, "Construction"]);
  });

  test("real plant and station jobs stay Construction", () => {
    for (const t of [
      "Davis Water Treatment Plant Filter System Improvements",
      "REDLANDS WASTEWATER TREATMENT PLANT UPGRADES - PHASE 2 - REBID",
      "3RD AVENUE LIFT STATION PROJECT",
      "Woodbridge Station East Elevator Modernization",
    ]) expect([t, cat(t)]).toEqual([t, "Construction"]);
  });
});
