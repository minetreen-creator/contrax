/**
 * Chicago-area Bonfire tenants (`il_cook_county_bonfire`, `il_cps_bonfire`,
 * `il_cook_county_health_bonfire`, owner 2026-10-09). Registration and config
 * only — the shared Bonfire reader is covered against real captured payloads in
 * tx-bonfire.test.ts. No fixture is pinned here because the tenants could not be
 * reached from the dev sandbox; nothing is invented.
 */
import { describe, expect, test } from "bun:test";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { bonfireDataUrl } from "./bonfire-public";
import {
  IL_COOK_COUNTY_BONFIRE_CONFIG,
  IL_COOK_COUNTY_HEALTH_BONFIRE_CONFIG,
  IL_CPS_BONFIRE_CONFIG,
} from "./il-chicago-bonfire";

const TENANTS = [
  { cfg: IL_COOK_COUNTY_BONFIRE_CONFIG, host: "cookcountyil", prefix: "cookcountybonfire", buyer: "Cook County", place: "Cook County, IL" },
  { cfg: IL_CPS_BONFIRE_CONFIG, host: "cps", prefix: "cpsbonfire", buyer: "Chicago Public Schools", place: "Chicago, IL" },
  { cfg: IL_COOK_COUNTY_HEALTH_BONFIRE_CONFIG, host: "cookcountyhealth", prefix: "cookhealthbonfire", buyer: "Cook County Health", place: "Cook County, IL" },
];

describe("Chicago-area Bonfire tenants", () => {
  for (const t of TENANTS) {
    test(`${t.cfg.source}: reads only its own tenant, with its own id prefix`, () => {
      expect(bonfireDataUrl(t.cfg)).toBe(`https://${t.host}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`);
      expect(t.cfg.idPrefix).toBe(t.prefix);
      expect(t.cfg.agencyName(null)).toBe(t.buyer);
      expect(t.cfg.locationName).toBe(t.place);
    });

    test(`${t.cfg.source}: registered as a Chicago, Illinois local source; rows land in Illinois`, () => {
      expect(TAIL_SOURCES.some((s) => s.name === t.cfg.source)).toBe(true);
      expect(SOURCE_CLASSES[t.cfg.source]).toMatchObject({ class: "local", city: "Chicago", scopeState: "IL", recordType: "opportunity" });
      expect(SOURCE_HOME_JURISDICTIONS[t.cfg.source]).toBe("IL");
      const cols = deriveInsertLocationColumns({
        location: t.place,
        agency: t.buyer,
        title: "Janitorial services",
        description: "",
        sourceName: t.cfg.source,
      });
      expect(cols.normalized_state).toBe("IL");
    });
  }

  test("the three id prefixes are distinct", () => {
    expect(new Set(TENANTS.map((t) => t.cfg.idPrefix)).size).toBe(3);
  });
});
