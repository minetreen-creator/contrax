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
  nc_ncsu_bonfire: 4,
  nc_wcu_bonfire: 1,
  fl_lee_schools_bonfire: 1,
  in_indygo_bonfire: 4,
  // Texas, captured 2026-11-03.
  tx_fort_worth_bonfire: 17,
  tx_arlington_bonfire: 8,
  tx_frisco_bonfire: 8,
  tx_mckinney_bonfire: 1,
  tx_richardson_bonfire: 6,
  tx_round_rock_bonfire: 3,
  tx_leander_bonfire: 14,
  tx_temple_bonfire: 13,
  tx_brownsville_bonfire: 4,
  tx_amarillo_bonfire: 3,
  tx_san_angelo_bonfire: 2,
  tx_schertz_bonfire: 3,
  tx_fort_bend_county_bonfire: 8,
  tx_williamson_county_bonfire: 2,
  tx_austin_isd_bonfire: 7,
  tx_dallas_isd_bonfire: 4,
  tx_northside_isd_bonfire: 8,
  tx_san_antonio_isd_bonfire: 3,
  tx_fort_bend_isd_bonfire: 4,
  tx_richardson_isd_bonfire: 3,
  tx_klein_isd_bonfire: 1,
  tx_hays_cisd_bonfire: 4,
  tx_dfw_airport_bonfire: 14,
  tx_lcra_bonfire: 3,
  tx_san_antonio_river_authority_bonfire: 2,
  tx_ntmwd_bonfire: 5,
  tx_dart_bonfire: 25,
  tx_ut_austin_bonfire: 4,
  tx_ut_dallas_bonfire: 2,
  tx_ut_health_san_antonio_bonfire: 4,
  tx_tarrant_county_college_bonfire: 2,
  tx_houston_city_college_bonfire: 3,
  // Virginia, captured 2026-11-04.
  va_fauquier_county_bonfire: 4, va_fairfax_schools_bonfire: 2, va_prince_william_schools_bonfire: 3, va_cnu_bonfire: 1,
  // California, captured 2026-11-04.
  ca_lawa_bonfire: 5, ca_ac_transit_bonfire: 4, ca_sutter_county_bonfire: 4, ca_ventura_county_bonfire: 3, ca_elk_grove_schools_bonfire: 1,
  // New Jersey (+ Howard County MD and Clark County NV schools), captured 2026-11-04.
  nj_hmfa_bonfire: 2, nj_sussex_county_bonfire: 6, nj_ocean_county_college_bonfire: 1, md_howard_schools_bonfire: 3, nv_clark_county_schools_bonfire: 1,
  // Washington and Idaho, captured 2026-11-04.
  wa_vancouver_bonfire: 1, id_ada_county_bonfire: 1,
};
// Real tenants with nothing open at capture (portal title confirmed), so no file.
const NO_CAPTURE = new Set([
  "az_pinal_bonfire", "az_sedona_bonfire", "mo_slps_bonfire",
  "tx_lubbock_county_bonfire", "tx_reeves_county_bonfire", "tx_hutchins_bonfire", "id_meridian_bonfire",
  "mi_muskegon_county_bonfire", "ca_solano_county_bonfire", "ga_paulding_schools_bonfire",
  "fl_sunrise_bonfire", "fl_plantation_bonfire", "fl_duval_schools_bonfire", "fl_fgcu_bonfire", "fl_jaxport_bonfire",
  "in_fort_wayne_schools_bonfire",
  "tx_wylie_bonfire", "tx_southlake_bonfire", "tx_johnson_county_bonfire", "tx_cypress_fairbanks_isd_bonfire", "tx_garland_isd_bonfire", "tx_corpus_christi_isd_bonfire", "tx_ut_system_bonfire", "tx_utrgv_bonfire", "tx_del_mar_college_bonfire",
  "va_chesterfield_county_bonfire", "va_loudoun_water_bonfire", "va_arlington_schools_bonfire",
  "ca_alameda_county_bonfire", "ca_yolo_county_bonfire", "ca_irvine_bonfire", "ca_oakland_capital_bonfire", "ca_westminster_bonfire",
  "nj_mcua_bonfire", "nj_raritan_valley_cc_bonfire", "nj_rcbc_bonfire",
  "wa_clark_county_bonfire", "wa_renton_bonfire", "wa_port_of_everett_bonfire", "wa_tacoma_schools_bonfire", "wa_lake_washington_schools_bonfire", "wa_northshore_schools_bonfire", "id_west_ada_schools_bonfire",
]);

describe("county Bonfire boards", () => {
  test("142 boards, unique sources and id prefixes", () => {
    expect(COUNTY_BONFIRE_CONFIGS).toHaveLength(144);
    expect(new Set(COUNTY_BONFIRE_CONFIGS.map((c) => c.source)).size).toBe(144);
    expect(new Set(COUNTY_BONFIRE_CONFIGS.map((c) => c.idPrefix)).size).toBe(144);
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
      // Nothing survives once every deadline has passed (Temple posts continuous
      // solicitations open until 2031).
      expect(parseCountyBonfire(cfg.source, capture(t, 1), Date.parse("2040-01-01T00:00:00Z")).rows).toHaveLength(0);
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
