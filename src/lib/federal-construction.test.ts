import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FEDERAL_CONSTRUCTION_PATH, FEDERAL_CONSTRUCTION_ROWS, bigDollars, federalConstructionStates, federalConstructionTotals } from "./federal-construction";

describe("federal construction by state", () => {
  test("covers 50 states and DC once each, with sane numbers", () => {
    expect(FEDERAL_CONSTRUCTION_ROWS.length).toBe(51);
    expect(new Set(FEDERAL_CONSTRUCTION_ROWS.map((r) => r[0])).size).toBe(51);
    for (const [, awards, dollars, outAwards, outDollars] of FEDERAL_CONSTRUCTION_ROWS) {
      expect(outAwards).toBeLessThanOrEqual(awards);
      expect(outDollars).toBeLessThanOrEqual(dollars);
      expect(dollars).toBeGreaterThan(0);
    }
  });

  test("national totals match the published figures", () => {
    const t = federalConstructionTotals();
    expect(t.awards).toBe(11646);
    expect(bigDollars(t.dollars)).toBe("$39.6 billion");
    expect(bigDollars(t.outDollars)).toBe("$24.7 billion");
    expect(t.outShare).toBe(62);
    expect(t.outAwardShare).toBe(49);
  });

  test("ranks by out-of-state share, highest first", () => {
    const s = federalConstructionStates();
    expect(s[0].code).toBe("DE");
    expect(s[0].outShare).toBe(98);
    expect(s[s.length - 1].code).toBe("HI");
    expect(s.find((x) => x.code === "NC")).toMatchObject({ outShare: 70, rank: 19, slug: "north-carolina" });
    expect(s.find((x) => x.code === "SC")).toMatchObject({ outShare: 78, rank: 16 });
    expect(s.find((x) => x.code === "DC")?.slug).toBe("district-of-columbia");
  });

  test("the page is in the sitemap", () => {
    const sitemap = readFileSync(new URL("../../scripts/generate-sitemap.mjs", import.meta.url), "utf8");
    expect(sitemap).toContain(`"${FEDERAL_CONSTRUCTION_PATH}"`);
  });
});

describe("a winners page per state", () => {
  test("every state has a page address and three largest contracts", async () => {
    const { federalConstructionStateBySlug, federalWinnersStateHref, FEDERAL_WINNERS_STATE_PATH } = await import("./federal-construction");
    const { FEDERAL_CONSTRUCTION_TOP } = await import("./federal-construction-top");
    const states = federalConstructionStates();
    expect(Object.keys(FEDERAL_CONSTRUCTION_TOP)).toHaveLength(states.length);
    for (const s of states) {
      expect(federalConstructionStateBySlug(s.slug)?.code).toBe(s.code);
      const top = FEDERAL_CONSTRUCTION_TOP[s.code];
      expect(top).toHaveLength(3);
      // Largest first, and no single contract is larger than the state's total.
      expect(top[0][2]).toBeGreaterThanOrEqual(top[1][2]);
      expect(top[1][2]).toBeGreaterThanOrEqual(top[2][2]);
      expect(top[0][2]).toBeLessThanOrEqual(s.dollars);
    }
    expect(federalWinnersStateHref("north-carolina")).toBe("/federal-construction-winners/north-carolina");
    expect(federalConstructionStateBySlug("NORTH-CAROLINA")?.code).toBe("NC");
    expect(federalConstructionStateBySlug("atlantis")).toBeNull();
    const sitemap = readFileSync(new URL("../../scripts/generate-sitemap.mjs", import.meta.url), "utf8");
    expect(sitemap).toContain(`${FEDERAL_WINNERS_STATE_PATH}/\${slug}`);
  });
});

