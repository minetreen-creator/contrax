import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-04: a Seattle visitor searched "Flooring · WA" and got 6 matches.
const f = expandTrade("Flooring");
const strong = (t: string) => isStrongTradeMatch(t, null, null, null, f);

describe("flooring finds the jobs agencies post", () => {
  test("carpet, VCT/LVT, gym floors, epoxy and tile all match", () => {
    for (const t of [
      "Purchase and Install of Carpet at Frank Wing Building",
      "VCT Replacement - Elementary School",
      "LVT Flooring Installation, City Hall",
      "Gym Floor Refinishing",
      "Epoxy Floor Coating - Fire Station 3",
      "Ceramic Tile Replacement in Restrooms",
      "Flooring Replacement Project",
      "Carpet Tile for Library",
    ]) expect({ t, m: strong(t) }).toEqual({ t, m: true });
  });
  test("carpet and floor cleaning stay out; unrelated work stays out", () => {
    for (const t of ["Carpet Cleaning Services", "Floor Stripping and Waxing", "Janitorial Services", "Textile Recycling", "Roof Replacement"]) {
      expect({ t, m: strong(t) }).toEqual({ t, m: false });
    }
    expect(f.naicsCodes).toEqual(["238330"]);
  });
});
