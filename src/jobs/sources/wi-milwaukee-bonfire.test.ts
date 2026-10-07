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
