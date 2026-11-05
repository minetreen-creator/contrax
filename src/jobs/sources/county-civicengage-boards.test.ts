import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { CIVICENGAGE_NOT_A_BID_GROUP, CIVICENGAGE_NOT_A_BID_TITLE, CIVICENGAGE_PLACEHOLDER_TITLE, parseCivicEngageBoard } from "./civicengage-bids";
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
  // Virginia, captured 2026-11-04.
  va_rockingham_county: 1, va_franklin_county: 1, va_henry_county: 13, va_martinsville: 3, va_bristol: 3, va_wise_county: 1, va_falls_church: 1, va_purcellville: 1, va_orange_county: 1, va_norton: 1, va_surry_county: 1, va_greene_county: 3, va_page_county: 1, va_scott_county: 1, va_wythe_county: 2, va_vinton: 1,
  // California, captured 2026-11-04.
  ca_alhambra: 5, ca_gilroy: 3, ca_inglewood: 1, ca_san_mateo: 3, ca_moorpark: 1,
  // Louisiana, captured 2026-11-04.
  la_kenner: 5, la_assumption_parish: 11,
  // New Jersey, captured 2026-11-04.
  nj_gloucester_county: 6, nj_passaic: 4, nj_freehold_township: 3, nj_orange: 13, nj_summit: 9, nj_jackson_township: 1, nj_asbury_park: 1, nj_willingboro: 3,
  // Washington, Idaho, captured 2026-11-04.
  // FL, OH, MI, WA, CO, OR, AL, TN, IN, captured 2026-11-05.
  fl_margate: 1, fl_north_miami: 7, oh_lorain: 4, oh_mahoning_county: 1, oh_wood_county: 1, oh_clark_county: 4, oh_gahanna: 4, oh_marysville: 5, oh_piqua: 1, oh_sidney: 2, oh_north_canton: 2, oh_hudson: 3, mi_sterling_heights: 4, mi_westland: 5, mi_saginaw: 6, mi_east_lansing: 1, mi_midland: 8, mi_jackson_county: 3, mi_jackson: 4, mi_ypsilanti: 1, wa_lake_stevens: 1, wa_arlington: 2, wa_lynden: 2, wa_port_angeles: 3, wa_bainbridge_island: 2, wa_gig_harbor: 2, co_montrose_county: 1, co_berthoud: 2, co_steamboat_springs: 1, or_grants_pass: 3, or_yamhill_county: 1, or_crook_county: 1, al_hoover: 2, al_alabaster: 3, al_opelika: 3, al_fairhope: 6, al_cullman: 3, tn_bartlett: 3, tn_hendersonville: 2, tn_williamson_county: 1,
  // North Carolina, captured 2026-11-05.
  nc_orange_county: 2, nc_huntersville: 4, nc_fuquay_varina: 2, nc_davidson_county: 1, nc_moore_county: 1, nc_craven_county: 2, nc_carteret_county: 4, nc_burke_county: 2, nc_wilkes_county: 1, nc_haywood_county: 6, nc_jackson_county: 4, nc_lumberton: 2, nc_clemmons: 1,
  wa_marysville: 1, wa_redmond: 4, wa_bothell: 1, wa_puyallup: 1, wa_bremerton: 3, wa_des_moines: 2, wa_anacortes: 1, wa_yakima_county: 1, wa_franklin_county: 4, wa_cowlitz_county: 2, wa_grant_county: 1, wa_clallam_county: 1, wa_jefferson_county: 1, id_idaho_falls: 2, id_pocatello: 2, id_kootenai_county: 1,
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
  "va_roanoke_county", "va_spotsylvania_county", "va_warren_county", "va_radford", "va_campbell_county", "va_amherst_county", "va_warrenton", "va_caroline_county", "va_king_william_county", "va_mecklenburg_county", "va_halifax_county", "va_cumberland_county", "va_appomattox_county", "va_madison_county", "va_grayson_county", "va_patrick_county", "va_russell_county", "va_dickenson_county", "va_ashland", "va_bedford", "va_woodstock", "va_middleburg", "va_christiansburg", "va_dinwiddie_county",
  "la_bossier_city", "la_lake_charles", "la_baton_rouge", "la_leesville", "la_sulphur", "la_st_james_parish", "la_plaquemines_parish", "la_st_bernard_parish", "la_west_baton_rouge_parish",
  "nj_burlington_county", "nj_cape_may_county", "nj_hunterdon_county", "nj_elizabeth", "nj_woodbridge", "nj_toms_river", "nj_east_orange", "nj_north_brunswick", "nj_howell", "nj_randolph", "nj_roxbury", "nj_bloomfield", "nj_rahway", "nj_union_township", "nj_berkeley_township", "nj_long_branch", "nj_red_bank", "nj_paramus", "nj_moorestown",
  "fl_hialeah", "fl_hollywood", "fl_santa_rosa_county", "fl_st_cloud", "fl_ocoee", "fl_bartow", "fl_destin", "fl_fort_walton_beach", "fl_boynton_beach", "fl_jupiter", "fl_palm_beach_gardens", "fl_deerfield_beach", "fl_homestead", "fl_aventura", "oh_parma", "oh_canton", "oh_lucas_county", "oh_ashtabula_county", "oh_grove_city", "oh_upper_arlington", "oh_reynoldsburg", "oh_lancaster", "oh_fairfield", "oh_beavercreek", "oh_centerville", "oh_lima", "oh_barberton", "oh_shaker_heights", "oh_solon", "mi_taylor", "mi_st_clair_shores", "mi_royal_oak", "mi_battle_creek", "mi_portage", "mi_monroe_county", "mi_eaton_county", "mi_lenawee_county", "mi_holland", "mi_canton_township", "mi_walker", "mi_clinton_township", "mi_chesterfield_township", "mi_inkster", "wa_mukilteo", "wa_monroe", "co_westminster", "co_pueblo", "co_broomfield", "co_grand_junction", "co_montrose", "co_durango", "co_lafayette", "co_firestone", "co_frederick", "co_aspen", "co_greenwood_village", "or_wilsonville", "or_forest_grove", "or_lebanon", "or_la_grande", "or_central_point", "or_eagle_point", "al_dothan", "al_gadsden", "al_northport", "al_shelby_county", "al_st_clair_county", "al_orange_beach", "al_hartselle", "al_leeds", "al_muscle_shoals", "tn_clarksville", "tn_blount_county", "tn_madison_county", "tn_millington", "tn_lakeland", "in_warsaw",
  "nc_sanford", "nc_lincoln_county", "nc_nash_county", "nc_caldwell_county", "nc_pender_county", "nc_monroe", "nc_boone", "nc_indian_trail", "nc_carolina_beach", "nc_emerald_isle", "nc_lincolnton",
  "wa_spokane_valley", "wa_pasco", "wa_kennewick", "wa_mount_vernon", "wa_longview", "wa_north_bend", "wa_port_orchard", "wa_burlington", "wa_washougal", "wa_ridgefield", "wa_ellensburg", "wa_west_richland", "wa_cheney", "wa_liberty_lake", "wa_pierce_county", "wa_snohomish_county", "wa_island_county", "wa_douglas_county", "wa_adams_county", "wa_asotin_county", "id_twin_falls", "id_lewiston", "id_eagle", "wy_laramie", "wy_campbell_county", "wy_albany_county", "wy_green_river", "wy_torrington", "wy_carbon_county", "wy_goshen_county",
]);

