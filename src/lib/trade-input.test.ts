import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isKnownTrade, looksLikeAddress, notATradeLine } from "./trade-input";

// Owner 2026-11-03: a Houston visitor typed "6511East…" three times and a name
// once into the trade box (each "0 matches") before finding 25 landscaping bids.
describe("trade box input", () => {
  test("an address is caught before searching", () => {
    expect(looksLikeAddress("6511East Freeway")).toBe(true);
    expect(looksLikeAddress("6511 East Fwy, Houston")).toBe(true);
    expect(looksLikeAddress("123 Main St")).toBe(true);
  });
  test("trades and NAICS codes are never mistaken for an address", () => {
    expect(looksLikeAddress("561730")).toBe(false);
    expect(looksLikeAddress("Landscaping")).toBe(false);
    expect(looksLikeAddress("24 hour plumbing")).toBe(false);
  });
  test("known trades vs names", () => {
    expect(isKnownTrade("Mowing")).toBe(true);
    expect(isKnownTrade("561730")).toBe(true);
    expect(isKnownTrade("window washing")).toBe(true);
    expect(isKnownTrade("Matthew")).toBe(false);
    expect(notATradeLine("Matthew")).toBe('We don\'t know "Matthew" as a trade. Try one like mowing, HVAC, plumbing, roofing or janitorial.');
  });
  test("Radar and the homepage both use it", () => {
    const radar = readFileSync("src/routes/radar.tsx", "utf8");
    expect(radar).toContain("if (looksLikeAddress(trade)) {");
    expect(radar).toContain("notATradeLine(trade)");
    const home = readFileSync("src/components/HomeContractFinder.tsx", "utf8");
    expect(home).toContain("if (looksLikeAddress(answers.trade)) {");
    expect(home).toContain("notATradeLine(result.answers.trade)");
  });
});
