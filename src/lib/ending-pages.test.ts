import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ENDING_FREE_BIDS, ENDING_FREE_ROWS, ENDING_MIN_CONTRACTS, ENDING_STATES, ENDING_TRADES,
  endingDescription, endingIndexable, endingMarket, endingPath, endingTitle, endingYears, fullSlice, publicSlice,
} from "./ending-pages";
import type { ReportData } from "./pipeline-report-data.server";
import { isPublicSsrCacheable } from "./ssr-cache-policy";

// Owner 2026-11-14: "Scale Programmatic 'Expiring Contract' SEO Pages" — six trades in every
// state, the top 5 contracts, the price range and 2 open bids in the open, the rest gated.
const row = (i: number) => ({ award_key: `k${i}`, award_id: `a${i}`, recipient_name: `Co ${i}`, amount: 1000 * (30 - i), end_date: "2027-02-01", agency: "GSA", sub_agency: null, description: "", naics_code: "561720" });
const report = (n: number): ReportData => ({
  state: "VA", stateName: "Virginia", trade: "janitorial", tradeLabel: "Janitorial", months: 12, asOf: "2026-11-14", until: "2027-11-14",
  totals: { n, total: 5_000_000, holders: 9 }, priceRange: { low: 40_000, median: 120_000, high: 600_000 },
  byAgency: Array.from({ length: 12 }, (_, i) => ({ agency: `Agency ${i}`, n: 2, total: 1000 })), byMonth: [],
  largest: Array.from({ length: Math.min(n, 25) }, (_, i) => row(i)),
  holders: [{ recipient_name: "Co 0", n: 3, total: 9000, hasPlan: true }],
  openBids: Array.from({ length: 5 }, (_, i) => ({ id: i, title: `Janitorial ${i}`, agency: null, due: "2026-12-20" })),
});

test("six trades in 50 states and DC, one address per market", () => {
  expect(ENDING_TRADES.length).toBe(6);
  expect(ENDING_STATES.length).toBe(51);
  expect(endingPath("New York", "hvac")).toBe("/contracts-ending/new-york/hvac");
  expect(endingMarket("virginia", "janitorial")).toMatchObject({ code: "VA", stateName: "Virginia", tradeLabel: "Janitorial" });
  // The 2-letter code, a trade outside the six and a made-up state have no page.
  expect(endingMarket("va", "janitorial")).toBeNull();
  expect(endingMarket("virginia", "trucking")).toBeNull();
  expect(endingMarket("atlantis", "hvac")).toBeNull();
});

test("a visitor is sent 5 contracts and 2 bids; holders and the agency list never leave the server", () => {
  const p = publicSlice(report(40));
  expect(p.top.length).toBe(ENDING_FREE_ROWS);
  expect(p.more).toBe(20);
  expect(p.openBids.length).toBe(ENDING_FREE_BIDS);
  expect(p.agencies).toBe(12);
  const sent = JSON.stringify(p);
  expect(sent).not.toContain("Agency 3");
  expect(sent).not.toContain("hasPlan");
  expect(sent).not.toContain("Co 7");
  const full = fullSlice(report(40));
  expect(full.largest.length).toBe(25);
  expect(full.byAgency.length).toBe(10);
});

test("thin markets stay out of search; titles say federal and carry the years", () => {
  expect(endingIndexable(publicSlice(report(ENDING_MIN_CONTRACTS)))).toBe(true);
  expect(endingIndexable(publicSlice(report(ENDING_MIN_CONTRACTS - 1)))).toBe(false);
  expect(endingIndexable(null)).toBe(false);
  const m = endingMarket("virginia", "janitorial")!;
  expect(endingTitle(m, publicSlice(report(40)))).toBe("Expiring Federal Janitorial Contracts in Virginia (2026-2027) | Contrax");
  expect(endingYears("2027-01-02", "2027-12-30")).toBe("2027");
  expect(endingDescription(m, publicSlice(report(40)))).toContain("40 federal janitorial contracts in Virginia");
  // Federal records only: the page never calls these municipal or commercial.
  const page = readFileSync("src/routes/contracts-ending/$state.$trade.tsx", "utf8").toLowerCase();
  for (const w of ["municipal", "commercial"]) expect(page).not.toContain(w);
});

test("the page offers both doors, the list needs an account, and the pages are cached and mapped", () => {
  const page = readFileSync("src/routes/contracts-ending/$state.$trade.tsx", "utf8");
  expect(page).toContain("Create a free account");
  expect(page).toContain("Pipeline Snapshot · {REPORT_PRICE} once");
  expect(page).toContain("publicSlice(await reportData(");
  const api = readFileSync("src/routes/api/ending-list.ts", "utf8");
  expect(api.indexOf("status: 401")).toBeLessThan(api.indexOf("reportData("));
  expect(isPublicSsrCacheable("GET", "/contracts-ending/virginia/janitorial")).toBe(true);
  expect(isPublicSsrCacheable("GET", "/contracts-ending/new-york/it-services?full=1")).toBe(true);
  expect(isPublicSsrCacheable("GET", "/contracts-ending")).toBe(true);
  expect(isPublicSsrCacheable("GET", "/contracts-ending/virginia")).toBe(false);
  expect(isPublicSsrCacheable("GET", "/api/ending-list")).toBe(false);
  const map = readFileSync("scripts/generate-sitemap.mjs", "utf8");
  expect(map).toContain(`const ENDING_TRADES = ${JSON.stringify([...ENDING_TRADES]).replace(/,/g, ", ")};`);
  expect(map).toContain(`const ENDING_MIN_CONTRACTS = ${ENDING_MIN_CONTRACTS};`);
  expect(map).toContain("...endingBlocks,");
  expect(readFileSync("src/components/FederalTradeFacts.tsx", "utf8")).toContain("endingPath(stateName, tradeSlug)");
});
