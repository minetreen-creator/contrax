import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  bidCanonicalUrl,
  bidSeoDescription,
  bidSeoTitle,
  buildBidSitemapXml,
  BID_SITEMAP_MAX_URLS,
  dueLabel,
  isBidIndexable,
  stateLandingPath,
  type BidSeoFields,
} from "~/lib/bid-seo";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const airport: BidSeoFields = {
  id: 9001,
  title: "Unarmed Security Guard and Patrol Services RFP FY27-800-02",
  agency: "Norfolk Airport Authority",
  location: "Norfolk Airport Authority, Norfolk Virginia",
  set_aside: null,
  due_date: "2026-10-12T14:00:00.000Z",
  description: "The Norfolk Airport Authority is seeking proposals for unarmed security guard and patrol services.",
};

describe("bid page SEO", () => {
  test("title names the bid, the buyer and the deadline", () => {
    expect(bidSeoTitle(airport)).toBe(
      "Unarmed Security Guard and Patrol Services RFP FY27-800-02 — Norfolk Airport Authority (due Oct 12, 2026) | Contrax",
    );
  });

  test("description is a single line under 160 characters", () => {
    const d = bidSeoDescription(airport);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).toContain("Unarmed Security Guard");
    expect(d.startsWith("Due Oct 12, 2026 · Norfolk Airport Authority. Unarmed Security Guard")).toBe(true);
    expect(d).not.toContain("\n");
  });

  test("open bids are indexable; closed ones are not", () => {
    expect(isBidIndexable(airport, NOW)).toBe(true);
    expect(isBidIndexable({ due_date: "2026-09-30T00:00:00Z" }, NOW)).toBe(false);
    expect(isBidIndexable({ due_date: null }, NOW)).toBe(true);
    expect(isBidIndexable(null, NOW)).toBe(false);
  });

  test("helpers", () => {
    expect(bidCanonicalUrl(9001)).toBe("https://www.contrax.company/bid/9001");
    expect(stateLandingPath("Virginia")).toBe("/contracts-in/virginia");
    expect(stateLandingPath("District of Columbia")).toBe("/contracts-in/district-of-columbia");
    expect(stateLandingPath(null)).toBeNull();
    expect(dueLabel("not a date")).toBeNull();
  });
});

describe("live bid sitemap", () => {
  test("lists each bid page with its date, and escapes nothing unsafe", () => {
    const xml = buildBidSitemapXml([
      { id: 1, lastmod: "2026-10-01T12:00:00Z" },
      { id: 2, lastmod: null },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<loc>https://www.contrax.company/bid/1</loc><lastmod>2026-10-01</lastmod>");
    expect(xml).toContain("<loc>https://www.contrax.company/bid/2</loc><changefreq>");
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
  });

  test("never exceeds the per-file URL limit", () => {
    const rows = Array.from({ length: BID_SITEMAP_MAX_URLS + 10 }, (_, i) => ({ id: i + 1, lastmod: null }));
    expect((buildBidSitemapXml(rows).match(/<url>/g) ?? []).length).toBe(BID_SITEMAP_MAX_URLS);
  });

  test("wiring: robots.txt lists it, the route reads open bids, the page is server-rendered", () => {
    const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    expect(read("public/robots.txt")).toContain("Sitemap: https://www.contrax.company/sitemap-bids.xml");
    const route = read("src/routes/sitemap-bids[.]xml.ts");
    expect(route).toContain('createFileRoute("/sitemap-bids.xml")');
    expect(route).toContain("WHERE due_date > NOW()");
    expect(route).toContain("status: 503");
    const page = read("src/routes/bid.$bidId.tsx");
    expect(page).toContain("loader: ({ params }) => getPublicBid(");
    expect(page).toContain("bidSeoTitle(bid)");
    expect(page).not.toContain("Loading solicitation");
    expect(read("src/lib/seo-landing.tsx")).toContain("href={`/bid/${b.id}`}");
  });
});
