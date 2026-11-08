import { describe, expect, test } from "bun:test";
import { mapCategory } from "./trade-classification";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-08 ("lets look at construction in VA"): open Virginia bids (eVA, BidNet
// Virginia, 2026-11-08 read) that are building work but Radar's construction search missed.
const construction = expandTrade("construction");
const strong = (t: string) => isStrongTradeMatch(t, null, null, null, construction);

describe("Virginia construction titles", () => {
  test("building work is a construction match and is filed Construction", () => {
    for (const t of [
      "Construct Solid Waste and Recycling Center",
      "RFQ - Renovate Ewell Hall",
      "Rehab Senior Home",
      "ITB 2702 Augusta Water Collection System Rehabilitation",
      "RFP-26-27-029-Sludge Press Rehabilitation Project",
      "Greensville Recoating and Repairs to Water Tank 799-10887-1284",
      "Atkinson Boulevard Sound Barrier Wall Repairs",
      "Old Town Pool Replacement",
      "Y--Scaffolding for Repair and Repoint Chalmette Monum",
      "Various Home Repair and Rehabilitation Services",
    ]) {
      expect(`${strong(t)} | ${t}`).toBe(`true | ${t}`);
      expect(`${mapCategory("", t, "")} | ${t}`).toBe(`Construction | ${t}`);
    }
  });
  test("HVAC, electrical, services, design and goods stay out", () => {
    for (const t of [
      "IFB 242-B5242-002, Forbes Hall Boiler Replacement",
      "Landstown High School Chiller and Cooling Tower Replacement",
      "Gathright Dam Motor Control Center Electrical Repairs in Covington, Virginia",
      "Swimming Pool Maintenance, Cleaning, And Repair (O&M) Services",
      "Elizabeth Vaughan Elementary School Architectural & Engineering Services for Construction Administration",
      "Equipment with operator - Bridge",
      "Custom Casework, Hardware, & Countertops - Furnish & Deliver Only (NO Installation)",
      "Engineering Services Bridge Inspections & Overweight Permits",
      "Point of Sale System Replacement",
      // Nationwide check of the new phrases (2026-11-08): a job posting and an admin contract.
      "HOUSING REHABILITATION SPECIALIST",
      "CDBG – Disaster Recovery Housing Rehabilitation And Reconstruction Program Administration Services",
    ]) expect(`${strong(t)} | ${t}`).toBe(`false | ${t}`);
  });
});
