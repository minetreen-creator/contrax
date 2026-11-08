import { describe, expect, test } from "bun:test";
import { mapCategory } from "./trade-classification";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-08 ("lets look at construction in PA"): open Pennsylvania bids (BidNet
// Pennsylvania, PennBid, eMarketplace, 2026-11-08 read) that Radar's construction search missed,
// and two it counted that are not construction jobs.
const construction = expandTrade("construction");
const strong = (t: string) => isStrongTradeMatch(t, null, null, null, construction);

describe("Pennsylvania construction titles", () => {
  test("building work is a construction match and is filed Construction", () => {
    for (const t of [
      "Cheyney University Ada S Georges Dining Hall - General",
      "Belmont Hills Fire Company Exterior Repairs",
      "Second Stage Final Clarifier Repairs Contract No. 2026-02",
      "Montgomery Park ADA Bathroom – Interior Improvement Project",
      "MARPLE TOWNSHIP LIBRARY IMPROVEMENTS",
      "South Market Street Stormwater Replacement",
      "Wayne Avenue Storm Improvements",
      "VOTER MACHINE WAREHOUSE ELEVATOR ADDITION (eDPW-111026) (RE-BID)",
      "Sinkhole Repairs",
      "North Main Street Trail Development Project",
      "Hazle Township Little League Recreational Building",
      "2027 Catch Basin and Inlet Replacement",
      "Replace Select Catch Basins",
      "Golden Age Manor First Floor Improvements and Accessible Front Entrance",
      "Contract for the Replacement of Fire-Rated Double Doors.2; Spec #53-11/26",
      "FCC Allenwood - Repair Ground & Elevated Water Tanks - FCC",
      "IN-1244 Stapleton Library Brick Shelf Repair",
    ]) {
      expect(`${strong(t)} | ${t}`).toBe(`true | ${t}`);
      expect(`${mapCategory("", t, "")} | ${t}`).toBe(`Construction | ${t}`);
    }
  });
  test("a construction match whose category label stays another trade (HVAC prime, prison wall)", () => {
    for (const t of ["USP Lewisburg - Repair Security Wall", "Lincoln University Hvac Upgrades To Thurgood Mar - GENERAL", "SATELLITE THERMAL PLANT CHILLER & COOLING TOWER UPGRADES - GENERAL"])
      expect(`${strong(t)} | ${t}`).toBe(`true | ${t}`);
  });
  test("other primes, contract extensions, services and goods stay out", () => {
    for (const t of [
      "Lincoln University Hvac Upgrades To Thurgood Mar - HVAC",
      "Lincoln University Hvac Upgrades To Thurgood Mar - ELECTRICAL",
      "HVAC UPGRADES AT LANDISVILLE MIDDLE SCHOOL - “Mechanical”",
      "CIO Multifunction Devices 6 Month Bridge",
      "Winter Maintenance Services for Road & Bridge District 4 & 5",
      "Snow Removal Services - General",
      "Engineering Services for the Earles Lane Culvert Replacement Project",
      "Construction Inspection Open-End for York County",
      "Green Roof Feasibility Study, Plan, Design and Implematnation",
      "Facility Maintenance Materials Itq",
      "Park Improvements Design Services",
      "Fire Extinguishers Maintenance Repair Services",
      // Goods, from the nationwide check of the new phrases.
      "Furnishing Precast Concrete Meter Manholes and Catch Basins",
      "Manhole Covers, Frames & Catch Basin Inlet Grates & Frames for Environmental Services",
    ]) expect(`${strong(t)} | ${t}`).toBe(`false | ${t}`);
  });
  test("real bridge jobs still match", () => {
    for (const t of ["US 62 Bridge over Prather Run", "Furnace Road Bridge", "Adjacent Box Beam Bridge Bundle"])
      expect(`${strong(t)} | ${t}`).toBe(`true | ${t}`);
  });
});
