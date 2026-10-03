import { describe, expect, test } from "bun:test";
import { stateFromGeoHeaders, withTimeout } from "./radar-geo";

describe("Radar visitor-state default", () => {
  test("US region code becomes the state", () => {
    expect(stateFromGeoHeaders("US", "CO")).toBe("CO");
    expect(stateFromGeoHeaders("us", "nc")).toBe("NC");
  });

  test("outside the US, or unknown region, means nationwide", () => {
    expect(stateFromGeoHeaders("CA", "ON")).toBe("");
    expect(stateFromGeoHeaders("US", "")).toBe("");
    expect(stateFromGeoHeaders(null, "CO")).toBe("");
    expect(stateFromGeoHeaders("US", "ZZ")).toBe("");
  });

  test("a slow or failing lookup never blocks", async () => {
    expect(await withTimeout(new Promise(() => {}), 10)).toBe("");
    expect(await withTimeout(Promise.reject(new Error("x")), 10)).toBe("");
    expect(await withTimeout(Promise.resolve("CO"), 50)).toBe("CO");
  });
});
