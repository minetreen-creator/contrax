import { describe, expect, test } from "bun:test";
import { mapCategory } from "~/lib/trade-classification";
import { expandTrade } from "~/lib/trade-registry";

// Owner 2026-11-05: Elite Labor (NC commercial cleaning) — "commercial cleaning and
// janitorial services ... floor care, carpet cleaning, window cleaning, high dusting,
// post-construction cleaning". Every phrasing below is filed Janitorial.
describe("janitorial: commercial cleaning phrasings", () => {
  const janitorial = [
    "Floor Stripping and Waxing",
    "Window Washing - Municipal Buildings",
    "Exterior Window Washing",
    "High Dusting Services",
    "Post-Construction Cleaning",
    "Construction Final Cleaning",
    "Retail Store Cleaning",
    "Pressure Washing Services",
    "Day Porter Services",
    "Carpet Shampooing",
    "Hard Floor Maintenance",
    "Restroom Cleaning",
    "Facility Cleaning",
    "Disinfection Services",
  ];
  for (const t of janitorial) test(t, () => expect(mapCategory("", t, "")).toBe("Janitorial"));

  const notJanitorial: [string, string][] = [
    ["UV Disinfection System Replacement", "Other"],
    ["Wastewater Disinfection Improvements", "Other"],
    ["Pressure Washer Purchase", "Other"],
    ["Floor Scrubber", "Other"],
    ["Window Replacement", "Other"],
    ["Carpet Replacement", "Construction"],
    ["Porter Ranch Road Construction", "Construction"],
    ["Duct Cleaning Services", "Other"],
    ["Custodial Supplies", "Other"],
    ["Facility Maintenance Services", "Other"],
  ];
  for (const [t, want] of notJanitorial) test(`not janitorial: ${t}`, () => expect(mapCategory("", t, "")).toBe(want));

  test("the Radar janitorial search includes the new phrases", () => {
    const terms = expandTrade("janitorial").terms;
    for (const t of ["high dusting", "floor stripping", "floor waxing", "floor maintenance", "carpet shampoo", "window washing", "post-construction cleaning"]) {
      expect(terms).toContain(t);
    }
  });
});
