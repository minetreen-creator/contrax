import { describe, expect, test } from "bun:test";
import { publicPlace } from "./public-bid";

describe("publicPlace (owner 2026-11-23: show the county on list pages)", () => {
  test("a city buyer gives the city", () => {
    expect(publicPlace("City of Rock Hill", "South Carolina", "South Carolina")).toBe("Rock Hill, South Carolina");
    expect(publicPlace("Town of Surfside Beach", null, "South Carolina")).toBe("Surfside Beach, South Carolina");
  });
  test("a county buyer or county school district gives the county", () => {
    expect(publicPlace("Lancaster County", "South Carolina", "South Carolina")).toBe("Lancaster County, South Carolina");
    expect(publicPlace("Beaufort County School District", "SC", "South Carolina")).toBe("Beaufort County, South Carolina");
    expect(publicPlace("County of Henrico", "Virginia", "Virginia")).toBe("Henrico County, Virginia");
    expect(publicPlace("School Board Of Clay County", "Florida", "Florida")).toBe("Clay County, Florida");
    expect(publicPlace("New Hanover County Schools", "North Carolina", "North Carolina")).toBe("New Hanover County, North Carolina");
  });
  test("a location that already says more than the state is kept", () => {
    expect(publicPlace("City of Waycross", "Waycross, GA", "Georgia")).toBe("Waycross, GA");
  });
  test("state, federal and college buyers give nothing new", () => {
    expect(publicPlace("Georgia Department of Transportation", "Georgia", "Georgia")).toBe("Georgia");
    expect(publicPlace("Dept of the Army", null, null, "sam")).toBeNull();
    expect(publicPlace("Clemson University", "South Carolina", "South Carolina")).toBe("South Carolina");
  });
  test("a buyer with no city or county in its name keeps the state", () => {
    expect(publicPlace("Greenville Water", "South Carolina", "South Carolina")).toBe("South Carolina");
  });
});
