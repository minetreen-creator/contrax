import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inferNaics } from "./naics-infer";
import { naicsCodeExpansion } from "./trade-registry";

// Owner 2026-11-08: a Texas 611310 (colleges and universities) search showed 22 "matches" that
// were roads near Texas A&M, cameras for the University of Houston, pickleball courts on College
// St. — "college"/"university" named the buyer or a street, not education work.
describe("NAICS 611310 means delivering instruction, not a university buyer", () => {
  test("buyer and street names no longer infer 611310", () => {
    for (const t of [
      "Texas A&M University Area Streets (Maria Ferrier Ave. to Mauermann Road) Phase 2 (2022 Bond)",
      "University of Houston Cullen Security Cameras FY27",
      "Construction of New Pickleball Courts Located at 6475 College St., Beaumont, Texas 77707",
      "Pool of Vendors for Temporary Services for Texas A&M University",
      "ELECTRICAL SERVICES AMARILLO COLLEGE CAMPUSES",
    ]) {
      expect(inferNaics(t, null)).not.toBe("611310");
    }
  });

  test("instruction still does", () => {
    expect(inferNaics("Dual Credit Instruction for High School Students", null)).toBe("611310");
    expect(inferNaics("Instructional Services for Degree Program Courses", null)).toBe("611310");
  });

  test("a 611310 Radar search no longer expands to bare college / university", () => {
    const terms = naicsCodeExpansion("611310")?.terms ?? [];
    expect(terms).not.toContain("college");
    expect(terms).not.toContain("university");
  });

  test("sync re-infers codes we guessed and never touches authoritative ones", () => {
    const runner = readFileSync(new URL("../jobs/runner.ts", import.meta.url), "utf8");
    expect(runner.split("WHEN bids.naics_code_source = 'inferred' THEN EXCLUDED.naics_code\n").length - 1).toBe(2);
    expect(runner.split("WHEN EXCLUDED.naics_code_source = 'authoritative' THEN EXCLUDED.naics_code\n").length - 1).toBe(2);
  });
});
