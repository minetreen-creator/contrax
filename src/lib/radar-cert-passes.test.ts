import { describe, expect, test } from "bun:test";
import { radarCertPasses } from "./radar-candidates";

// Owner 2026-11-10: a Houston SDVOSB construction search showed 15 Texas bids while 356 were open
// to small businesses. A certified business is also a small business.
describe("Radar: a certified business sees what a small business sees, plus its own set-asides", () => {
  const local = "tx_bidnet"; // a city/county board that publishes no set-aside
  test("state and local bids with no set-aside are open to every certification", () => {
    for (const cert of ["sb", "sdvosb", "8a", "wosb", "hubzone"]) expect(radarCertPasses(null, local, cert)).toBe(true);
  });
  test("its own set-aside and small-business set-asides pass; other certifications' set-asides don't", () => {
    expect(radarCertPasses("SDVOSB", "sam_gov", "sdvosb")).toBe(true);
    expect(radarCertPasses("Small Business Set Aside - Total", "sam_gov", "sdvosb")).toBe(true);
    expect(radarCertPasses("8(a) Set-Aside", "sam_gov", "sdvosb")).toBe(false);
    expect(radarCertPasses("WOSB", "sam_gov", "8a")).toBe(false);
    expect(radarCertPasses("HUBZone", "sam_gov", "hubzone")).toBe(true);
    expect(radarCertPasses("SDVOSB", "sam_gov", "sb")).toBe(false);
  });
  test("federal notices with no set-aside stay in their own 'open to all' section, as before", () => {
    expect(radarCertPasses(null, "sam_gov", "sdvosb")).toBe(false);
    expect(radarCertPasses(null, "sam_gov", "sb")).toBe(false);
  });
});
