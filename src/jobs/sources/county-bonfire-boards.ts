/**
 * County and city Bonfire boards (owner 2026-10-27: "we need more counties like
 * them" after Broward). Each buyer's public BPRO-style open-opportunities list,
 * read with the shared reader (pacing, open-status, deadline and
 * purchased-service guards). The tenant was confirmed by its portal page title
 * in the 2026-10-27 capture (fixtures/county-bonfire). No detail documents, private
 * opportunities, or registration are accessed.
 */
import type { FetchResult } from "../runner";
import { bonfireAgencyName, fetchBonfireBids, parseBonfire, type BonfireConfig, type BonfirePayload } from "./bonfire-public";

type Board = { tenant: string; source: string; stateName: string; place: string; buyer: string; idPrefix: string; location?: string };

/** Department names are prefixed with the buyer's place unless they already name it. */
function boardConfig(b: Board): BonfireConfig {
  return {
    source: b.source,
    host: `https://${b.tenant}.bonfirehub.com`,
    idPrefix: b.idPrefix,
    stateName: b.stateName,
    locationName: b.location ?? b.buyer.replace(/, ([A-Za-z ]+)$/, (_, st: string) => `, ${STATE_ABBR[st] ?? st}`).replace(/^(City|Town) of /, ""),
    buyerName: b.buyer,
    portalName: `the ${b.buyer} procurement portal (Bonfire)`,
    agencyName: (dept) => {
      const name = bonfireAgencyName(dept, b.buyer);
      return name === b.buyer || name.includes(b.place) ? name : `${b.place} ${name}`;
    },
  };
}

const STATE_ABBR: Record<string, string> = {
  Texas: "TX", Florida: "FL", Georgia: "GA", Tennessee: "TN", Arizona: "AZ", Missouri: "MO", Maryland: "MD", Colorado: "CO",
  Ohio: "OH", Idaho: "ID", "New Mexico": "NM", "New York": "NY", "South Carolina": "SC",
  Michigan: "MI", California: "CA", "North Carolina": "NC", "West Virginia": "WV",
};

