import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-08 ("Lets look at construction in GA"): open Georgia bids (GPR, BidNet Georgia,
// 2026-11-08 read) that Radar's construction search missed, and one it counted that is a design contract.
const construction = expandTrade("construction");
const strong = (t: string) => isStrongTradeMatch(t, null, null, null, construction);

describe("Georgia construction titles", () => {
  test("building work is a construction match", () => {
    for (const t of [
      "T32-D1-PavePres-SR15-Clarke-194735",
      "T32-D3-Drain. Rehab-SR401 Spalding-194526",
      "T32-D2-Drain Rehab-SR29 Baldwin-194668",
      "Bid Ref. #27-030 Albany Pipe Rehabilitation - Phase I",
      "IFB #028-47 Trenchless Stormwater Pipe Rehabilitation at Holland View Drive",
      "Bid Ref. 27-032 Well No 21 Rehabilitation",
      "BL148-26, Tribble Mill Dam No. 2 (Chandler Lake) Rehabilitation",
      "1948 Warehouse Wall Remediation",
      "Site 3 951 5th St. Maintenance Office Expansion",
      "Lassiter HS Grandstand Improvements",
      "Howard Coffin Park Swimming Pool Repairs",
      "Alderman Lane and Parking Improvements (PE22217)",
      "27-017-Abernathy Greenway Southside Improvements (Re-bid)",
      "OPEN Effingham County Regional Water Supply Facilities 1.5 MG Elevated Water Tank",
      "Jones County Sheriff's Office Roof Recover",
      "Citywide Guardrail Installation and Repair",
      "CITY OF ALAMO FY27 CDBG SEWERAGE",
      "82000-RYDC Building Abatement",
      "Unaccompanied Personnel Housing Restoration at NSB Kings Bay, GA",
      "IWQ 135824, Purchase and Installation of Aluminum Storefront Assemblies",
    ]) expect(`${strong(t)} | ${t}`).toBe(`true | ${t}`);
  });
  test("design, planning, services and goods stay out", () => {
    for (const t of [
      "27-002 FREIGHT ITS PLANNING AND PEDESTRIAN BRIDGE DESIGN",
      "Project Manager for Fire Services-Renovations to Fire Station and Logistics Building",
      "(RFQ) 27-23, Engineering and Design Services for Gardner Road Bridge",
      "Pre-Advertisement Notice for Maintenance of Permeable Pavers",
      "RFP 26-113 Aquatic Maintenance Services - 2027",
      "Swimming Pool Maintenance, Cleaning, And Repair (O&M) Services",
      "2026-142-ITB Concrete Meter Vault (Three Year Multiyear Contract)",
      "Construction Engineering Inspection (CEI) Services for US 278 Grade Separation over CSX Railroad",
      // From the nationwide check of the new phrases (2026-11-08).
      "Professional Services for Borregas Ave Storm Drain Rehabilitation",
      "Water Main Replacement Program 2028 Design",
    ]) expect(`${strong(t)} | ${t}`).toBe(`false | ${t}`);
  });
  test("design-build stays a construction match", () => {
    for (const t of ["Atlanta Speedway Airport – Design/Build Hangar", "Design Build for Dumpster Enclosure @ 90 Hansell Street"])
      expect(`${strong(t)} | ${t}`).toBe(`true | ${t}`);
  });
});