describe("county CivicEngage boards", () => {
  test("327 boards with unique sources and id prefixes", () => {
    expect(COUNTY_CIVICENGAGE_CONFIGS).toHaveLength(468);
    expect(new Set(COUNTY_CIVICENGAGE_CONFIGS.map((c) => c.source)).size).toBe(468);
    expect(new Set(COUNTY_CIVICENGAGE_CONFIGS.map((c) => c.idPrefix)).size).toBe(468);
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

describe("Virginia boards (owner 2026-11-04: more construction bids in VA)", () => {
  test("placeholder and non-competition titles are not bids", () => {
    expect(CIVICENGAGE_PLACEHOLDER_TITLE.test("*NO BID SUMMARIES AVAILABLE AT THIS TIME, UNLESS LISTED BELOW.")).toBe(true);
    expect(CIVICENGAGE_NOT_A_BID_TITLE.test("Notice of sole source award - Fiber Broadband Services")).toBe(true);
    expect(CIVICENGAGE_NOT_A_BID_TITLE.test("Public Notice: Surplus Brick Dust Available for Sale")).toBe(true);
    for (const real of ["BID 3136 PARTIAL ROOF REPLACEMENT PHILPOTT WATER PLANT", "RFB: Progress Park Lot 10 - Mass Grading", "Asphalt Paving Services RFP", "Surplus Property Auction Services RFP"]) {
      expect(CIVICENGAGE_PLACEHOLDER_TITLE.test(real) || CIVICENGAGE_NOT_A_BID_TITLE.test(real)).toBe(false);
    }
  });

  test("Henry County lists its construction bids, not its placeholder line", () => {
    const { rows } = parseCountyCivicEngage("va_henry_county", capture("www.henrycountyva.gov", 1), now);
    expect(rows.some((r) => /PARTIAL ROOF REPLACEMENT/.test(r.title))).toBe(true);
    expect(rows.some((r) => /NO BID SUMMARIES/i.test(r.title))).toBe(false);
  });

  test("every new board is registered with its state and agency page", () => {
    for (const cfg of COUNTY_CIVICENGAGE_CONFIGS.filter((c) => c.location.endsWith(", VA"))) {
      expect(SOURCE_HOME_JURISDICTIONS[cfg.source]).toBe("VA");
      expect(SOURCE_CLASSES[cfg.source]).toBeDefined();
      expect(LOCAL_AGENCIES.some((a) => a.source === cfg.source)).toBe(true);
    }
  });
});
