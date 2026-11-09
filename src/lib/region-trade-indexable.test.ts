import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { regionTradeIndexable } from "./seo-landing";

// Owner 2026-11-09: Search Console "Excluded by 'noindex' tag". After the state count became
// in-state only (#1125), 72 /contracts-in/{state}/{trade} pages in the sitemap read 0 and turned
// noindex; 45 of them still had nationwide bids a business there can bid on.
const base = { code: "AL", trade: { slug: "janitorial", label: "Janitorial", radarTerm: "janitorial" }, count: 0, nationwideCount: 0, federal: null };

describe("state+trade page indexing", () => {
  test("indexable with in-state bids, nationwide bids, or federal facts", () => {
    expect(regionTradeIndexable({ ...base, count: 3 })).toBe(true);
    expect(regionTradeIndexable({ ...base, nationwideCount: 4 })).toBe(true);
    expect(regionTradeIndexable({ ...base, federal: { spending: null, ending: { count: 2, total: 1, rows: [] } } })).toBe(true);
  });

  test("noindex when there is nothing to show, or the state or trade is unknown", () => {
    expect(regionTradeIndexable(base)).toBe(false);
    expect(regionTradeIndexable({ ...base, federal: { spending: null, ending: { count: 0, total: 0, rows: [] } } })).toBe(false);
    expect(regionTradeIndexable({ ...base, code: null, count: 5 })).toBe(false);
    expect(regionTradeIndexable({ ...base, trade: null, count: 5 })).toBe(false);
    expect(regionTradeIndexable(null)).toBe(false);
  });

  test("the page uses the rule and lists nationwide bids when the state has none", () => {
    const route = readFileSync(new URL("../routes/contracts-in.$state_.$trade.tsx", import.meta.url), "utf8");
    expect(route).toContain("if (!regionTradeIndexable(loaderData)) {");
    const lib = readFileSync(new URL("./seo-landing.tsx", import.meta.url), "utf8");
    expect(lib).toContain("if (data.count === 0 && data.nationwide.length > 0) {");
    // The state count stays in-state only (one count everywhere).
    expect(lib).toContain("count: bids.length,");
  });

  test("privacy and terms are in the sitemap, so they are indexable", () => {
    const entry = readFileSync(new URL("../../vercel-entry.ts", import.meta.url), "utf8");
    expect(entry).not.toContain('<title>Privacy Policy — Contrax</title>\n<meta name="description" content="Contrax privacy policy — how we collect, use, and protect your data.">\n<meta name="robots" content="noindex');
    expect(entry.match(/<meta name="robots" content="index, follow">/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
