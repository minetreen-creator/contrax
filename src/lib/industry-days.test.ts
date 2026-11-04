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
  test("the same notice twice is one event, whatever the agency is called", () => {
    const out = dedupeEvents([
      row({ id: 1, title: "USACE New Orleans Industry Day 2026", agency: "USACE" }),
      row({ id: 2, title: "USACE  New Orleans Industry Day 2026 ", agency: "W07V ENDIST NEW ORLEANS" }),
      row({ id: 3, title: "USACE New Orleans Industry Day 2026", date: "2026-12-01" }),
    ]);
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });
  test("a re-post with extra words in front of the same title is the same event (owner 2026-11-04)", () => {
    const out = dedupeEvents([
      row({ id: 1, title: "Ticket Release dates: 9/23 & 10/7; SAVE THE DATE: FY27 Naval Surface Warfare Center Phil Div (NSWCPD) Hybrid Industry Day", date: "2026-11-05" }),
      row({ id: 2, title: "SAVE THE DATE: FY27 Naval Surface Warfare Center Phil Div (NSWCPD) Hybrid Industry Day", date: "2026-11-05" }),
      // A different date is a different event.
      row({ id: 3, title: "Ticket Release dates: 9/23 & 10/7; SAVE THE DATE: FY27 Naval Surface Warfare Center Phil Div (NSWCPD) Hybrid Industry Day", date: "2026-12-05" }),
      // A short common title never swallows a longer, different event.
      row({ id: 4, title: "Industry Day", date: "2026-11-05" }),
      row({ id: 5, title: "Fort Bragg Industry Day", date: "2026-11-05" }),
    ]);
    expect(out.map((r) => r.id)).toEqual([2, 3, 4, 5]);
  });
  test("state counts, busiest first", () => {
    expect(stateCounts([row({ state: "VA" }), row({ state: "SC" }), row({ state: "SC" }), row({ state: null })])).toEqual([
      { code: "SC", count: 2 },
      { code: "VA", count: 1 },
    ]);
  });
});
