import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { COUNTY_BONFIRE_CONFIGS, COUNTY_BONFIRE_SOURCES, parseCountyBonfire } from "./county-bonfire-boards";

const dir = (tenant: string) => new URL(`./fixtures/county-bonfire/${tenant}/`, import.meta.url);
const capture = (tenant: string, n: number) => {
  const file = readdirSync(dir(tenant)).find((f) => f.endsWith(`-fetch${n}.json`))!;
  return JSON.parse(readFileSync(new URL(file, dir(tenant)), "utf8")).payload;
};
const tenantOf = (host: string) => host.replace("https://", "").replace(".bonfirehub.com", "");
const now = Date.parse("2026-10-27T02:00:00Z");

// Open projects in each 2026-10-27 capture.
const CAPTURED: Record<string, number> = {
  tx_harris_bonfire: 34,
  fl_hillsborough_bonfire: 20,
  ga_forsyth_bonfire: 8,
  ga_columbia_bonfire: 5,
  fl_monroe_bonfire: 6,
  tn_montgomery_bonfire: 2,
  tx_hood_bonfire: 1,
  tx_parker_bonfire: 2,
  ga_alpharetta_bonfire: 2,
  tx_denton_bonfire: 3,
};

describe("county Bonfire boards", () => {
  test("ten boards, unique sources and id prefixes", () => {
    expect(COUNTY_BONFIRE_CONFIGS).toHaveLength(10);
    expect(new Set(COUNTY_BONFIRE_CONFIGS.map((c) => c.source)).size).toBe(10);
    expect(new Set(COUNTY_BONFIRE_CONFIGS.map((c) => c.idPrefix)).size).toBe(10);
  });

  for (const cfg of COUNTY_BONFIRE_CONFIGS) {
    test(`${cfg.source}: both captures match and every row is well formed`, () => {
      const t = tenantOf(cfg.host);
      expect(capture(t, 1)).toEqual(capture(t, 2));
      const { rows } = parseCountyBonfire(cfg.source, capture(t, 1), now);
      const total = Object.keys(capture(t, 1).projects).length;
      expect(total).toBe(CAPTURED[cfg.source]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThanOrEqual(total);
      for (const r of rows) {
        expect(r.external_id.startsWith(`${cfg.idPrefix}-`)).toBe(true);
        expect(r.source_url).toStartWith(`${cfg.host}/opportunities/`);
        expect(r.location).toBe(cfg.locationName);
        expect(r.agency.length).toBeGreaterThan(0);
        expect(Date.parse(r.due_date!)).toBeGreaterThan(now);
      }
      // Nothing survives once every deadline has passed.
      expect(parseCountyBonfire(cfg.source, capture(t, 1), Date.parse("2028-01-01T00:00:00Z")).rows).toHaveLength(0);
    });
  }

  test("locations and agency names read naturally", () => {
    const harris = COUNTY_BONFIRE_CONFIGS.find((c) => c.source === "tx_harris_bonfire")!;
    expect(harris.locationName).toBe("Harris County, TX");
    expect(harris.agencyName(null)).toBe("Harris County, Texas");
    expect(harris.agencyName("Purchasing")).toBe("Harris County Purchasing");
    expect(harris.agencyName("Harris County Flood Control District")).toBe("Harris County Flood Control District");
    expect(COUNTY_BONFIRE_CONFIGS.find((c) => c.source === "ga_alpharetta_bonfire")!.locationName).toBe("Alpharetta, GA");
  });

  test("every board is scheduled, classified, placed in its state, and has an agency page", () => {
    for (const s of COUNTY_BONFIRE_SOURCES) {
      expect(TAIL_SOURCES.find((t) => t.name === s.name)?.fetchFn).toBe(s.fetchFn);
      expect(SOURCE_CLASSES[s.name]?.class).toBe("local");
      expect(SOURCE_HOME_JURISDICTIONS[s.name]).toBe(SOURCE_CLASSES[s.name]?.scopeState);
      expect(LOCAL_AGENCIES.some((a) => a.source === s.name)).toBe(true);
    }
  });
});
