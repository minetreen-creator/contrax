import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pickRegionBids, REGION_RECENT_BIDS, regionBreadcrumbLd } from "./seo-landing";

// Owner 2026-11-11 (traffic work): a state page described and counted its bids but linked to none,
// so neither a visitor nor a search engine could get from it to a bid.
test("a state page lists its newest open bids, one per title, newest first", () => {
  const rows = [
    { id: 3, title: "Roof Replacement at City Hall", agency: "City of Austin", due_date: "2026-12-01T00:00:00Z" },
    { id: 2, title: "roof replacement at city hall", agency: "City of Austin", due_date: null }, // reposted: same title
    { id: 1, title: "  ", agency: null, due_date: null },
    { id: 4, title: "Custodial Services", agency: null, due_date: null },
  ];
  expect(pickRegionBids(rows)).toEqual([
    { id: 3, title: "Roof Replacement at City Hall", agency: "City of Austin", due_date: "2026-12-01T00:00:00.000Z" },
    { id: 4, title: "Custodial Services", agency: null, due_date: null },
  ]);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: i, title: `Distinct bid title number ${i}`, agency: null, due_date: null }));
  expect(pickRegionBids(many)).toHaveLength(REGION_RECENT_BIDS);
  expect(REGION_RECENT_BIDS).toBe(25);
});

test("the list links to each bid page and never carries the notice link", () => {
  const src = readFileSync("src/lib/seo-landing.tsx", "utf8");
  const loader = src.slice(src.indexOf("export const getRegionData"), src.indexOf("// ─── Server fn: /contracts-in/{state}/{trade}"));
  expect(loader).toContain("SELECT id, title, agency, due_date FROM bids");
  expect(loader).not.toContain("source_url");
  expect(loader).toContain("WHERE normalized_state = ${code}");
  expect(loader).toContain("list left out"); // a failure drops the list, not the page
  expect(src).toContain("Newest open bids in {name}");
  expect(src).toContain('trackEvent("region_recent_bid_click", data.code ?? "")');
});

test("state and trade pages carry a breadcrumb trail in structured data", () => {
  const st = regionBreadcrumbLd("North Carolina", null) as any;
  expect(st["@type"]).toBe("BreadcrumbList");
  expect(st.itemListElement.map((x: any) => x.item)).toEqual(["https://www.contrax.company/", "https://www.contrax.company/contracts-in/north-carolina"]);
  const tr = regionBreadcrumbLd("Texas", { slug: "janitorial", label: "Janitorial" }) as any;
  expect(tr.itemListElement[2]).toEqual({ "@type": "ListItem", position: 3, name: "Janitorial", item: "https://www.contrax.company/contracts-in/texas/janitorial" });
  expect(readFileSync("src/routes/contracts-in.$state_.$trade.tsx", "utf8")).toContain("regionBreadcrumbLd(data.name, { slug: data.trade.slug, label: data.trade.label })");
});
