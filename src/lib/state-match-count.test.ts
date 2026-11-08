import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { splitByGeography } from "./radar-candidates";

// Owner 2026-11-08: Massachusetts janitorial read 5 on the state page (where ChatGPT sent a visitor),
// 4 in Radar and 8 on the share link. The real rows from that check:
const rows = [
  { id: 1212263, location: "Massachusetts", agency: "Veritas Preparatory Charter School" },
  { id: 1454355, location: "Massachusetts", agency: "Massachusetts Purchasing Group (BidNet Direct)" },
  { id: 1503365, location: "Massachusetts", agency: "Town of Northborough" },
  { id: 1617346, location: "Massachusetts", agency: "Massachusetts Purchasing Group (BidNet Direct)" },
  // Federal jobs whose only place is "United States" (Missouri, Mississippi, New Mexico, Nebraska in their titles).
  { id: 903330, location: "United States", agency: "USDA-FS, CSA EAST 6" },
  { id: 1598546, location: "United States", agency: "USDA-FS, CSA EAST 2" },
  { id: 1473797, location: "United States", agency: "REGION 7: EMERGENCY PREPAREDNESS AN" },
  { id: 1426399, location: "United States", agency: "Nebraska National Forest" },
];

describe("one count everywhere", () => {
  test("a state count is the bids in that state; United-States-only rows are nationwide", () => {
    const { local, nationwide } = splitByGeography(rows, "MA");
    expect(local.map((r) => r.id)).toEqual([1212263, 1454355, 1503365, 1617346]);
    expect(nationwide).toHaveLength(4);
    expect(splitByGeography(rows, "").local).toHaveLength(8);
  });

  test("the share link, the state page and Radar's headline all use it", () => {
    const share = readFileSync(new URL("../routes/r.$trade.$state.ts", import.meta.url), "utf8");
    expect(share).toContain("const { local: rows } = await stateRadarMatches(");
    const seo = readFileSync(new URL("./seo-landing.tsx", import.meta.url), "utf8");
    expect(seo).toContain("await stateRadarMatches(sql, { trade: trade!.radarTerm, state: code! })");
    const radar = readFileSync(new URL("../routes/radar.tsx", import.meta.url), "utf8");
    expect(radar).toContain("open bids in ${STATE_NAMES[state] ?? state}${nationwideMatches ? ` (+${nationwideMatches} nationwide)` : \"\"}");
  });
});
