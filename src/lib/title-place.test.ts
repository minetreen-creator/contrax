import { describe, expect, test } from "bun:test";
import { titlePlace } from "./title-place";

describe("titlePlace", () => {
  test("reads City, ST from real federal titles", () => {
    expect(titlePlace("Janitorial Services Wichita, KS")).toBe("Wichita, KS");
    expect(titlePlace("S--Janitorial Services Rapid City, SD")).toBe("Rapid City, SD");
    expect(titlePlace("Janitorial Services at NWS in Sioux Falls, SD")).toBe("Sioux Falls, SD");
    expect(titlePlace("Janitorial Services for Richmond, VA (Base + 4)")).toBe("Richmond, VA");
  });
  test("reads a bare code only at the end and only when it is not a word", () => {
    expect(titlePlace("Janitorial Services Base+4 - Florence SC")).toBe("Florence, SC");
    expect(titlePlace("Custodial Services for the VA")).toBeNull();
    expect(titlePlace("Grounds Maintenance Phase IN")).toBeNull();
    expect(titlePlace("Window Cleaning Fort Bragg NC and annex")).toBeNull();
  });
  test("no state, a foreign place, or two states gives nothing", () => {
    expect(titlePlace("Pikes Peak Janitorial Base plus 4")).toBeNull();
    expect(titlePlace("Custodial Services at Aviano Air Base, Italy")).toBeNull();
    expect(titlePlace("Custodial Services for NE036 (MS: 003, 023, and 024)")).toBeNull();
    expect(titlePlace("Janitorial, Omaha, NE and Council Bluffs, IA")).toBeNull();
    expect(titlePlace("BARSTOW/DUMONT JANITORIAL SERVICES")).toBeNull();
    expect(titlePlace("")).toBeNull();
    expect(titlePlace(null)).toBeNull();
  });
  test("all-capitals titles do not turn words into states", () => {
    expect(titlePlace("REPAIR, OR REPLACE HVAC UNIT")).toBeNull();
    expect(titlePlace("JANITORIAL SERVICES KEY WEST, FL")).toBe("KEY WEST, FL");
  });
  test("a lower-case or made-up code is not a state", () => {
    expect(titlePlace("Cleaning, as required")).toBeNull();
    expect(titlePlace("Repair Unit, XX")).toBeNull();
  });
});
