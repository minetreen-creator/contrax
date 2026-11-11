import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HAMPTON_ROADS_MARKET, MARKETS, PARTNER_MONTHLY_FEE, PARTNER_TERMS, PARTNER_TRIAL_DAYS, SAN_ANTONIO_MARKET, SAN_DIEGO_MARKET, TAMPA_MARKET, inMarket, marketBySlug, marketPitchPath } from "./markets";
import { isTampaBay } from "./tampa";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// Owner 2026-11-10: "replicate this model in other major construction markets" -> "then do 1-4".
describe("Contractor Support Network markets", () => {
  test("four markets; only Tampa has a partner (no partner is listed before one signs)", () => {
    expect(MARKETS.map((m) => m.slug)).toEqual(["tampa", "hampton-roads", "san-diego", "san-antonio"]);
    expect(MARKETS.filter((m) => m.partner).map((m) => m.partner!.name)).toEqual(["Casa Blue Collar"]);
    expect(TAMPA_MARKET.path).toBe("/tampa-contractors");
    expect(marketBySlug("san-diego")?.path).toBe("/markets/san-diego");
    expect(marketPitchPath(HAMPTON_ROADS_MARKET)).toBe("/markets/hampton-roads/partners");
  });

  test("Tampa matching is unchanged by the move to the template", () => {
    for (const [loc, agency] of [["Tampa, FL", "City of Tampa"], ["Idaho", "NEZ PERCE-CLEARWATER NFS"], ["Key Largo, FL", "BASE MIAMI BEACH"], ["Pasco, WA", "City of Pasco"], ["MacDill AFB, FL", "DLA ENERGY"]] as const) {
      expect(inMarket(TAMPA_MARKET, loc, agency)).toBe(isTampaBay(loc, agency));
    }
  });

  test("each market keeps look-alikes out", () => {
    expect(inMarket(HAMPTON_ROADS_MARKET, "Norfolk, VA", "NAVFAC Mid-Atlantic")).toBe(true);
    expect(inMarket(HAMPTON_ROADS_MARKET, "Portsmouth, NH", "Portsmouth Naval Shipyard")).toBe(false);
    expect(inMarket(HAMPTON_ROADS_MARKET, "Norfolk, NE", "City of Norfolk")).toBe(false);
    expect(inMarket(SAN_DIEGO_MARKET, "San Diego, CA", "NAVFAC Southwest")).toBe(true);
    expect(inMarket(SAN_DIEGO_MARKET, "San Marcos, TX", "City of San Marcos")).toBe(false);
    expect(inMarket(SAN_ANTONIO_MARKET, "San Antonio, TX", "City of San Antonio")).toBe(true);
    expect(inMarket(SAN_ANTONIO_MARKET, "Randolph County, NC", "Randolph County")).toBe(false);
  });

  test("the federal numbers carry their source and date; ending counts say 'at least'", () => {
    for (const m of MARKETS) {
      expect(m.facts.asOf).toContain("FY2026");
      expect(m.facts.source.length).toBeGreaterThan(10);
      expect(m.facts.topBuyers.length).toBeGreaterThan(0);
    }
    expect(read("../components/MarketPage.tsx")).toContain("At least {f.endingSoonCount} contracts");
  });

  test("pages: Tampa on the template, market pages, index, pitch page (noindex), admin report", () => {
    expect(read("../routes/tampa-contractors.tsx")).toContain("<MarketPage market={TAMPA_MARKET}");
    expect(read("../routes/markets.$slug.tsx")).toContain("<MarketPage market={m}");
    const pitch = read("../routes/markets.$slug_.partners.tsx");
    expect(pitch).toContain('{ name: "robots", content: "noindex" }');
    expect(pitch).toContain("How it's going in Tampa");
    expect(read("../components/MarketPage.tsx")).toContain("See what a partner gets →");
    expect(read("../routes/admin/partners.tsx")).toContain("if (!user.is_admin) throw redirect");
    const map = read("../../scripts/generate-sitemap.mjs");
    for (const p of ["/markets", "/markets/hampton-roads", "/markets/san-diego", "/markets/san-antonio"]) expect(map).toContain(`["${p}", `);
  });

  // Owner 2026-11-11: the pitch said "a trial period first, then a simple referral arrangement", with
  // no price, so a yes brought a partner and no money. The terms are stated once and shown on the page.
  test("the partner pitch states the trial and the monthly fee", () => {
    expect([PARTNER_TRIAL_DAYS, PARTNER_MONTHLY_FEE]).toEqual([60, 99]);
    expect(PARTNER_TERMS).toBe("A 60-day trial at no cost. After that it is $99 a month for each market, month to month, and only if it is working for you. No long contract.");
    const pitch = read("../routes/markets.$slug_.partners.tsx");
    expect(pitch).toContain("{PARTNER_TERMS}");
    expect(pitch).toContain("How it starts and what it costs");
    expect(pitch).not.toContain("referral arrangement");
  });
});
