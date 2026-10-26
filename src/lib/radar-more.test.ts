import { describe, expect, test } from "bun:test";
import { NEIGHBOR_STATES, neighborStates, recompeteTradeFor, wantsRadarMore } from "./radar-more";

describe("radar more options", () => {
  test("borders are symmetric", () => {
    for (const [s, list] of Object.entries(NEIGHBOR_STATES)) for (const n of list) expect(NEIGHBOR_STATES[n]).toContain(s);
  });
  test("every state and DC is listed", () => {
    expect(Object.keys(NEIGHBOR_STATES).length).toBe(51);
    expect(neighborStates("va")).toContain("NC");
    expect(neighborStates("ZZ")).toEqual([]);
  });
  test("shows only for thin state searches", () => {
    expect(wantsRadarMore(0, "VA")).toBe(true);
    expect(wantsRadarMore(3, "VA")).toBe(true);
    expect(wantsRadarMore(4, "VA")).toBe(false);
    expect(wantsRadarMore(0, "")).toBe(false);
  });
  test("maps free-text trades to rebid data", () => {
    expect(recompeteTradeFor("Commercial cleaning")).toBe("janitorial");
    expect(recompeteTradeFor("Roofing")).toBe("construction");
    expect(recompeteTradeFor("HVAC repair")).toBe("hvac");
    expect(recompeteTradeFor("Lawn care")).toBe("landscaping");
    expect(recompeteTradeFor("Catering")).toBe(null);
  });
});
