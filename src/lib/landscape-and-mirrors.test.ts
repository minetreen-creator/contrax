import { describe, expect, test } from "bun:test";
import { inferNaics, isFigurativeLandscapeOnly } from "./naics-infer";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";
import { collapseAggregatorMirrors, isAggregatorMirror } from "./notice-dedupe";

// Owner 2026-10-31: Virginia landscaping results showed a biology research bid
// and BidNet copies of agency listings.
const HUBBLE = "High-throughput Unmasking of Biological Interactomes with Binding Landscape Emulators (HUBBLE)";

describe("figurative 'landscape' is not landscaping", () => {
  test("research/market phrasing is figurative; real grounds work is not", () => {
    expect(isFigurativeLandscapeOnly(HUBBLE)).toBe(true);
    expect(isFigurativeLandscapeOnly("Cyber Threat Landscape Assessment")).toBe(true);
    expect(isFigurativeLandscapeOnly("Landscape Maintenance for Various Neighborhood Parcels")).toBe(false);
    expect(isFigurativeLandscapeOnly("Competitive landscape study and lawn mowing services")).toBe(false);
    expect(isFigurativeLandscapeOnly("Grounds Maintenance and Snow Removal")).toBe(false);
  });
  test("inference no longer labels HUBBLE 561730; real landscaping still infers", () => {
    expect(inferNaics(HUBBLE, null)).not.toBe("561730");
    expect(inferNaics("Landscape Maintenance for Various Neighborhood Parcels", null)).toBe("561730");
  });
  test("Radar's strong match drops HUBBLE even with a stored 561730", () => {
    const exp = expandTrade("Landscaping");
    expect(isStrongTradeMatch(HUBBLE, null, null, "561730", exp)).toBe(false);
    expect(isStrongTradeMatch("Landscape Maintenance for Various Neighborhood Parcels", null, null, null, exp)).toBe(true);
  });
});

describe("BidNet mirrors of agency listings collapse", () => {
  const agency = { id: 1, title: "Route 301 Caroline Tree Trimming", agency: "Virginia Department of Transportation", source: "va_eva", due_date: "2026-11-02T21:00:00Z" };
  const mirror = { id: 2, title: "Route 301 Caroline Tree Trimming", agency: "Virginia & DC Purchasing Group (BidNet Direct)", source: "va_bidnet", due_date: "2026-11-03T21:00:00Z" };
  const lakeAgency = { id: 3, title: "Grounds maintenance services at four boat landings at Smith Mountain Lake", agency: "Virginia Department of Wildlife Resources", source: "va_eva", due_date: "2026-11-12T20:00:00Z" };
  const lakeMirror = { id: 4, title: "Grounds maintenance services at four boat landings at Smith Mountain", agency: "Virginia & DC Purchasing Group (BidNet Direct)", source: "va_bidnet", due_date: "2026-11-13T20:00:00Z" };
  const bidnetOnly = { id: 5, title: "Turf Mowing Patriot Centre and CCBC", agency: "Virginia & DC Purchasing Group (BidNet Direct)", source: "va_bidnet", due_date: "2026-11-20T20:00:00Z" };
  const laterRebid = { id: 6, title: "Route 301 Caroline Tree Trimming", agency: "Virginia & DC Purchasing Group (BidNet Direct)", source: "va_bidnet", due_date: "2026-12-15T21:00:00Z" };

  test("keeps the agency row, drops its mirror (exact or truncated title, due within 2 days)", () => {
    const { rows, collapsed } = collapseAggregatorMirrors([mirror, agency, lakeMirror, lakeAgency, bidnetOnly, laterRebid]);
    expect(rows.map((r) => r.id)).toEqual([1, 3, 5, 6]);
    expect(collapsed).toBe(2);
  });
  test("detects aggregator rows by agency label or source", () => {
    expect(isAggregatorMirror(mirror)).toBe(true);
    expect(isAggregatorMirror(agency)).toBe(false);
  });
});
