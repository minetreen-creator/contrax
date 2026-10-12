import { describe, expect, test } from "bun:test";
import { AWARD_TYPE_SOURCES, RETIRED_SOURCES, SOURCE_CLASSES } from "~/lib/source-class";
import {
  AGENCY_BY_SLUG,
  LOCAL_AGENCIES,
  LOCAL_PLACES,
  RESOLVED_AGENCIES,
  findPlace,
  placeHref,
  placesInState,
  agencyScope,
  agencyForRow,
} from "~/lib/local-agencies";
import { buildLocalSitemapXml } from "~/lib/local-sitemap";
import { closingWithinWeek } from "~/lib/local-landing";

describe("local agency registry", () => {
  test("every local opportunity source has an agency page", () => {
    const local = Object.entries(SOURCE_CLASSES)
      .filter(([label, r]) => r.class === "local" && r.recordType === "opportunity" && !RETIRED_SOURCES.has(label) && !AWARD_TYPE_SOURCES.has(label))
      .map(([label]) => label)
      .sort();
    expect(LOCAL_AGENCIES.filter((a) => !a.agencyName).map((a) => a.source).sort()).toEqual(local);
  });

  test("every entry resolves to a place and state", () => {
    expect(RESOLVED_AGENCIES.length).toBe(LOCAL_AGENCIES.length);
  });

  test("slugs are unique and URL-safe", () => {
    const slugs = LOCAL_AGENCIES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const p of LOCAL_PLACES) expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("Chicago groups the City, schools and Cook County buyers", () => {
    const chicago = findPlace("illinois", "chicago");
    expect(chicago?.agencies.map((a) => a.slug).sort()).toEqual([
      "chicago-public-schools",
      "city-of-chicago",
      "cook-county",
      "cook-county-health",
    ]);
    expect(placeHref(chicago!)).toBe("/bids-in/illinois/chicago");
  });

  test("Dallas page and agency resolve", () => {
    expect(findPlace("texas", "dallas")?.stateCode).toBe("TX");
    expect(AGENCY_BY_SLUG["city-of-dallas"]?.source).toBe("tx_dallas_bonfire");
    expect(findPlace("texas", "nowhere")).toBeNull();
  });

  test("placesInState lists only that state", () => {
    const va = placesInState("VA");
    expect(va.length).toBeGreaterThan(0);
    expect(va.every((p) => p.stateCode === "VA")).toBe(true);
    expect(placesInState("WY")).toEqual([]);
  });
});

describe("buyers inside a state portal", () => {
  test("Richmond groups its eVA buyers, matched by exact buyer name", () => {
    const rva = findPlace("virginia", "richmond");
    expect(rva?.agencies.map((a) => a.agencyName)).toEqual([
      "City of Richmond Government",
      "City of Richmond Schools",
      "Greater Richmond Transit Company",
      "Richmond Redevelopment Housing Authority",
    ]);
    expect(rva?.agencies.every((a) => a.source === "va_eva" && a.via)).toBe(true);
    expect(placeHref(rva!)).toBe("/bids-in/virginia/richmond");
  });

  test("every exact-name buyer sits on its own state's portal and resolves", () => {
    const named = LOCAL_AGENCIES.filter((a) => a.agencyName);
    expect(named.length).toBeGreaterThan(0);
    for (const a of named) {
      expect(SOURCE_CLASSES[a.source]?.scopeState).toBe(a.stateCode);
      expect(AGENCY_BY_SLUG[a.slug]?.placeSlug).toBeTruthy();
    }
  });

  test("agencyScope splits whole sources from exact buyer pairs", () => {
    const scope = agencyScope(findPlace("virginia", "richmond")!.agencies);
    expect(scope.sources).toEqual([]);
    expect(scope.pairSources.every((s) => s === "va_eva")).toBe(true);
    expect(scope.pairAgencies).toContain("City of Richmond Government");
    const chicago = agencyScope(findPlace("illinois", "chicago")!.agencies);
    expect(chicago.pairSources).toEqual([]);
    expect(chicago.sources.length).toBe(4);
  });

  test("agencyForRow matches the exact buyer only", () => {
    const all = LOCAL_AGENCIES;
    expect(agencyForRow(all, "va_eva", "City of Richmond Government")?.slug).toBe("city-of-richmond");
    expect(agencyForRow(all, "va_eva", "Virginia Department of Transportation")).toBeUndefined();
    expect(agencyForRow(all, "tx_dallas_bonfire", "Anything")?.slug).toBe("city-of-dallas");
  });
});

describe("local sitemap", () => {
  test("builds absolute URLs", () => {
    const xml = buildLocalSitemapXml(["/local-bids", "/agency/city-of-dallas"]);
    expect(xml).toContain("<loc>https://www.contrax.company/local-bids</loc>");
    expect(xml).toContain("<loc>https://www.contrax.company/agency/city-of-dallas</loc>");
    expect(xml.startsWith("<?xml")).toBe(true);
  });
});

describe("closingWithinWeek", () => {
  test("counts only deadlines in the next 7 days", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    const bid = (due: string | null) => ({ due_date: due }) as any;
    expect(
      closingWithinWeek([bid("2026-10-13T12:00:00Z"), bid("2026-10-19T11:00:00Z"), bid("2026-10-25T12:00:00Z"), bid(null)], now),
    ).toBe(2);
  });
});
