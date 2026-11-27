import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { regionTradeDescription, regionTradeTitle } from "./region-trade-head";

// Owner 2026-11-27: the state and trade pages lead their search title with the real count.
test("the title leads with the page's own count and the month", () => {
  const d = { label: "Construction", name: "South Carolina", count: 77, generatedAt: "2026-11-27T18:00:00Z" };
  expect(regionTradeTitle(d)).toBe("77 Construction Bids Open in South Carolina (Nov 2026) | Contrax");
  expect(regionTradeTitle({ ...d, count: 1, label: "Janitorial", name: "Virginia" })).toBe("1 Janitorial Bid Open in Virginia (Nov 2026) | Contrax");
  expect(regionTradeTitle({ ...d, count: 1432, name: "Texas" })).toBe("1,432 Construction Bids Open in Texas (Nov 2026) | Contrax");
  expect(regionTradeTitle({ ...d, generatedAt: null })).toBe("77 Construction Bids Open in South Carolina | Contrax");
  // The month is the Eastern one: 3 AM UTC on December 1 is still November 30 in New York.
  expect(regionTradeTitle({ ...d, generatedAt: "2026-12-01T03:00:00Z" })).toContain("(Nov 2026)");
});

test("a page with no open bids claims no number", () => {
  const d = { label: "Security", name: "Vermont", count: 0, generatedAt: "2026-11-27T18:00:00Z" };
  expect(regionTradeTitle(d)).toBe("Security Bids in Vermont: Government Contracts | Contrax");
  expect(regionTradeDescription(d)).not.toMatch(/\d/);
});

test("the description states the count and the day, within what search results show", () => {
  const text = regionTradeDescription({ label: "Plumbing & Electrical", name: "North Carolina", count: 21, generatedAt: "2026-11-27T18:00:00Z" });
  expect(text.startsWith("21 open plumbing & electrical bids in North Carolina as of November 27:")).toBe(true);
  expect(text.length).toBeLessThanOrEqual(165);
  expect(regionTradeDescription({ label: "HVAC", name: "Ohio", count: 3, generatedAt: null })).toContain("3 open HVAC bids in Ohio:");
  expect(readFileSync("src/routes/contracts-in.$state_.$trade.tsx", "utf8")).toContain("regionTradeTitle({ label, name, count: loaderData?.count ?? 0");
});
