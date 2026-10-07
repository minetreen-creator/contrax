/**
 * City of Milwaukee Bonfire tenant (`wi_milwaukee_bonfire`, owner 2026-10-07).
 * Registration and config only — the shared Bonfire reader is covered against
 * real captured payloads in tx-bonfire.test.ts. No fixture is pinned here because
 * the tenant could not be reached from the dev sandbox; nothing is invented.
 */
import { describe, expect, test } from "bun:test";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { bonfireDataUrl } from "./bonfire-public";
import { WI_MILWAUKEE_BONFIRE_CONFIG, WI_MILWAUKEE_BONFIRE_SOURCE } from "./wi-milwaukee-bonfire";

describe("wi_milwaukee_bonfire", () => {
  test("reads only the City of Milwaukee tenant", () => {
    expect(bonfireDataUrl(WI_MILWAUKEE_BONFIRE_CONFIG)).toBe(
      "https://cityofmilwaukee.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData",
    );
    expect(WI_MILWAUKEE_BONFIRE_CONFIG.idPrefix).toBe("milwaukeebonfire");
    expect(WI_MILWAUKEE_BONFIRE_CONFIG.agencyName(null)).toBe("City of Milwaukee");
  });

  test("registered as a Milwaukee, Wisconsin city source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === WI_MILWAUKEE_BONFIRE_SOURCE)).toBe(true);
    expect(SOURCE_CLASSES[WI_MILWAUKEE_BONFIRE_SOURCE]).toMatchObject({ class: "local", city: "Milwaukee", scopeState: "WI" });
    expect(SOURCE_HOME_JURISDICTIONS[WI_MILWAUKEE_BONFIRE_SOURCE]).toBe("WI");
  });
});

describe("wi_milwaukee_county_bonfire", async () => {
  const { WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG, WI_MILWAUKEE_COUNTY_BONFIRE_SOURCE } = await import("./wi-milwaukee-county-bonfire");
  test("reads only the Milwaukee County tenant, with its own id prefix", () => {
    expect(bonfireDataUrl(WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG)).toBe(
      "https://countymilwaukee.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData",
    );
    expect(WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG.idPrefix).toBe("mkecountybonfire");
    expect(WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG.idPrefix).not.toBe(WI_MILWAUKEE_BONFIRE_CONFIG.idPrefix);
    expect(WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG.agencyName(null)).toBe("Milwaukee County");
  });
  test("registered as a Milwaukee, Wisconsin local source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === WI_MILWAUKEE_COUNTY_BONFIRE_SOURCE)).toBe(true);
    expect(SOURCE_CLASSES[WI_MILWAUKEE_COUNTY_BONFIRE_SOURCE]).toMatchObject({ class: "local", scopeState: "WI" });
    expect(SOURCE_HOME_JURISDICTIONS[WI_MILWAUKEE_COUNTY_BONFIRE_SOURCE]).toBe("WI");
  });
});

describe("wi_mps_bonfire", async () => {
  const { WI_MPS_BONFIRE_CONFIG, WI_MPS_BONFIRE_SOURCE } = await import("./wi-mps-bonfire");
  test("reads only the owner-supplied MPS tenant", () => {
    expect(bonfireDataUrl(WI_MPS_BONFIRE_CONFIG)).toBe("https://mps.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData");
    expect(WI_MPS_BONFIRE_CONFIG.idPrefix).toBe("mpsbonfire");
    expect(WI_MPS_BONFIRE_CONFIG.agencyName(null)).toBe("Milwaukee Public Schools");
  });
  test("registered as a Milwaukee, Wisconsin local source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === WI_MPS_BONFIRE_SOURCE)).toBe(true);
    expect(SOURCE_CLASSES[WI_MPS_BONFIRE_SOURCE]).toMatchObject({ class: "local", scopeState: "WI" });
    expect(SOURCE_HOME_JURISDICTIONS[WI_MPS_BONFIRE_SOURCE]).toBe("WI");
  });
});
