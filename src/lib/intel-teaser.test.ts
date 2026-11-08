import { describe, expect, test } from "bun:test";
import { intelTeaser, recompeteLine } from "./intel-teaser";

// Owner 2026-11-08: blurred incumbent/pricing teaser on bid pages, with re-compete timing.
const NOW = Date.parse("2026-11-08T12:00:00Z");
const history = [
  { fiscal_year: 2024, total_obligated: 120000, award_count: 1 },
  { fiscal_year: 2025, total_obligated: 0, award_count: 0 },
  { fiscal_year: 2026, total_obligated: 90000, award_count: 2 },
];

describe("intel teaser", () => {
  test("end year, re-compete soon, history years; never a name or amount", () => {
    const t = intelTeaser({ pop_end_date: "2027-09-30", historical_pricing: history }, NOW);
    expect(t).toEqual({ endYear: 2027, recompeteSoon: true, ended: false, historyYears: 2 });
    expect(JSON.stringify(t)).not.toMatch(/120000|90000/);
  });
  test("far-off, past and missing end dates", () => {
    expect(intelTeaser({ pop_end_date: "2030-01-01", historical_pricing: [] }, NOW)).toMatchObject({ endYear: 2030, recompeteSoon: false, ended: false });
    expect(intelTeaser({ pop_end_date: "2025-06-30", historical_pricing: [] }, NOW)).toMatchObject({ endYear: 2025, recompeteSoon: false, ended: true });
    expect(intelTeaser({ pop_end_date: null, historical_pricing: history }, NOW)).toMatchObject({ endYear: null, recompeteSoon: false, historyYears: 2 });
    expect(intelTeaser(null, NOW)).toEqual({ endYear: null, recompeteSoon: false, ended: false, historyYears: 0 });
  });
  test("the paid re-compete line", () => {
    expect(recompeteLine("2027-09-30", NOW)).toBe("The current contract ends Sep 2027: this work is likely to be re-bid before then.");
    expect(recompeteLine("2030-01-01", NOW)).toBe("The current contract runs to Jan 2030.");
    expect(recompeteLine("2025-06-30", NOW)).toBe("The prior contract ended Jun 2025.");
    expect(recompeteLine(null, NOW)).toBeNull();
  });
});
