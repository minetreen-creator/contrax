import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expandTrade } from "./trade-registry";
import { NAICS_NAMES } from "./naics-names";

describe("Laundry/Linen trade (owner 2026-10-02)", () => {
  test("a 'Laundry services' search implies the three laundry/linen codes", () => {
    const e = expandTrade("Laundry services");
    expect(e.naicsCodes).toEqual(["812320", "812331", "812332"]);
    for (const t of ["laundry", "linen services", "linen supply", "uniform rental", "dry cleaning"]) {
      expect(e.terms).toContain(t);
    }
  });

  test("the codes are real NAICS names", () => {
    expect(NAICS_NAMES["812320"]).toBe("Drycleaning and Laundry Services (except Coin-Operated)");
    expect(NAICS_NAMES["812331"]).toBe("Linen Supply");
    expect(NAICS_NAMES["812332"]).toBe("Industrial Launderers");
  });

  test("laundry never bleeds into janitorial", () => {
    expect(expandTrade("janitorial").naicsCodes).not.toContain("812320");
    expect(expandTrade("laundry").naicsCodes).not.toContain("561720");
  });
});

describe("dashboard auto-scoring is capped (owner 2026-10-02)", () => {
  const src = readFileSync(join(import.meta.dir, "..", "routes", "dashboard.tsx"), "utf8");

  test("only the top 5 bids, each once per page load, never logged as a user score", () => {
    expect(src).toContain("const pending = bids.slice(0, 5).filter((b) => !scores[b.id] && !autoScoredRef.current.has(b.id));");
    expect(src).toContain("setTimeout(() => doScore(b.id, false, true), i * 350);");
    expect(src).toContain('if (!auto) trackEvent("score_result", String(bidId), "/dashboard");');
  });
});

describe("Radar match cap (owner 2026-10-02)", () => {
  test("a scan returns up to 25 default matches; the free preview stays 3", async () => {
    const { RADAR_MATCH_CAP, FREE_ANONYMOUS_RADAR_RESULTS } = await import("./radar-config");
    expect(RADAR_MATCH_CAP).toBe(25);
    expect(FREE_ANONYMOUS_RADAR_RESULTS).toBe(3);
    const radar = readFileSync(join(import.meta.dir, "..", "routes", "radar.tsx"), "utf8");
    expect(radar).toContain("const ranked = scored.filter((m) => m.strong).slice(0, RADAR_MATCH_CAP);");
    expect(radar).not.toContain(".filter((m) => m.strong).slice(0, 5)");
  });

  test("the signup handoff can carry every locked match id", () => {
    const handoff = readFileSync(join(import.meta.dir, "radar-handoff.server.ts"), "utf8");
    expect(handoff).toContain(".slice(0, 25)");
  });
});

describe("homepage SDVOSB sample: newest service bids (owner 2026-10-03)", () => {
  test("parts/supply listings are left out", async () => {
    const { isProductListingTitle } = await import("./sample-bids");
    expect(isProductListingTitle("59--ACCESSORY KIT,ELECTRON")).toBe(true);
    expect(isProductListingTitle("59--COUPLER,DIRECTIONAL")).toBe(true);
    expect(isProductListingTitle("S201--Janitorial Services l Chattanooga National Cemetery")).toBe(false);
    expect(isProductListingTitle("S218--Snow Removal Services Lebanon VAMC")).toBe(false);
    expect(isProductListingTitle("AMENDMENT 0003 UNARMED SECURITY SERVICES JESSE BRWON VAMC AND CBOCS")).toBe(false);
  });

  test("the query sorts newest first and excludes numeric-FSC titles", () => {
    const src = readFileSync(join(import.meta.dir, "sample-bids.ts"), "utf8");
    expect(src).toContain("ORDER BY created_at DESC NULLS LAST, id DESC");
    expect(src).toContain("AND title !~ '^[[:space:]]*[0-9]{2}--'");
    expect(src).not.toContain("ORDER BY due_date ASC");
  });
});

describe("Radar card fixes (owner 2026-10-03)", () => {
  test("uniform/linen cleaning is laundry, not a strong janitorial match", async () => {
    const { isSpecialtyCleaningOnly, isJanitorialWork } = await import("./trade-classification");
    const { isStrongTradeMatch } = await import("./trade-registry");
    const title = "REPOST - Uniform Cleaning Services";
    expect(isSpecialtyCleaningOnly(title.toLowerCase())).toBe(true);
    expect(isJanitorialWork(title.toLowerCase(), title.toLowerCase())).toBe(false);
    expect(isStrongTradeMatch(title, "Janitorial", null, null, expandTrade("janitorial"))).toBe(false);
    // Genuine custodial contracts keep their match.
    expect(isStrongTradeMatch("Janitorial Services - Building 12", "Janitorial", null, null, expandTrade("janitorial"))).toBe(true);
    expect(isStrongTradeMatch("Custodial and Linen Service for Clinic", null, null, null, expandTrade("janitorial"))).toBe(true);
  });

  test("the nationwide badge is spelled correctly", () => {
    const radar = readFileSync(join(import.meta.dir, "..", "routes", "radar.tsx"), "utf8");
    expect(radar).not.toMatch(/>\s*nationalwide\s*</);
    expect(radar).toMatch(/>\s*nationwide\s*</);
  });

  test("next action names SAM.gov only for SAM.gov links", async () => {
    const { buildNextAction, isSamGovUrl } = await import("~/routes/radar");
    const sam = buildNextAction({ due_date: null, source_url: "https://sam.gov/opp/abc/view" });
    const eva = buildNextAction({ due_date: null, source_url: "https://mvendor.cgieva.com/Vendor/public/IVDetails.jsp?x=1" });
    expect(sam).toContain("on SAM.gov");
    expect(eva).not.toContain("SAM.gov");
    expect(eva).toContain("Open the original notice to confirm all requirements.");
    expect(isSamGovUrl("https://www.sam.gov/x")).toBe(true);
    expect(isSamGovUrl("https://sam.gov.evil.io/x")).toBe(false);
  });
});
