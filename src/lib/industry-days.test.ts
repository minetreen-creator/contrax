import { describe, expect, test } from "bun:test";
import { dedupeEvents, isIndustryDayTitle, stateCounts, type IndustryDayRow } from "./industry-days";

describe("isIndustryDayTitle", () => {
  test("event notices", () => {
    for (const t of [
      "Industry Day - Selma AL Flood Management Risk and Bank",
      "2026 Federal Contractor Summit Reverse Industry Day",
      "USACE Charleston Industry Engagement",
      "Small Business Outreach Event - Fort Bragg",
      "Matchmaking Session with Prime Contractors",
      "Vendor Day 2026",
      "Meet the Primes - Norfolk",
    ]) expect(isIndustryDayTitle(t)).toBe(true);
  });
  test("ordinary bids are not events", () => {
    for (const t of ["Janitorial Services - Parks & Recreation", "Industrial Building Roof Replacement", "Widening for Additional Lanes on Blake Bottom Rd", "Day Labor Services", null]) {
      expect(isIndustryDayTitle(t)).toBe(false);
    }
  });
});

const row = (over: Partial<IndustryDayRow>): IndustryDayRow => ({ id: 1, title: "Industry Day", agency: "USACE", location: null, state: "SC", date: "2026-11-19", url: null, ...over });

describe("grouping", () => {
  test("the same notice twice is one event", () => {
    const out = dedupeEvents([row({ id: 1 }), row({ id: 2, title: " industry day " }), row({ id: 3, agency: "USCG" })]);
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });
  test("state counts, busiest first", () => {
    expect(stateCounts([row({ state: "VA" }), row({ state: "SC" }), row({ state: "SC" }), row({ state: null })])).toEqual([
      { code: "SC", count: 2 },
      { code: "VA", count: 1 },
    ]);
  });
});
