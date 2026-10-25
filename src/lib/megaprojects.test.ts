import { describe, expect, test } from "bun:test";
import { MEGAPROJECTS, MEGA_SECTORS, megaMoney, megaStateCounts, megaTotals, sortMegaprojects, type Megaproject } from "./megaprojects";
import { US_STATES } from "./states";

const base: Megaproject = {
  slug: "x",
  company: "X",
  project: "Plant",
  city: "Town",
  state: "TX",
  sector: "manufacturing",
  amount: null,
  amountNote: null,
  jobs: null,
  jobsNote: null,
  status: "announced",
  summary: "A plant.",
  generalContractor: null,
  supplierUrl: null,
  source: { name: "Source", url: "https://example.com" },
  checked: "2026-10-25",
};

describe("megaprojects helpers", () => {
  test("money", () => {
    expect(megaMoney(165e9)).toBe("$165 billion");
    expect(megaMoney(1.55e9)).toBe("$1.6 billion");
    expect(megaMoney(600e6)).toBe("$600 million");
    expect(megaMoney(225e6)).toBe("$225 million");
    expect(megaMoney(null)).toBeNull();
    expect(megaMoney(0)).toBeNull();
  });
  test("sort, state counts and totals", () => {
    const list = [
      { ...base, slug: "a", company: "B", amount: null, state: "AL" },
      { ...base, slug: "b", company: "A", amount: 600e6, jobs: 1500 },
      { ...base, slug: "c", company: "C", amount: 5e9, jobs: 7500, state: "GA" },
    ];
    expect(sortMegaprojects(list).map((p) => p.slug)).toEqual(["c", "b", "a"]);
    expect(megaStateCounts(list)).toEqual([
      { code: "AL", count: 1 },
      { code: "GA", count: 1 },
      { code: "TX", count: 1 },
    ]);
    expect(megaTotals(list)).toEqual({ projects: 3, amount: 5.6e9, jobs: 9000 });
  });
});

describe("megaprojects data", () => {
  test("every entry is complete and sourced", () => {
    const slugs = new Set<string>();
    for (const p of MEGAPROJECTS) {
      expect(slugs.has(p.slug)).toBe(false);
      slugs.add(p.slug);
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
      expect((US_STATES as readonly string[]).includes(p.state)).toBe(true);
      expect(MEGA_SECTORS[p.sector]).toBeTruthy();
      expect(p.source.url).toMatch(/^https:\/\//);
      if (p.supplierUrl) expect(p.supplierUrl.url).toMatch(/^https:\/\//);
      if (p.generalContractor?.url) expect(p.generalContractor.url).toMatch(/^https:\/\//);
      expect(p.checked).toMatch(/^2026-\d\d-\d\d$/);
      expect(p.summary.length).toBeGreaterThan(20);
      if (p.amount != null) expect(p.amount).toBeGreaterThan(1e6);
    }
  });
});
