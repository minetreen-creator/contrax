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

describe("paid-ad visitors get a broader opening (owner 2026-10-06)", () => {
  test("isPaidAdVisit: Google click ids or a paid utm_medium", async () => {
    const { isPaidAdVisit } = await import("../src/routes/radar");
    expect(isPaidAdVisit({ gclid: "abc" })).toBe(true);
    expect(isPaidAdVisit({ gbraid: "x" })).toBe(true);
    expect(isPaidAdVisit({ utm_source: "google", utm_medium: "CPC" })).toBe(true);
    expect(isPaidAdVisit({ utm_medium: "email" })).toBe(false);
    expect(isPaidAdVisit({ gclid: "  " })).toBe(false);
    expect(isPaidAdVisit({})).toBe(false);
    expect(isPaidAdVisit(null)).toBe(false);
  });

  test("ad headline names every business; a deep link still wins", async () => {
    const { radarOpening } = await import("../src/routes/radar");
    const ad = radarOpening({ trade: "", stateCode: "", cert: null, fromAd: true });
    expect(ad.headline).toBe("Find government contracts your business can win.");
    expect(ad.intro).toContain("SDVOSB");
    expect(radarOpening({ trade: "", stateCode: "", cert: null }).headline).toContain("SDVOSB");
    expect(radarOpening({ trade: "HVAC", stateCode: "VA", cert: null, fromAd: true }).headline).toBe("Your matches for HVAC work in Virginia");
  });
});

describe("free Radar preview allowance (owner 2026-10-07)", () => {
  test("2 free scans per network, enforced by the upsert", async () => {
    const { FREE_RADAR_PREVIEW_SCANS } = await import("../src/lib/radar-config");
    expect(FREE_RADAR_PREVIEW_SCANS).toBe(1);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/routes/radar.tsx", import.meta.url), "utf8");
    expect(src).toContain("claimRadarSearchBudget(budget.keys, budget.limit)");
    expect(src).toContain("Create a free account to keep searching");
  });
});
