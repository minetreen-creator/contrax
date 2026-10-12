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
} from "~/lib/local-agencies";
import { buildLocalSitemapXml } from "~/lib/local-sitemap";
import { closingWithinWeek } from "~/lib/local-landing";

describe("local agency registry", () => {
  test("every local opportunity source has an agency page", () => {
    const local = Object.entries(SOURCE_CLASSES)
      .filter(([label, r]) => r.class === "local" && r.recordType === "opportunity" && !RETIRED_SOURCES.has(label) && !AWARD_TYPE_SOURCES.has(label))
      .map(([label]) => label)
      .sort();
    expect(LOCAL_AGENCIES.map((a) => a.source).sort()).toEqual(local);
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
