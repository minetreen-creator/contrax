import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { RELATED_SEO_TRADES, SEO_TRADES, SEO_TRADE_BY_SLUG, radarHrefFor } from "~/lib/seo-trades";
import { expandTrade } from "~/lib/trade-registry";
import { filterBidsToState, type SeoBid } from "~/lib/seo-landing";

const bid = (id: number, location: string | null, agency: string | null, due: string | null): SeoBid => ({
  id,
  title: `Bid ${id}`,
  agency,
  description: null,
  due_date: due,
  estimated_value: null,
  naics_code: null,
  location,
  set_aside: null,
  source_url: null,
});

describe("state + trade SEO pages", () => {
  test("every trade has a unique URL slug and expands to real Radar search terms", () => {
    expect(new Set(SEO_TRADES.map((t) => t.slug)).size).toBe(SEO_TRADES.length);
    for (const t of SEO_TRADES) {
      expect(t.slug).toMatch(/^[a-z-]+$/);
      expect(SEO_TRADE_BY_SLUG[t.slug]).toBe(t);
      expect(expandTrade(t.radarTerm).terms.length).toBeGreaterThan(0);
    }
  });

  test("waste hauling has its own pages on the existing 562111 trade, linked both ways with trucking", () => {
    const waste = SEO_TRADE_BY_SLUG["waste-hauling"];
    expect(waste.label).toBe("Waste and trash hauling");
    const e = expandTrade(waste.radarTerm);
    expect(e.naicsCodes).toEqual(["562111"]);
    for (const t of ["waste collection", "trash", "garbage", "refuse"]) expect(e.terms).toContain(t);
    // trucking itself stays freight-only
    const truck = expandTrade(SEO_TRADE_BY_SLUG["trucking"].radarTerm);
    for (const t of ["waste", "trash", "garbage", "debris", "moving services"]) expect(truck.terms).not.toContain(t);
    expect(RELATED_SEO_TRADES["trucking"]).toBe("waste-hauling");
    expect(RELATED_SEO_TRADES["waste-hauling"]).toBe("trucking");
    for (const [a, b] of Object.entries(RELATED_SEO_TRADES)) {
      expect(SEO_TRADE_BY_SLUG[a]).toBeDefined();
      expect(SEO_TRADE_BY_SLUG[b]).toBeDefined();
    }
  });

  test("the Radar link matches the homepage search (cert, size=any, trade, state)", () => {
    const href = radarHrefFor(SEO_TRADE_BY_SLUG["janitorial"], "VA");
    const params = new URL(href, "https://x").searchParams;
    expect(new URL(href, "https://x").pathname).toBe("/radar");
    expect(params.get("cert")).toBe("sdvosb");
    expect(params.get("size")).toBe("any");
    expect(params.get("trade")).toBe("janitorial");
    expect(params.get("state")).toBe("VA");
    expect(new URL(radarHrefFor(SEO_TRADE_BY_SLUG["trucking"], null), "https://x").searchParams.has("state")).toBe(false);
  });

  test("filterBidsToState keeps only that state's bids, soonest deadline first", () => {
    const rows = [
      bid(1, "Richmond, VA", null, "2026-11-01"),
      bid(2, "Austin, TX", null, "2026-10-05"),
      bid(3, "Norfolk, Virginia", null, "2026-10-10"),
      bid(4, null, "Virginia Department of Transportation", "2026-10-20"),
      bid(5, "Richmond, VA", null, null),
    ];
    const out = filterBidsToState(rows, "VA");
    expect(out.map((b) => b.id)).toEqual([3, 4, 1, 5]);
  });

  test("the sitemap generator lists product pages and state + trade pages", () => {
    const script = readFileSync(new URL("../scripts/generate-sitemap.mjs", import.meta.url), "utf8");
    for (const p of ["/radar", "/bid-scout", "/bid-fit-review", "/grants"]) {
      expect(script).toContain(`["${p}",`);
    }
    expect(script).toContain("SEO_TRADES");
    expect(script).toContain("...tradeBlocks,");
    const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
    for (const p of ["/radar", "/bid-scout", "/bid-fit-review", "/grants"]) {
      expect(sitemap).toContain(`<loc>https://www.contrax.company${p}</loc>`);
    }
  });
});
