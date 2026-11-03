import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { CIVICENGAGE_NOT_A_BID_GROUP, parseCivicEngageBoard } from "./civicengage-bids";
import { COUNTY_CIVICENGAGE_CONFIGS, COUNTY_CIVICENGAGE_SOURCES, parseCountyCivicEngage } from "./county-civicengage-boards";

const dirOf = (host: string) =>
  new URL(`./fixtures/county-civicengage/${host.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-")}/`, import.meta.url);
const capture = (host: string, n: number) => {
  const dir = dirOf(host);
  const file = readdirSync(dir).find((f) => f.endsWith(`-fetch${n}.html`))!;
  return readFileSync(new URL(file, dir), "utf8");
};
const now = Date.parse("2026-10-27T02:30:00Z");

// Open competitive bids per board in the 2026-10-27 capture, after the group filter.
const OPEN: Record<string, number> = {
  va_hopewell: 7, va_danville: 8, va_salem: 7, va_pittsylvania: 2, va_williamsburg: 2,
  md_hagerstown: 1, md_queen_annes: 1, md_college_park: 2,
  nc_high_point: 4, nc_pitt_county: 2,
  fl_bay_county: 1, fl_titusville: 4,
  ga_hall_county: 2, ga_barrow_county: 7,
  tx_league_city: 5, tx_longview: 2, tx_midland: 4, tx_odessa: 3,
  az_lake_havasu: 5, az_casa_grande: 3, az_douglas: 6,
  mo_springfield: 9, mo_st_charles_county: 4, mo_st_charles: 3, mo_liberty: 2, mo_ozark: 2, mo_ballwin: 1,
  in_lafayette: 1, in_zionsville: 1,
  // New Jersey, captured 2026-10-28.
  nj_cherry_hill: 16, nj_trenton: 7, nj_cranford: 12, nj_fort_lee: 3, nj_west_orange: 3, nj_princeton: 3, nj_millville: 4,
  nj_livingston: 2, nj_mahwah: 4, nj_wall: 1, nj_ridgewood: 2, nj_westfield: 1, nj_montgomery: 1, nj_east_brunswick: 1,
  // Montana and South Carolina, captured 2026-10-30.
  mt_billings: 5, mt_missoula: 4, mt_butte_silver_bow: 5, mt_kalispell: 1, mt_cascade_county: 1, sc_charleston: 7,
  // North Carolina, Georgia and West Virginia, captured 2026-10-30 (Winston-Salem: one more closed by then).
  nc_apex: 5, nc_winston_salem: 19, nc_brunswick_county: 6,
  ga_peachtree_city: 1, ga_lowndes_county: 1, ga_lawrenceville: 1, ga_newnan: 4, ga_liberty_county: 4,
  wv_fairmont: 3, wv_berkeley_county: 1,
  // Tennessee, captured 2026-10-30.
  tn_pigeon_forge: 2, tn_la_vergne: 1, tn_mt_juliet: 1, tn_spring_hill: 2, tn_cookeville: 3, tn_oak_ridge: 2, tn_lebanon: 1,
  // Florida, captured 2026-10-30.
  fl_pensacola: 1,
  // Indiana, captured 2026-10-30.
  in_crown_point: 1, in_shelbyville: 1,
  // Texas, captured 2026-11-03.
  tx_san_marcos: 5, tx_abilene: 6, tx_kerrville: 2, tx_fredericksburg: 4, tx_mansfield: 1, tx_duncanville: 2, tx_sachse: 2, tx_murphy: 1, tx_midlothian: 2, tx_sherman: 4, tx_denison: 3, tx_nacogdoches: 5, tx_huntsville: 3, tx_copperas_cove: 6, tx_taylor: 2, tx_lockhart: 2, tx_port_arthur: 2, tx_alvin: 2, tx_seabrook: 3, tx_snyder: 1, tx_stephenville: 1, tx_mineral_wells: 2, tx_jacksonville: 2, tx_henderson_county: 1,
};
// Real boards with nothing open at capture (scheduled so new bids flow in), so no file.
const NO_CAPTURE = new Set([
  "in_carmel", "in_hamilton_county", "in_tippecanoe_county", "in_anderson", "in_avon", "in_brownsburg",
  "mt_gallatin_county", "sc_spartanburg", "sc_mount_pleasant", "sc_summerville", "sc_fort_mill",
  "nc_new_hanover_county", "nc_burlington", "nc_iredell_county", "nc_jacksonville", "nc_rowan_county",
  "ga_savannah", "ga_athens_clarke", "ga_douglas_county", "ga_coweta_county", "ga_carroll_county",
  "ga_effingham_county", "ga_dawson_county", "ga_jackson_county", "ga_rome",
  "wv_vienna", "wv_weirton", "wv_morgantown",
  "tn_gallatin", "tn_cleveland", "tn_goodlettsville", "tn_white_house", "tn_springfield", "tn_wilson_county",
  "tn_maury_county", "tn_washington_county", "tn_coffee_county",
  "fl_florida_city", "fl_cocoa", "fl_wellington", "fl_miami_gardens", "fl_casselberry", "fl_new_smyrna_beach", "fl_levy_county",
  "in_westfield", "in_crawfordsville",
  "tx_garland", "tx_mesquite", "tx_killeen", "tx_missouri_city", "tx_baytown", "tx_pasadena", "tx_friendswood", "tx_texas_city", "tx_lake_jackson", "tx_victoria", "tx_buda", "tx_boerne", "tx_universal_city", "tx_cedar_hill", "tx_desoto", "tx_lancaster", "tx_rowlett", "tx_prosper", "tx_little_elm", "tx_the_colony", "tx_flower_mound", "tx_bedford", "tx_haltom_city", "tx_watauga", "tx_azle", "tx_weatherford", "tx_granbury", "tx_corsicana", "tx_texarkana", "tx_marshall", "tx_harker_heights", "tx_lakeway", "tx_plainview", "tx_borger", "tx_angleton", "tx_la_porte", "tx_webster", "tx_tomball", "tx_bellaire", "tx_rockport", "tx_eagle_pass", "tx_donna", "tx_san_benito", "tx_brownwood", "tx_kilgore", "tx_bexar_county", "tx_smith_county", "tx_hidalgo_county", "tx_webb_county", "tx_ellis_county", "tx_kaufman_county", "tx_rockwall_county", "tx_randall_county", "tx_midland_county", "tx_ector_county", "tx_chambers_county", "tx_bowie_county", "tx_wise_county", "tx_kendall_county",
]);

