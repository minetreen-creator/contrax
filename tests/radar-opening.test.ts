import { describe, expect, test } from "bun:test";

import { radarOpening } from "~/routes/radar";

describe("radarOpening — Radar step-1 headline", () => {
  test("no deep link: SDVOSB-first copy that still welcomes other certifications", () => {
    const o = radarOpening({ trade: "", stateCode: "", cert: null });
    expect(o.headline).toContain("SDVOSB");
    expect(o.headline).toContain("first 3 matches are free");
    expect(o.intro).toContain("8(a), WOSB and HUBZone");
  });

  test("homepage search (cert + trade + state) names what was pre-filled", () => {
    const o = radarOpening({ trade: "janitorial", stateCode: "VA", cert: "sdvosb" });
    expect(o.headline).toBe("Your SDVOSB matches for janitorial work in Virginia");
    expect(o.intro).toContain("filled in what you picked on the homepage");
  });

  test("partial deep links read naturally", () => {
    expect(radarOpening({ trade: "", stateCode: "TX", cert: "sdvosb" }).headline).toBe(
      "Your SDVOSB matches in Texas",
    );
    expect(radarOpening({ trade: "trucking", stateCode: "", cert: "sdvosb" }).headline).toBe(
      "Your SDVOSB matches for trucking work",
    );
  });

  test("other certifications keep their own label", () => {
    expect(radarOpening({ trade: "IT services", stateCode: "", cert: "8a" }).headline).toBe(
      "Your 8(a) matches for IT services work",
    );
  });

  test("a cert-only link (no trade/state) keeps the default opening", () => {
    expect(radarOpening({ trade: "", stateCode: "", cert: "wosb" }).headline).toContain(
      "first 3 matches are free",
    );
  });

  test("no cert in the link: the headline names no certification (broad default scan)", () => {
    expect(radarOpening({ trade: "janitorial", stateCode: "VA", cert: null }).headline).toBe(
      "Your matches for janitorial work in Virginia",
    );
  });

  test("an over-long URL trade is capped", () => {
    const o = radarOpening({ trade: "x".repeat(500), stateCode: "", cert: "sdvosb" });
    expect(o.headline.length).toBeLessThan(120);
  });
});
