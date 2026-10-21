import { describe, expect, test } from "bun:test";

import { displayPlaceOfPerformance } from "./location-state";

describe("displayPlaceOfPerformance: lowercase words are never state codes", () => {
  test('"Buildings in and around…" is not Indiana', () => {
    expect(
      displayPlaceOfPerformance(
        "Commercial Custodial Services",
        "Multiple Buildings in and around Capital Square in Downtown, Richmond, Virginia.",
        "Department of General Services",
      ),
    ).toBe("Virginia");
  });

  test("real capital state codes still read as places", () => {
    expect(displayPlaceOfPerformance("Janitorial Services, Wilmington DE", null, null)).toBe("Wilmington, DE");
    expect(displayPlaceOfPerformance("x", "Hardin County, OH", null)).toBe("Hardin County, OH");
    expect(displayPlaceOfPerformance("x", "Norfolk, VA", null)).toBe("Norfolk, VA");
  });
});
