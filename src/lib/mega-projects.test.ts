import { describe, expect, test } from "bun:test";
import { AGENCY_BY_SLUG } from "~/lib/local-agencies";
import { MEGA_PROJECTS, MEGA_PROJECT_BY_SLUG, areaMention, megaProjectHref, nearbyAgencies } from "~/lib/mega-projects";

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
      for (const f of p.knownFirms) expect(f.sourceUrl.startsWith("https://")).toBe(true);
    }
  });

  test("Lilly Goochland lists Goochland County's bids and leaves the GC unnamed", () => {
    const lilly = MEGA_PROJECT_BY_SLUG["eli-lilly-goochland-va"];
    expect(lilly.generalContractor).toBeNull();
    expect(lilly.address).toContain("12575 West Creek Parkway");
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

describe("areaMention", () => {
  const terms = MEGA_PROJECT_BY_SLUG["eli-lilly-goochland-va"].areaTerms;
  const bid = (location: string | null, title = "Pavement repair", description: string | null = null) => ({ location, title, description });

  test("matches eVA's work location first, whole words, any case", () => {
    expect(areaMention(bid("Richmond District-GOOCHLAND County and Louisa County"), terms)).toEqual({ term: "Goochland", field: "location" });
    expect(areaMention(bid("Richmond District"), terms)).toEqual({ term: "Richmond District", field: "location" });
  });

  test("falls back to the title, then the description", () => {
    expect(areaMention(bid("Virginia", "Route 6 resurfacing, Goochland Co."), terms)?.field).toBe("title");
    expect(areaMention(bid("Virginia", "Bridge deck", "Work in the West Creek area"), terms)).toEqual({ term: "West Creek", field: "description" });
  });

  test("no match for other districts, partial words, or no terms", () => {
    expect(areaMention(bid("Lynchburg District-Charlote County and Buckingham County"), terms)).toBeNull();
    expect(areaMention(bid("Goochlandia"), terms)).toBeNull();
    expect(areaMention(bid("Goochland County"), [])).toBeNull();
  });
});

describe("Rappahannock General Hospital", () => {
  const rgh = MEGA_PROJECT_BY_SLUG["rappahannock-general-hospital-kilmarnock-va"];

  test("announced, contractor not named, earlier builders listed with sources", () => {
    expect(rgh.status).toBe("announced");
    expect(rgh.generalContractor).toBeNull();
    expect(rgh.knownFirms.map((f) => f.name)).toEqual(["W.M. Jordan Company", "Connemara Corporation"]);
    for (const f of rgh.knownFirms) expect(f.role).toContain("not yet named for this project");
    expect(rgh.knownFirmsHeading).toBe("Firms that built this hospital's earlier projects");
  });

  test("Westmoreland schools are the nearby buyer; VDOT bids naming the Northern Neck rank first", () => {
    expect(nearbyAgencies(rgh).map((a) => a.agencyName)).toEqual(["Westmoreland County Public Schools"]);
    const bid = (location: string) => ({ location, title: "Paving", description: null });
    expect(areaMention(bid("Fredericksburg District-Lancaster County and Northumberland County"), rgh.areaTerms)?.term).toBe("Lancaster");
    expect(areaMention(bid("Richmond District-Goochland County"), rgh.areaTerms)).toBeNull();
  });
});
