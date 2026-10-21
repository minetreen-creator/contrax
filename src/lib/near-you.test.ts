import { describe, expect, test } from "bun:test";

import { NEAR_YOU_TRADES, nearYouRadarHref } from "./near-you";

describe("near-you links", () => {
  test("each trade chip opens Radar with the state, the trade and the source", () => {
    const url = new URL(nearYouRadarHref("OH", "HVAC"), "https://www.contrax.company");
    expect(url.pathname).toBe("/radar");
    expect(url.searchParams.get("state")).toBe("OH");
    expect(url.searchParams.get("trade")).toBe("HVAC");
    expect(url.searchParams.get("source")).toBe("near_you");
    expect(new URL(nearYouRadarHref("TX"), "https://x.test").searchParams.has("trade")).toBe(false);
  });

  test("the chips are the same seven trades as the Radar first screen", () => {
    expect([...NEAR_YOU_TRADES]).toEqual(["Janitorial", "Landscaping", "Construction", "HVAC", "Trucking", "Security guards", "IT services"]);
  });
});
