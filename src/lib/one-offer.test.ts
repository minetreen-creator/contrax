import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { passOfferCount } from "../routes/radar";

// Owner 2026-11-01: one offer everywhere, own count after signup, Max only, $5 bid button.
const read = (f: string) => readFileSync(f, "utf8");

describe("one offer", () => {
  test("pricing shows one card (Starter) and tucks the rest under Other plans", () => {
    const pricing = read("src/routes/pricing/index.tsx");
    expect(pricing).toContain('plans.filter((plan) => plan.slug === "starter").map((plan) => (');
    expect(pricing).toContain('<summary className="cursor-pointer font-semibold text-slate-700 hover:text-slate-900">Other plans</summary>');
    expect(pricing).toContain("Professional</a> ($79/month");
  });
  test("homepage and bid lock push no competing offer", () => {
    expect(read("src/routes/index.tsx")).not.toContain("<BidScoutCallout");
    const bid = read("src/routes/bid.$bidId.tsx");
    expect(bid).not.toContain("<FoundingSpotsLine");
    expect(read("src/components/BasicUpgradeBar.tsx")).not.toContain("<FoundingSpotsLine");
  });
  test("the bid lock's main button names the exact deal", () => {
    expect(read("src/routes/bid.$bidId.tsx")).toContain("Open this bid + every new one for 30 days: ${STARTER_FIRST_MONTH_PRICE}");
  });
});

describe("a signed-in free account sees its own count with the $5 offer", () => {
  test("Radar returns paidMember and the in-state count, and shows the banner only to free accounts", () => {
    const radar = read("src/routes/radar.tsx");
    expect(radar).toContain("paidMember: subscribed,");
    expect(radar).toContain("localMatched: state ? local.length : matches.length,");
    expect(radar).toContain("{!isAnonymous && scan.paidMember === false && (scan.localMatched ?? 0) > 0 && (");
  });
  test("counts read naturally", () => {
    expect(passOfferCount(23)).toBe("23");
    expect(passOfferCount(100)).toBe("100+");
  });
});

describe("one assistant, no live chat (owner 2026-11-01)", () => {
  test("neither the AI bubble nor the Say hi chat is mounted, and Mission Control has no Say hi", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).not.toContain("<ChatWidget");
    expect(root).not.toContain("<FounderChat");
    const live = read("src/routes/admin/live.tsx");
    expect(live).not.toContain("/> Say hi");
    expect(live).not.toContain("<ChatDrawer");
    expect(live).toContain("const openChat = openTrack;");
  });
  test("the offer names the trade without quotation marks", () => {
    expect(read("src/routes/radar.tsx")).toContain('tradeLabel(track).replace(/["“”]/g, "")');
  });
});

describe("parts orders are never a trade's strong match (owner 2026-11-01)", () => {
  test("a numeric-FSC SAM product listing is not an HVAC match; a lettered service notice still is", async () => {
    const { expandTrade, isStrongTradeMatch } = await import("./trade-registry");
    const hvac = expandTrade("HVAC");
    expect(isStrongTradeMatch("16--ACTUATOR,MECHANICAL,AI", null, null, null, hvac)).toBe(false);
    expect(isStrongTradeMatch("4120--AIR CONDITIONING UNIT", null, null, "238220", hvac)).toBe(false);
    expect(isStrongTradeMatch("J041--HVAC Preventive Maintenance", null, null, null, hvac)).toBe(true);
    expect(isStrongTradeMatch("Chiller and Ventilation Maintenance", null, null, "238220", hvac)).toBe(true);
  });
  test("signup no longer mentions a trial", () => {
    expect(read("src/routes/signup.tsx")).not.toContain("After the trial, free Basic");
  });
});

