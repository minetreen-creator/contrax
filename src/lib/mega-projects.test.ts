import { describe, expect, test } from "bun:test";
import { AGENCY_BY_SLUG } from "~/lib/local-agencies";
import { MEGA_PROJECTS, MEGA_PROJECT_BY_SLUG, megaProjectHref, nearbyAgencies } from "~/lib/mega-projects";

describe("mega-project registry", () => {
  test("slugs are unique and URL-safe", () => {
    const slugs = MEGA_PROJECTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("every nearby buyer resolves in the local registry", () => {
    for (const p of MEGA_PROJECTS) {
      for (const s of p.nearbyAgencySlugs) expect(AGENCY_BY_SLUG[s]).toBeDefined();
      expect(nearbyAgencies(p).length).toBe(p.nearbyAgencySlugs.length);
    }
  });

  test("every project cites at least one https source and a check date", () => {
    for (const p of MEGA_PROJECTS) {
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) expect(s.url.startsWith("https://")).toBe(true);
      expect(p.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("Lilly Goochland lists Goochland County's bids and leaves the GC unnamed", () => {
    const lilly = MEGA_PROJECT_BY_SLUG["eli-lilly-goochland-va"];
    expect(lilly.generalContractor).toBeNull();
    expect(nearbyAgencies(lilly).map((a) => a.agencyName)).toContain("Goochland County Government");
    expect(megaProjectHref(lilly)).toBe("/mega-projects/eli-lilly-goochland-va");
  });

  test("statewide buyers are exact eVA names and stay out of the local registry", () => {
    const lilly = MEGA_PROJECT_BY_SLUG["eli-lilly-goochland-va"];
    expect(lilly.statewideAgencies.map((a) => a.agencyName)).toEqual(["Virginia Department of Transportation"]);
    for (const p of MEGA_PROJECTS) {
      for (const a of p.statewideAgencies) {
        expect(a.source).toBe("va_eva");
        expect(AGENCY_BY_SLUG[a.slug]).toBeUndefined();
        expect(p.nearbyAgencySlugs).not.toContain(a.slug);
      }
    }
  });
});
