import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { zeroStateOptions } from "./zero-results";

// Owner 2026-11-16: "what can we do to get more searches?"
test("a search that found nothing offers the trades that are open in that state, with real counts", () => {
  const data = { counts: { construction: 248, landscaping: 0, janitorial: 8, security: 3 } };
  expect(zeroStateOptions(data, "welding")).toEqual([
    { trade: "construction", label: "Construction", count: 248 },
    { trade: "janitorial", label: "Janitorial", count: 8 },
    { trade: "security guard", label: "Security guards", count: 3 },
  ]);
  // Never the trade that just found nothing, never an empty one, nothing before the counts load.
  expect(zeroStateOptions(data, "Security Guard").map((o) => o.trade)).toEqual(["construction", "janitorial"]);
  expect(zeroStateOptions({ counts: { construction: 0, landscaping: 0, janitorial: 0, security: 0 } }, "welding")).toEqual([]);
  expect(zeroStateOptions(null, "welding")).toEqual([]);
});

test("the options are the same trades the Bids-first panel counts", () => {
  const tabs = [...readFileSync("src/lib/bids-first.ts", "utf8").matchAll(/^  (\{ id: "[a-z]+", label: "[^"]+", trade: "[^"]+" \}),$/gm)].map((m) => m[1]);
  expect(tabs).toHaveLength(4);
  const src = readFileSync("src/lib/zero-results.ts", "utf8");
  for (const t of tabs) expect(src).toContain(t);
});

test("a search with no state reads as deep as a state search", () => {
  const q = readFileSync("src/lib/radar-scan-query.ts", "utf8");
  expect(q).toContain("export const NO_STATE_SCAN_LIMIT = 2000;");
  expect(q).toContain("if (!hint) return await nationwideQuery(NO_STATE_SCAN_LIMIT);");
  expect(q).toContain("(limit: number = NATIONWIDE_SIDE_LIMIT)");
});

test("the zero screen shows the panel and a tap runs that search in the same state", () => {
  const page = readFileSync("src/routes/radar.tsx", "utf8");
  expect(page).toContain("<ZeroOpenInState");
  expect(page).toContain('trackEvent("radar_zero_open_in_state", `${t}|${state}`);');
  expect(page).toContain("runScan({ trade: t, state, cert: cert ?? DEFAULT_RADAR_CERT, sizePref: sizePref ?? DEFAULT_RADAR_SIZE });");
});

test("a state-and-trade page lets the visitor search their own trade", async () => {
  const { landingSearchHref } = await import("./landing-search");
  expect(landingSearchHref("  Roofing  ", "IL")).toBe("/radar?cert=sdvosb&size=any&trade=Roofing&state=IL&source=landing_search");
  expect(landingSearchHref("parking lot  sweeping", "")).toBe("/radar?cert=sdvosb&size=any&trade=parking+lot+sweeping&source=landing_search");
  expect(landingSearchHref("r", "IL")).toBeNull();
  expect(landingSearchHref("", "IL")).toBeNull();
  const page = readFileSync("src/routes/contracts-in.$state_.$trade.tsx", "utf8");
  expect(page).toContain("<LandingSearch stateCode={data.code} tradeLabel={data.trade?.label} />");
  expect(page.indexOf("<RegionTradeView")).toBeLessThan(page.indexOf("<LandingSearch"));
  expect(readFileSync("src/components/LandingSearch.tsx", "utf8")).toContain('trackEvent("state_page_click", "landing_search")');
});
