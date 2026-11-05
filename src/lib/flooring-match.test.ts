import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch } from "./trade-registry";

// Owner 2026-11-04: a $5 flooring customer searched WA (6 matches), ID and MT →
// "we also may need more flooring jobs in that state".
const flooring = expandTrade("flooring")!;
const match = (t: string) => isStrongTradeMatch(t, "Construction", "", null, flooring);

describe("flooring searches", () => {
  test("a building's tiling package is flooring work", () => {
    expect(match("Vancouver Public Works Operations Campus - GMP - Tiling")).toBe(true);
    expect(match("Law Enforcement/Emergency Ops Center - FLOORING & TILING")).toBe(true);
    expect(match("Restroom Tile Installation")).toBe(true);
  });

  test("a trailer's walking floor and roof tile are not flooring", () => {
    expect(match("Keith Walking Floor Repairs and Parts")).toBe(false);
    expect(match("Roof Tiling Replacement")).toBe(false);
  });

  test("the existing flooring matches still match", () => {
    expect(match("Coroner's Interior Upgrades - Sheet Vinyl Floor Replacement")).toBe(true);
    expect(match("Vancouver Public Works Operations Campus - GMP - Resilient Flooring and Accessories")).toBe(true);
    expect(match("Carpet Cleaning Services")).toBe(false);
  });
});
