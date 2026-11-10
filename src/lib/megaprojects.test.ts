import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { featuredMegaprojects, MEGA_SECTORS, megaMoney, megaStateCounts, megaTotals, sortMegaprojects, type Megaproject } from "./megaprojects";
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

// The list the page loads (public/data/megaprojects.json).
const MEGAPROJECTS: Megaproject[] = JSON.parse(readFileSync(new URL("../../public/data/megaprojects.json", import.meta.url), "utf8"));

describe("megaprojects data", () => {
  test("no duplicates (owner 2026-10-25): one card per company + site", () => {
    const norm = (x: string) => x.toLowerCase().replace(/\b(inc|corp|corporation|co|llc|technology|the)\b/g, "").replace(/[^a-z0-9]/g, "");
    const seen = new Map<string, Megaproject>();
    for (const p of MEGAPROJECTS) {
      const site = `${norm(p.company)}|${norm(p.city)}|${p.state}`;
      const prior = seen.get(site);
      // Two projects at one site are allowed only when they're plainly different
      // (different name AND different amount), e.g. U.S. Steel's mill and iron plant.
      if (prior) {
        expect(norm(prior.project)).not.toBe(norm(p.project));
        expect(prior.amount).not.toBe(p.amount);
      }
      seen.set(site, p);
    }
    expect(MEGAPROJECTS.length).toBeGreaterThan(20);
  });
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

describe("homepage highlight and the 2026-11-07 additions", () => {
  test("newest entries lead the highlight; the 2026-11-07 projects are listed with their sources", () => {
    const top = featuredMegaprojects(MEGAPROJECTS, 4);
    expect(top).toHaveLength(4);
    const slugs = top.map((p) => p.slug);
    expect(slugs[0]).toBe("honda-ohio-assembly-oh");
    expect(slugs).toContain("modot-improve-i70-kingdom-city-warrenton-mo");
    const i70 = MEGAPROJECTS.find((p) => p.slug === "modot-improve-i70-kingdom-city-warrenton-mo")!;
    expect([i70.amount, i70.sector, i70.source.url]).toEqual([583000000, "infrastructure", "https://www.modot.org/node/99519"]);
    expect(MEGA_SECTORS.infrastructure.label).toBe("Highways & infrastructure");
    const xom = MEGAPROJECTS.find((p) => p.slug === "exxonmobil-project-holly-port-allen-la")!;
    expect([xom.amount, xom.jobs, xom.state]).toEqual([250000000, 45, "LA"]);
  });

  test("Honda's Ohio hybrid assembly plant (announced 2026-11-09) is listed with its source", () => {
    const h = MEGAPROJECTS.find((p) => p.slug === "honda-ohio-assembly-oh")!;
    expect([h.company, h.state, h.sector, h.amount, h.jobs]).toEqual(["Honda", "OH", "automotive", 3000000000, 2000]);
    expect(h.source.url).toBe("https://www.cnbc.com/2026/11/09/honda-to-invest-3-billion-in-new-vehicle-assembly-plant-in-ohio.html");
  });
});