const BOARDS: Board[] = [
  { tenant: "harriscountytx", source: "tx_harris_bonfire", stateName: "Texas", place: "Harris County", buyer: "Harris County, Texas", idPrefix: "harriscountytxbonfire" },
  { tenant: "hillsboroughcounty", source: "fl_hillsborough_bonfire", stateName: "Florida", place: "Hillsborough County", buyer: "Hillsborough County, Florida", idPrefix: "hillsboroughcountybonfire" },
  { tenant: "forsythco", source: "ga_forsyth_bonfire", stateName: "Georgia", place: "Forsyth County", buyer: "Forsyth County, Georgia", idPrefix: "forsythcobonfire" },
  { tenant: "columbiacountyga", source: "ga_columbia_bonfire", stateName: "Georgia", place: "Columbia County", buyer: "Columbia County, Georgia", idPrefix: "columbiacountygabonfire" },
  { tenant: "monroecounty-fl", source: "fl_monroe_bonfire", stateName: "Florida", place: "Monroe County", buyer: "Monroe County, Florida", idPrefix: "monroecountyflbonfire" },
  { tenant: "mcgtn", source: "tn_montgomery_bonfire", stateName: "Tennessee", place: "Montgomery County", buyer: "Montgomery County, Tennessee", idPrefix: "mcgtnbonfire" },
  { tenant: "co-hood-tx", source: "tx_hood_bonfire", stateName: "Texas", place: "Hood County", buyer: "Hood County, Texas", idPrefix: "cohoodtxbonfire" },
  { tenant: "parkercountytx", source: "tx_parker_bonfire", stateName: "Texas", place: "Parker County", buyer: "Parker County, Texas", idPrefix: "parkercountytxbonfire" },
  { tenant: "cityofalpharetta", source: "ga_alpharetta_bonfire", stateName: "Georgia", place: "Alpharetta", buyer: "City of Alpharetta, Georgia", idPrefix: "cityofalpharettabonfire" },
  { tenant: "dentoncounty", source: "tx_denton_bonfire", stateName: "Texas", place: "Denton County", buyer: "Denton County, Texas", idPrefix: "dentoncountybonfire" },
  // Arizona (owner 2026-10-27: "we need arizona sources").
  { tenant: "yumaaz", source: "az_yuma_bonfire", stateName: "Arizona", place: "Yuma", buyer: "City of Yuma, Arizona", idPrefix: "yumaazbonfire" },
  { tenant: "buckeyeaz", source: "az_buckeye_bonfire", stateName: "Arizona", place: "Buckeye", buyer: "City of Buckeye, Arizona", idPrefix: "buckeyeazbonfire" },
  { tenant: "maricopa", source: "az_mcccd_bonfire", stateName: "Arizona", place: "Maricopa County Community Colleges", buyer: "Maricopa County Community Colleges", idPrefix: "maricopabonfire", location: "Maricopa County, AZ" },
  { tenant: "prescottvalleyaz", source: "az_prescott_valley_bonfire", stateName: "Arizona", place: "Prescott Valley", buyer: "Town of Prescott Valley, Arizona", idPrefix: "prescottvalleyazbonfire" },
  { tenant: "peoriaaz", source: "az_peoria_bonfire", stateName: "Arizona", place: "Peoria", buyer: "City of Peoria, Arizona", idPrefix: "peoriaazbonfire" },
  { tenant: "scottsdaleaz", source: "az_scottsdale_bonfire", stateName: "Arizona", place: "Scottsdale", buyer: "City of Scottsdale, Arizona", idPrefix: "scottsdaleazbonfire" },
  { tenant: "goodyearaz", source: "az_goodyear_bonfire", stateName: "Arizona", place: "Goodyear", buyer: "City of Goodyear, Arizona", idPrefix: "goodyearazbonfire" },
  { tenant: "tempe-gov", source: "az_tempe_bonfire", stateName: "Arizona", place: "Tempe", buyer: "City of Tempe, Arizona", idPrefix: "tempegovbonfire" },
  { tenant: "pinalcountyaz", source: "az_pinal_bonfire", stateName: "Arizona", place: "Pinal County", buyer: "Pinal County, Arizona", idPrefix: "pinalcountyazbonfire" },
  { tenant: "sedonaaz", source: "az_sedona_bonfire", stateName: "Arizona", place: "Sedona", buyer: "City of Sedona, Arizona", idPrefix: "sedonaazbonfire" },
  // Missouri (owner 2026-10-27).
  { tenant: "kcmo", source: "mo_kansas_city_bonfire", stateName: "Missouri", place: "Kansas City", buyer: "City of Kansas City, Missouri", idPrefix: "kcmobonfire" },
  { tenant: "stlouiscountymo", source: "mo_st_louis_county_bonfire", stateName: "Missouri", place: "St. Louis County", buyer: "St. Louis County, Missouri", idPrefix: "stlouiscountymobonfire" },
  { tenant: "jacksongov", source: "mo_jackson_county_bonfire", stateName: "Missouri", place: "Jackson County", buyer: "Jackson County, Missouri", idPrefix: "jacksongovbonfire" },
  { tenant: "jeffersoncitymo", source: "mo_jefferson_city_bonfire", stateName: "Missouri", place: "Jefferson City", buyer: "City of Jefferson City, Missouri", idPrefix: "jeffersoncitymobonfire" },
  { tenant: "slps", source: "mo_slps_bonfire", stateName: "Missouri", place: "Saint Louis Public Schools", buyer: "Saint Louis Public Schools", idPrefix: "slpsbonfire", location: "St. Louis, MO" },
  // More Bonfire buyers (owner 2026-10-30: "we need those bonfire counties", "what about SC").
  { tenant: "harfordcountymd", source: "md_harford_bonfire", stateName: "Maryland", place: "Harford County", buyer: "Harford County, Maryland", idPrefix: "harfordcountymdbonfire" },
  { tenant: "mdstad", source: "md_stadium_authority_bonfire", stateName: "Maryland", place: "Maryland Stadium Authority", buyer: "Maryland Stadium Authority", idPrefix: "mdstadbonfire", location: "Baltimore, MD" },
  { tenant: "bouldercounty", source: "co_boulder_county_bonfire", stateName: "Colorado", place: "Boulder County", buyer: "Boulder County, Colorado", idPrefix: "bouldercountybonfire" },
  { tenant: "akronohio", source: "oh_akron_bonfire", stateName: "Ohio", place: "Akron", buyer: "City of Akron, Ohio", idPrefix: "akronohiobonfire" },
  { tenant: "cincinnati-oh", source: "oh_cincinnati_bonfire", stateName: "Ohio", place: "Cincinnati", buyer: "City of Cincinnati, Ohio", idPrefix: "cincinnatiohbonfire" },
  { tenant: "westerville", source: "oh_westerville_bonfire", stateName: "Ohio", place: "Westerville", buyer: "City of Westerville, Ohio", idPrefix: "westervillebonfire" },
  { tenant: "galvestoncountytx", source: "tx_galveston_county_bonfire", stateName: "Texas", place: "Galveston County", buyer: "Galveston County, Texas", idPrefix: "galvestoncountytxbonfire" },
  { tenant: "cityoflewisville", source: "tx_lewisville_bonfire", stateName: "Texas", place: "Lewisville", buyer: "City of Lewisville, Texas", idPrefix: "cityoflewisvillebonfire" },
  { tenant: "lubbock", source: "tx_lubbock_county_bonfire", stateName: "Texas", place: "Lubbock County", buyer: "Lubbock County, Texas", idPrefix: "lubbockbonfire" },
  { tenant: "reevescounty", source: "tx_reeves_county_bonfire", stateName: "Texas", place: "Reeves County", buyer: "Reeves County, Texas", idPrefix: "reevescountybonfire" },
  { tenant: "cityofhutchins", source: "tx_hutchins_bonfire", stateName: "Texas", place: "Hutchins", buyer: "City of Hutchins, Texas", idPrefix: "cityofhutchinsbonfire" },
  { tenant: "meridiancity", source: "id_meridian_bonfire", stateName: "Idaho", place: "Meridian", buyer: "City of Meridian, Idaho", idPrefix: "meridiancitybonfire" },
  { tenant: "muskegoncounty", source: "mi_muskegon_county_bonfire", stateName: "Michigan", place: "Muskegon County", buyer: "Muskegon County, Michigan", idPrefix: "muskegoncountybonfire" },
  { tenant: "solanocounty", source: "ca_solano_county_bonfire", stateName: "California", place: "Solano County", buyer: "Solano County, California", idPrefix: "solanocountybonfire" },
  { tenant: "cochise", source: "az_cochise_county_bonfire", stateName: "Arizona", place: "Cochise County", buyer: "Cochise County, Arizona", idPrefix: "cochisebonfire" },
  { tenant: "bannockcounty", source: "id_bannock_county_bonfire", stateName: "Idaho", place: "Bannock County", buyer: "Bannock County, Idaho", idPrefix: "bannockcountybonfire" },
  { tenant: "bernco", source: "nm_bernalillo_county_bonfire", stateName: "New Mexico", place: "Bernalillo County", buyer: "Bernalillo County, New Mexico", idPrefix: "berncobonfire" },
  { tenant: "rocklandgov", source: "ny_rockland_county_bonfire", stateName: "New York", place: "Rockland County", buyer: "Rockland County, New York", idPrefix: "rocklandgovbonfire" },
  { tenant: "alleghenycountydhs", source: "pa_allegheny_dhs_bonfire", stateName: "Pennsylvania", place: "Allegheny County", buyer: "Allegheny County Department of Human Services", idPrefix: "alleghenycountydhsbonfire", location: "Allegheny County, PA" },
  { tenant: "cobbk12", source: "ga_cobb_schools_bonfire", stateName: "Georgia", place: "Cobb County School District", buyer: "Cobb County School District", idPrefix: "cobbk12bonfire", location: "Cobb County, GA" },
  { tenant: "fairfaxcountyeda", source: "va_fairfax_eda_bonfire", stateName: "Virginia", place: "Fairfax County", buyer: "Fairfax County Economic Development Authority", idPrefix: "fairfaxcountyedabonfire", location: "Fairfax County, VA" },
  { tenant: "charlestoncounty", source: "sc_charleston_county_bonfire", stateName: "South Carolina", place: "Charleston County", buyer: "Charleston County, South Carolina", idPrefix: "charlestoncountybonfire" },
  // North Carolina, Georgia and West Virginia (owner 2026-10-30: "and NC", "and GA", "then WVA").
  { tenant: "wake", source: "nc_wake_county_bonfire", stateName: "North Carolina", place: "Wake County", buyer: "Wake County, North Carolina", idPrefix: "wakebonfire" },
  { tenant: "charlottenc", source: "nc_charlotte_bonfire", stateName: "North Carolina", place: "Charlotte", buyer: "City of Charlotte, North Carolina", idPrefix: "charlottencbonfire" },
  { tenant: "chathamcountyga", source: "ga_chatham_county_bonfire", stateName: "Georgia", place: "Chatham County", buyer: "Chatham County, Georgia", idPrefix: "chathamcountygabonfire" },
  { tenant: "floydcountyga", source: "ga_floyd_county_bonfire", stateName: "Georgia", place: "Floyd County", buyer: "Floyd County, Georgia", idPrefix: "floydcountygabonfire" },
  { tenant: "roswellgov", source: "ga_roswell_bonfire", stateName: "Georgia", place: "Roswell", buyer: "City of Roswell, Georgia", idPrefix: "roswellgovbonfire" },
  { tenant: "pauldingk12", source: "ga_paulding_schools_bonfire", stateName: "Georgia", place: "Paulding County Schools", buyer: "Paulding County Schools", idPrefix: "pauldingk12bonfire", location: "Paulding County, GA" },
  { tenant: "marshall", source: "wv_marshall_university_bonfire", stateName: "West Virginia", place: "Marshall University", buyer: "Marshall University", idPrefix: "marshallbonfire", location: "Huntington, WV" },
];

export const COUNTY_BONFIRE_CONFIGS: readonly BonfireConfig[] = BOARDS.map(boardConfig);

export function countyBonfireConfig(source: string): BonfireConfig {
  const cfg = COUNTY_BONFIRE_CONFIGS.find((c) => c.source === source);
  if (!cfg) throw new Error(`unknown county Bonfire source ${source}`);
  return cfg;
}

export function parseCountyBonfire(source: string, payload: BonfirePayload, now = Date.now()) {
  return parseBonfire(countyBonfireConfig(source), payload, now);
}

/** One scheduled entry per board, so each source fails and reports on its own. */
export const COUNTY_BONFIRE_SOURCES: readonly { name: string; fetchFn: (now?: number) => Promise<FetchResult> }[] =
  COUNTY_BONFIRE_CONFIGS.map((cfg) => ({
    name: cfg.source,
    fetchFn: (now: number = Date.now()) => fetchBonfireBids(cfg, now),
  }));
