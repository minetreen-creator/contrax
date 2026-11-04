import { describe, expect, test } from "bun:test";
import { mapCategory } from "./trade-classification";

// Owner 2026-11-04 ("I can branch out" → California): 1,677 open BidNet California
// bids were filed "Other"; these titles are from that set (2026-11-04 read).
describe("BidNet California titles are filed the way Radar's construction search finds them", () => {
  test("construction jobs are Construction", () => {
    for (const t of [
      "Removal and Replacement of Apparatus Bay Doors – Fire Stations 1 & 2",
      "Pier Structural Repairs Project",
      "CDBG CONCRETE ADA IMPROVEMENTS 2027 CITY PROJECT NO. 7946",
      "Earl Warren Park Restroom Replacement",
      "Broad Street and Randolph Street Sewer Replacement",
      "Avenue 376 over Traver Canal Bridge Project",
      "WASTEWATER TREATMENT PLANT ODOR CONTROL IMPROVEMENTS",
      "Well 20 Rehabilitation Project Phase II",
      "Filburn Avenue Rehabilitation Project",
      "Milpitas Sports Center Football Bleacher Replacement",
      "Santa Maria Water Reclamation Plant New Operations Building",
      "2026 College Park High School Softball Field Improvements",
      "BUILDING 100 ELEVATOR TOWER AT FULLERTON COLLEGE",
      "Collections Square Maintenance Hole Upgrades Phase II Project",
      // A place name is not a materials buy (Idaho ITD, "Sand Creek").
      "45TH EAST; SAND CREEK & WILLOW CREEK BRIDGE",
    ]) expect(`${mapCategory("", t, "")} | ${t}`).toBe(`Construction | ${t}`);
  });
  test("consulting, design, studies, leases and goods are not", () => {
    for (const t of [
      "Stewardship On-Call Biological Services",
      "Architect-Engineer (A-E) Structural Engineering Services – Task Order Contract",
      "Project Management Services",
      "State Lobbying Services",
      "Traffic Safety Action Plan",
      "ADA Self-Evaluation and Transition Plan",
      "Weapons Detection System and Visitor Management System Lease",
      "Property Appraisal Services On-Call",
      "Construction Management Services for the Rehabilitation of the Wallkill Blow-off",
      "Sand and Gravel Supply",
    ]) expect(`${mapCategory("", t, "")} | ${t}`).not.toBe(`Construction | ${t}`);
  });
});

describe("a notice type alone never makes a bid Construction (owner 2026-11-04)", () => {
  test("federal goods and services filed as \"Solicitation\" stay out of Construction", () => {
    for (const [type, t] of [
      ["Solicitation", "Canned Fruit for use in Domestic Food Assistance Programs"],
      ["Combined Synopsis/Solicitation", "Technical Support for Laptop Computers"],
      ["Solicitation", "F110 SEAL METALLIC AIR, NSN: 2840-01-308-7046PR"],
      ["Solicitation", "1.3B PACOM Bunkers Overseas Solicitation"],
    ]) expect(mapCategory(type, t, "")).not.toBe("Construction");
  });
  test("a construction title under the same notice type still is", () => {
    expect(mapCategory("Solicitation", "Y1DA--590-27-120 Replace Pneumatic Tube System", "construction of a pneumatic tube system")).toBe("Construction");
    expect(mapCategory("Solicitation", "Roof Replacement, Building 12", "")).toBe("Construction");
    expect(mapCategory("Solicitation", "Y1DA--590-27-120 Replace Pneumatic Tube System", "")).toBe("Construction");
    expect(mapCategory("Solicitation", "Z2AA--Repair Parking Garage Expansion Joints", "")).toBe("Construction");
  });
});
