import { describe, expect, test } from "bun:test";
import { HERO_COPY, QUICK_TRADES } from "~/components/HomeContractFinder";

// Owner 2026-10-29: English/Español switch on the homepage hero.
describe("homepage hero copy", () => {
  test("Spanish has every English line", () => {
    expect(Object.keys(HERO_COPY.es).sort()).toEqual(Object.keys(HERO_COPY.en).sort());
    expect(HERO_COPY.es.checks).toHaveLength(HERO_COPY.en.checks.length);
  });
  test("every quick-trade button has a Spanish label", () => {
    for (const t of QUICK_TRADES) expect(HERO_COPY.es.trades[t]).toBeTruthy();
  });
  test("the headline counts read naturally in both languages", () => {
    expect(HERO_COPY.en.titleCount("30,412")).toBe("30,412 government bids open right now.");
    expect(HERO_COPY.es.titleCount("30,412")).toBe("30,412 licitaciones del gobierno abiertas ahora.");
  });
});