describe("county CivicEngage boards", () => {
  test("198 boards with unique sources and id prefixes", () => {
    expect(COUNTY_CIVICENGAGE_CONFIGS).toHaveLength(198);
    expect(new Set(COUNTY_CIVICENGAGE_CONFIGS.map((c) => c.source)).size).toBe(198);
    expect(new Set(COUNTY_CIVICENGAGE_CONFIGS.map((c) => c.idPrefix)).size).toBe(198);
  });

  for (const cfg of COUNTY_CIVICENGAGE_CONFIGS.filter((c) => !NO_CAPTURE.has(c.source))) {
    test(`${cfg.source}: captured board parses to its open competitive bids`, () => {
      const { rows } = parseCountyCivicEngage(cfg.source, capture(cfg.host, 1), now);
      expect(rows).toHaveLength(OPEN[cfg.source]);
      expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
      for (const r of rows) {
        expect(r.external_id.startsWith(`${cfg.idPrefix}-`)).toBe(true);
        expect(r.source_url).toStartWith(`${cfg.endpoint}?bidID=`);
        expect(r.agency).toBe(cfg.agency);
        expect(r.location).toBe(cfg.location);
      }
      // The second fetch reads the same bids.
      const again = parseCountyCivicEngage(cfg.source, capture(cfg.host, 2), now).rows.map((r) => r.external_id).sort();
      expect(again).toEqual(rows.map((r) => r.external_id).sort());
    });
  }

  test("non-competition groups are skipped and a bid in two groups is emitted once", () => {
    const danville = COUNTY_CIVICENGAGE_CONFIGS.find((c) => c.source === "va_danville")!;
    const filtered = parseCountyCivicEngage("va_danville", capture(danville.host, 1), now);
    expect(filtered.skipped.not_a_bid_group).toBe(14);
    expect(filtered.skipped.duplicate_listing).toBe(7);
    // Without the filter (the original behavior) the same page yields every listing.
    const { excludeGroup: _omit, ...plain } = danville;
    expect(parseCivicEngageBoard(capture(danville.host, 1), plain, now).rows.length).toBe(29);
    for (const g of ["Emergency", "Sole Source", "x Bid Results - Closed", "Plan Holders and Pre-bid Attendees", "Notice of Award/Intent to Award/Cancellation", "Cooperative Procurement Contracts"]) {
      expect(CIVICENGAGE_NOT_A_BID_GROUP.test(g)).toBe(true);
    }
    for (const g of ["Bid Opportunities", "Construction Services Bids", "Request for Proposal", "Purchasing Dept Bids", "Parks & Recreation"]) {
      expect(CIVICENGAGE_NOT_A_BID_GROUP.test(g)).toBe(false);
    }
  });

  test("every board is scheduled, classified, placed in its state, and has an agency page", () => {
    for (const s of COUNTY_CIVICENGAGE_SOURCES) {
      expect(TAIL_SOURCES.find((t) => t.name === s.name)?.fetchFn).toBe(s.fetchFn);
      expect(SOURCE_CLASSES[s.name]?.class).toBe("local");
      expect(SOURCE_HOME_JURISDICTIONS[s.name]).toBe(SOURCE_CLASSES[s.name]?.scopeState);
      expect(LOCAL_AGENCIES.some((a) => a.source === s.name)).toBe(true);
    }
  });
});
