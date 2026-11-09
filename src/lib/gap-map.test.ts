import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildGapMap, isGapState, money, stateTradeHref, topOpenings, type GapStateInput } from "./gap-map";

const row = (state: string, spend: number, holders: number, setAsideSpend = spend * 0.2, ending12 = 5): GapStateInput => ({
  state, spend, setAsideSpend, holders, ending12, ending12Value: 0, topAgencies: [],
});

describe("opportunity gap map", () => {
  const map = buildGapMap([
    row("VA", 100e6, 10), // big, $10M per holder → opening
    row("TX", 120e6, 120), // big, $1M per holder → crowded
    row("MD", 90e6, 5), // big, $18M per holder → opening
    row("WY", 2e6, 1), // small market
    row("CA", 80e6, 160), // below the median spend → small
    row("GU", 50e6, 1), // territory: left out
    row("NV", 0, 0), // no spending: left out
  ]);

  test("labels: big spending + few holders = opening; many holders = crowded; low spending = small", () => {
    const by = Object.fromEntries(map.map((s) => [s.state, s.label]));
    expect(by).toEqual({ VA: "opening", TX: "crowded", MD: "opening", WY: "small", CA: "small" });
  });

  test("territories and zero-spending rows are left out", () => {
    expect(map.map((s) => s.state).sort()).toEqual(["CA", "MD", "TX", "VA", "WY"]);
    expect(isGapState("GU")).toBe(false);
    expect(isGapState("DC")).toBe(true);
  });

  test("openings rank first; spend per holder drives the score", () => {
    expect(topOpenings(map).map((s) => s.state)).toEqual(["MD", "VA"]);
    expect(map.find((s) => s.state === "MD")!.score).toBeGreaterThan(map.find((s) => s.state === "TX")!.score);
  });

  test("among big-spending states, about half are openings and half crowded", () => {
    const big = Array.from({ length: 10 }, (_, i) => row(`S${i}`, 100e6, 10 + i * 10));
    const codes = ["VA", "TX", "MD", "CA", "NY", "FL", "GA", "NC", "PA", "OH"];
    const labelled = buildGapMap(big.map((r, i) => ({ ...r, state: codes[i] })).concat([row("WY", 1e6, 1), row("VT", 1e6, 1)]));
    const n = (l: string) => labelled.filter((s) => s.label === l).length;
    expect(n("opening")).toBe(5);
    expect(n("crowded")).toBe(5);
    expect(n("small")).toBe(2);
  });

  test("small-business share is clamped and computed", () => {
    const [s] = buildGapMap([row("OH", 10e6, 2, 30e6)]);
    expect(s.setAsideShare).toBe(1);
  });

  test("links and money", () => {
    expect(stateTradeHref("NC", "janitorial")).toBe("/contracts-in/north-carolina/janitorial");
    expect(money(1_684_000_000)).toBe("$1.7B");
    expect(money(40_500_000)).toBe("$40.5M");
    expect(money(250_000_000)).toBe("$250M");
    expect(money(52_000)).toBe("$52K");
  });
});

test("the gap map page is linked from the contract map and the recompetes page, and in the sitemap", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  expect(read("../routes/map.tsx")).toContain('href="/gap-map"');
  expect(read("../routes/recompetes.tsx")).toContain('href="/gap-map"');
  expect(read("../../scripts/generate-sitemap.mjs")).toContain('["/gap-map", "weekly", "0.6"]');
  expect(read("../routes/gap-map.tsx")).toContain("county figures are not available from this source");
});
