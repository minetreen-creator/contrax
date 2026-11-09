import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-09 (Search Console "Crawled - currently not indexed"): 4,730 FAR clause pages and
// 53 set-aside x NAICS pages were most of the list and brought 4 visitors each in 60 days. They
// stay live but leave the sitemap, so Google's crawl goes to bid, state and city pages.
test("the main sitemap leaves out per-clause and set-aside x NAICS pages", () => {
  const xml = readFileSync(new URL("../../public/sitemap.xml", import.meta.url), "utf8");
  expect(xml).not.toContain("https://www.contrax.company/clauses/");
  expect(xml).not.toContain("https://www.contrax.company/opportunities/");
  expect(xml).toContain("<loc>https://www.contrax.company/clauses</loc>");
  expect(xml).toContain("<loc>https://www.contrax.company/radar</loc>");
  const script = readFileSync(new URL("../../scripts/generate-sitemap.mjs", import.meta.url), "utf8");
  expect(script).toContain('loc.includes("/opportunities/") ||');
  expect(script).not.toContain("...clauseBlocks,");
  expect(script).not.toContain("...partBlocks,");
});

test("bid and city pages keep their own live sitemaps", () => {
  const robots = readFileSync(new URL("../../public/robots.txt", import.meta.url), "utf8");
  expect(robots).toContain("Sitemap: https://www.contrax.company/sitemap-bids.xml");
  expect(robots).toContain("Sitemap: https://www.contrax.company/sitemap-local.xml");
});