describe("top-match spot check fixes (owner 2026-11-01)", () => {
  test("titles with a trade's word that are not its work are not strong matches", async () => {
    const { expandTrade, isStrongTradeMatch } = await import("./trade-registry");
    const strong = (t: string, trade: string, naics: string | null = null) => isStrongTradeMatch(t, null, null, naics, expandTrade(trade));
    expect(strong("Kp (Kitchen Patrol) Services", "Security guards")).toBe(false);
    expect(strong("Unarmed Security Guard Services", "Security guards")).toBe(true);
    expect(strong("35K lb. Base Capacity 4-wheel Sit-Down AC Electric Lift Truck, including", "Trucking")).toBe(false);
    expect(strong("Purchase of Landscaping Flowers, Bulbs and Shrubs *222278", "Landscaping")).toBe(false);
    expect(strong("Landscape Maintenance Services", "Landscaping")).toBe(true);
    expect(strong("Replacement of 10 Ton HVAC Unit, Bldg.11", "HVAC")).toBe(true);
    expect(strong("2011 Freightliner Coronado", "Trucking")).toBe(false);
    expect(strong("Upfit of two (2) 2026 Freightliner 114SD Chassis into Fully Functional", "Trucking")).toBe(false);
    expect(strong("Front-End Load Solid Waste/Recycling Hauling and Disposal Services", "Trucking")).toBe(true);
    expect(strong("Lake Miccosukee Mechanical Muck Management", "HVAC")).toBe(false);
  });
  test("the free preview shows the searcher's own state first", () => {
    const radar = read("src/routes/radar.tsx");
    expect(radar).toContain("const previewPool = state && local.length ? [...local, ...nationwide] : matches;");
    expect(radar).toContain("previewPool.slice(0, FREE_ANONYMOUS_RADAR_RESULTS)");
  });
});

describe("head start: no promise of a free date (owner 2026-11-01)", () => {
  test("the lock and upgrade page no longer say when a bid opens for free accounts", () => {
    const lock = read("src/components/HeadStartLock.tsx");
    expect(lock).not.toContain("opens for free accounts on {opens}");
    expect(lock).not.toContain("free on {opens}");
    expect(lock).toContain("Open it today with Starter, $5 for 30 days");
    expect(read("src/routes/upgrade.tsx")).not.toContain("free accounts wait");
  });
});

describe("welding is a first-class trade (owner 2026-11-02)", () => {
  test("Welding expands to welding words and matches real welding work, not data 'fabrication'", async () => {
    const { expandTrade, isStrongTradeMatch } = await import("./trade-registry");
    const w = expandTrade("Welding");
    expect(w.terms).toContain("metal fabrication");
    expect(w.terms).not.toContain("fabrication");
    expect(w.naicsCodes).toContain("238120");
    expect(isStrongTradeMatch("Welding and Fabrication Services for Water Plant", null, null, null, w)).toBe(true);
    expect(isStrongTradeMatch("Structural Steel Repairs at Pump Station", null, null, null, w)).toBe(true);
    expect(isStrongTradeMatch("Data Fabrication Detection Software", null, null, null, w)).toBe(false);
    expect(isStrongTradeMatch("Welders and Guns for Livingston", null, null, null, w)).toBe(false);
    expect(isStrongTradeMatch("WELDING SUPPLIES & EQUIPMENT", null, null, null, w)).toBe(false);
    expect(isStrongTradeMatch("WELDING & METAL TRADE SUPPLIES", null, null, null, w)).toBe(false);
    expect(isStrongTradeMatch("YTC - Welding Expansion - Building D", null, null, null, w)).toBe(true);
    expect(isStrongTradeMatch("Aberdeen Test Center Welding, Machining, Painting, and Fabrication Services", null, null, null, w)).toBe(true);
  });
  test("Welding is a one-tap trade on the homepage (with Spanish) and Radar", async () => {
    const { QUICK_TRADES, HERO_COPY } = await import("../components/HomeContractFinder");
    expect(QUICK_TRADES).toContain("Welding");
    expect(HERO_COPY.es.trades.Welding).toBe("Soldadura");
    expect(read("src/routes/radar.tsx")).toContain('{ label: "Welding", q: "welding" },');
  });
});
