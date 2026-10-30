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

// Open projects in each 2026-10-27 capture (Tempe: 2026-10-29; the boards from md_harford_bonfire on: 2026-10-30).
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
  az_yuma_bonfire: 4,
  az_buckeye_bonfire: 1,
  az_mcccd_bonfire: 5,
  az_prescott_valley_bonfire: 2,
  az_peoria_bonfire: 2,
  az_scottsdale_bonfire: 5,
  az_goodyear_bonfire: 1,
  az_tempe_bonfire: 6,
  mo_kansas_city_bonfire: 7,
  mo_st_louis_county_bonfire: 9,
  mo_jackson_county_bonfire: 12,
  mo_jefferson_city_bonfire: 5,
  md_harford_bonfire: 5,
  md_stadium_authority_bonfire: 1,
  co_boulder_county_bonfire: 11,
  oh_akron_bonfire: 6,
  oh_cincinnati_bonfire: 6,
  oh_westerville_bonfire: 3,
  tx_galveston_county_bonfire: 4,
  tx_lewisville_bonfire: 3,
  az_cochise_county_bonfire: 5,
  id_bannock_county_bonfire: 1,
  nm_bernalillo_county_bonfire: 1,
  ny_rockland_county_bonfire: 6,
  pa_allegheny_dhs_bonfire: 1,
  ga_cobb_schools_bonfire: 14,
  va_fairfax_eda_bonfire: 1,
  sc_charleston_county_bonfire: 2,
  nc_wake_county_bonfire: 1,
  nc_charlotte_bonfire: 29,
  ga_chatham_county_bonfire: 12,
  ga_floyd_county_bonfire: 2,
  ga_roswell_bonfire: 3,
  wv_marshall_university_bonfire: 1,
  fl_pasco_county_bonfire: 4,
  fl_indian_river_county_bonfire: 1,
  fl_tallahassee_bonfire: 6,
  fl_fau_bonfire: 1,
  fl_ucf_bonfire: 2,
  fl_lee_schools_bonfire: 1,
  in_indygo_bonfire: 4,
};
// Real tenants with nothing open at capture (portal title confirmed), so no file.
const NO_CAPTURE = new Set([
  "az_pinal_bonfire", "az_sedona_bonfire", "mo_slps_bonfire",
  "tx_lubbock_county_bonfire", "tx_reeves_county_bonfire", "tx_hutchins_bonfire", "id_meridian_bonfire",
  "mi_muskegon_county_bonfire", "ca_solano_county_bonfire", "ga_paulding_schools_bonfire",
  "fl_sunrise_bonfire", "fl_plantation_bonfire", "fl_duval_schools_bonfire", "fl_fgcu_bonfire", "fl_jaxport_bonfire",
  "in_fort_wayne_schools_bonfire",
]);

describe("county Bonfire boards", () => {
  test("sixty-seven boards, unique sources and id prefixes", () => {
    expect(COUNTY_BONFIRE_CONFIGS).toHaveLength(67);
    expect(new Set(COUNTY_BONFIRE_CONFIGS.map((c) => c.source)).size).toBe(67);
    expect(new Set(COUNTY_BONFIRE_CONFIGS.map((c) => c.idPrefix)).size).toBe(67);
  });

  for (const cfg of COUNTY_BONFIRE_CONFIGS.filter((c) => !NO_CAPTURE.has(c.source))) {
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
    expect(COUNTY_BONFIRE_CONFIGS.find((c) => c.source === "az_prescott_valley_bonfire")!.locationName).toBe("Prescott Valley, AZ");
    expect(COUNTY_BONFIRE_CONFIGS.find((c) => c.source === "az_mcccd_bonfire")!.locationName).toBe("Maricopa County, AZ");
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
