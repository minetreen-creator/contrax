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
  Michigan: "MI", California: "CA", "North Carolina": "NC", "West Virginia": "WV", Indiana: "IN",
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
  // Florida (owner 2026-10-30: "Yes" to a Florida board hunt after "IT services, FL" returned 5 matches).
  { tenant: "pascocountyfl", source: "fl_pasco_county_bonfire", stateName: "Florida", place: "Pasco County", buyer: "Pasco County, Florida", idPrefix: "pascocountyflbonfire" },
  { tenant: "indianriver", source: "fl_indian_river_county_bonfire", stateName: "Florida", place: "Indian River County", buyer: "Indian River County, Florida", idPrefix: "indianriverbonfire" },
  { tenant: "talgov", source: "fl_tallahassee_bonfire", stateName: "Florida", place: "Tallahassee", buyer: "City of Tallahassee, Florida", idPrefix: "talgovbonfire" },
  { tenant: "fau", source: "fl_fau_bonfire", stateName: "Florida", place: "Florida Atlantic University", buyer: "Florida Atlantic University", idPrefix: "faubonfire", location: "Boca Raton, FL" },
  { tenant: "ucf", source: "fl_ucf_bonfire", stateName: "Florida", place: "University of Central Florida", buyer: "University of Central Florida", idPrefix: "ucfbonfire", location: "Orlando, FL" },
  { tenant: "leeschools", source: "fl_lee_schools_bonfire", stateName: "Florida", place: "The School District of Lee County", buyer: "The School District of Lee County", idPrefix: "leeschoolsbonfire", location: "Lee County, FL" },
  { tenant: "sunrisefl", source: "fl_sunrise_bonfire", stateName: "Florida", place: "Sunrise", buyer: "City of Sunrise, Florida", idPrefix: "sunriseflbonfire" },
  { tenant: "plantation", source: "fl_plantation_bonfire", stateName: "Florida", place: "Plantation", buyer: "City of Plantation, Florida", idPrefix: "plantationbonfire" },
  { tenant: "duvalschools", source: "fl_duval_schools_bonfire", stateName: "Florida", place: "Duval County Public Schools", buyer: "Duval County Public Schools", idPrefix: "duvalschoolsbonfire", location: "Jacksonville, FL" },
  { tenant: "fgcu", source: "fl_fgcu_bonfire", stateName: "Florida", place: "Florida Gulf Coast University", buyer: "Florida Gulf Coast University", idPrefix: "fgcubonfire", location: "Fort Myers, FL" },
  { tenant: "jaxport", source: "fl_jaxport_bonfire", stateName: "Florida", place: "JAXPORT", buyer: "JAXPORT (Jacksonville Port Authority)", idPrefix: "jaxportbonfire", location: "Jacksonville, FL" },
  // Indiana (owner 2026-10-30: "sure" to an Indiana board hunt after "IT services, IN" returned 2 matches).
  { tenant: "indygo", source: "in_indygo_bonfire", stateName: "Indiana", place: "IndyGo", buyer: "IndyGo (Indianapolis Public Transportation Corporation)", idPrefix: "indygobonfire", location: "Indianapolis, IN" },
  { tenant: "fwcs", source: "in_fort_wayne_schools_bonfire", stateName: "Indiana", place: "Fort Wayne Community Schools", buyer: "Fort Wayne Community Schools", idPrefix: "fwcsbonfire", location: "Fort Wayne, IN" },
  // Texas (owner 2026-11-03: "we need more construction bids in TX"; captured 2026-11-03).
  { tenant: "fortworthtexas", source: "tx_fort_worth_bonfire", stateName: "Texas", place: "Fort Worth", buyer: "City of Fort Worth, Texas", idPrefix: "fortworthtexasbonfire" },
  { tenant: "arlingtontx", source: "tx_arlington_bonfire", stateName: "Texas", place: "Arlington", buyer: "City of Arlington, Texas", idPrefix: "arlingtontxbonfire" },
  { tenant: "friscotexas", source: "tx_frisco_bonfire", stateName: "Texas", place: "Frisco", buyer: "City of Frisco, Texas", idPrefix: "friscotexasbonfire" },
  { tenant: "mckinneytexas", source: "tx_mckinney_bonfire", stateName: "Texas", place: "McKinney", buyer: "City of McKinney, Texas", idPrefix: "mckinneytexasbonfire" },
  { tenant: "cor", source: "tx_richardson_bonfire", stateName: "Texas", place: "Richardson", buyer: "City of Richardson, Texas", idPrefix: "corbonfire" },
  { tenant: "roundrocktexas", source: "tx_round_rock_bonfire", stateName: "Texas", place: "Round Rock", buyer: "City of Round Rock, Texas", idPrefix: "roundrocktexasbonfire" },
  { tenant: "leandertx", source: "tx_leander_bonfire", stateName: "Texas", place: "Leander", buyer: "City of Leander, Texas", idPrefix: "leandertxbonfire" },
  { tenant: "templetx", source: "tx_temple_bonfire", stateName: "Texas", place: "Temple", buyer: "City of Temple, Texas", idPrefix: "templetxbonfire" },
  { tenant: "brownsvilletx", source: "tx_brownsville_bonfire", stateName: "Texas", place: "Brownsville", buyer: "City of Brownsville, Texas", idPrefix: "brownsvilletxbonfire" },
  { tenant: "amarillo", source: "tx_amarillo_bonfire", stateName: "Texas", place: "Amarillo", buyer: "City of Amarillo, Texas", idPrefix: "amarillobonfire" },
  { tenant: "cosatx", source: "tx_san_angelo_bonfire", stateName: "Texas", place: "San Angelo", buyer: "City of San Angelo, Texas", idPrefix: "cosatxbonfire" },
  { tenant: "schertz", source: "tx_schertz_bonfire", stateName: "Texas", place: "Schertz", buyer: "City of Schertz, Texas", idPrefix: "schertzbonfire" },
  { tenant: "wylietexas", source: "tx_wylie_bonfire", stateName: "Texas", place: "Wylie", buyer: "City of Wylie, Texas", idPrefix: "wylietexasbonfire" },
  { tenant: "southlake", source: "tx_southlake_bonfire", stateName: "Texas", place: "Southlake", buyer: "City of Southlake, Texas", idPrefix: "southlakebonfire" },
  { tenant: "fortbendcountytx", source: "tx_fort_bend_county_bonfire", stateName: "Texas", place: "Fort Bend County", buyer: "Fort Bend County, Texas", idPrefix: "fortbendcountytxbonfire" },
  { tenant: "wilco", source: "tx_williamson_county_bonfire", stateName: "Texas", place: "Williamson County", buyer: "Williamson County, Texas", idPrefix: "wilcobonfire" },
  { tenant: "johnsoncountytx", source: "tx_johnson_county_bonfire", stateName: "Texas", place: "Johnson County", buyer: "Johnson County, Texas", idPrefix: "johnsoncountytxbonfire" },
  { tenant: "austinisd", source: "tx_austin_isd_bonfire", stateName: "Texas", place: "Austin Independent School District", buyer: "Austin Independent School District", idPrefix: "austinisdbonfire", location: "Austin, TX" },
  { tenant: "dallasisd", source: "tx_dallas_isd_bonfire", stateName: "Texas", place: "Dallas Independent School District", buyer: "Dallas Independent School District", idPrefix: "dallasisdbonfire", location: "Dallas, TX" },
  { tenant: "nisd", source: "tx_northside_isd_bonfire", stateName: "Texas", place: "Northside Independent School District", buyer: "Northside Independent School District", idPrefix: "nisdbonfire", location: "San Antonio, TX" },
  { tenant: "saisd", source: "tx_san_antonio_isd_bonfire", stateName: "Texas", place: "San Antonio Independent School District", buyer: "San Antonio Independent School District", idPrefix: "saisdbonfire", location: "San Antonio, TX" },
  { tenant: "cfisd", source: "tx_cypress_fairbanks_isd_bonfire", stateName: "Texas", place: "Cypress-Fairbanks Independent School District", buyer: "Cypress-Fairbanks Independent School District", idPrefix: "cfisdbonfire", location: "Harris County, TX" },
  { tenant: "fortbendisd", source: "tx_fort_bend_isd_bonfire", stateName: "Texas", place: "Fort Bend Independent School District", buyer: "Fort Bend Independent School District", idPrefix: "fortbendisdbonfire", location: "Sugar Land, TX" },
  { tenant: "garlandisd", source: "tx_garland_isd_bonfire", stateName: "Texas", place: "Garland Independent School District", buyer: "Garland Independent School District", idPrefix: "garlandisdbonfire", location: "Garland, TX" },
  { tenant: "risd", source: "tx_richardson_isd_bonfire", stateName: "Texas", place: "Richardson Independent School District", buyer: "Richardson Independent School District", idPrefix: "risdbonfire", location: "Richardson, TX" },
  { tenant: "kleinisd", source: "tx_klein_isd_bonfire", stateName: "Texas", place: "Klein Independent School District", buyer: "Klein Independent School District", idPrefix: "kleinisdbonfire", location: "Harris County, TX" },
  { tenant: "hayscisd", source: "tx_hays_cisd_bonfire", stateName: "Texas", place: "Hays CISD", buyer: "Hays Consolidated Independent School District", idPrefix: "hayscisdbonfire", location: "Kyle, TX" },
  { tenant: "ccisd", source: "tx_corpus_christi_isd_bonfire", stateName: "Texas", place: "Corpus Christi Independent School District", buyer: "Corpus Christi Independent School District", idPrefix: "ccisdbonfire", location: "Corpus Christi, TX" },
  { tenant: "dfwairport", source: "tx_dfw_airport_bonfire", stateName: "Texas", place: "Dallas Fort Worth International Airport", buyer: "Dallas Fort Worth International Airport", idPrefix: "dfwairportbonfire", location: "DFW Airport, TX" },
  { tenant: "lcra", source: "tx_lcra_bonfire", stateName: "Texas", place: "Lower Colorado River Authority", buyer: "Lower Colorado River Authority (LCRA)", idPrefix: "lcrabonfire", location: "Austin, TX" },
  { tenant: "sara-tx", source: "tx_san_antonio_river_authority_bonfire", stateName: "Texas", place: "San Antonio River Authority", buyer: "San Antonio River Authority", idPrefix: "saratxbonfire", location: "San Antonio, TX" },
  { tenant: "ntmwd", source: "tx_ntmwd_bonfire", stateName: "Texas", place: "North Texas Municipal Water District", buyer: "North Texas Municipal Water District", idPrefix: "ntmwdbonfire", location: "Wylie, TX" },
  { tenant: "dart", source: "tx_dart_bonfire", stateName: "Texas", place: "Dallas Area Rapid Transit", buyer: "Dallas Area Rapid Transit (DART)", idPrefix: "dartbonfire", location: "Dallas, TX" },
  { tenant: "utsystem", source: "tx_ut_system_bonfire", stateName: "Texas", place: "The University of Texas System", buyer: "The University of Texas System", idPrefix: "utsystembonfire", location: "Austin, TX" },
  { tenant: "utexas", source: "tx_ut_austin_bonfire", stateName: "Texas", place: "The University of Texas at Austin", buyer: "The University of Texas at Austin", idPrefix: "utexasbonfire", location: "Austin, TX" },
  { tenant: "utdallas", source: "tx_ut_dallas_bonfire", stateName: "Texas", place: "The University of Texas at Dallas", buyer: "The University of Texas at Dallas", idPrefix: "utdallasbonfire", location: "Richardson, TX" },
  { tenant: "utrgv", source: "tx_utrgv_bonfire", stateName: "Texas", place: "The University of Texas Rio Grande Valley", buyer: "The University of Texas Rio Grande Valley", idPrefix: "utrgvbonfire", location: "Edinburg, TX" },
  { tenant: "uthscsa", source: "tx_ut_health_san_antonio_bonfire", stateName: "Texas", place: "UT Health San Antonio", buyer: "UT Health San Antonio", idPrefix: "uthscsabonfire", location: "San Antonio, TX" },
  { tenant: "tccd", source: "tx_tarrant_county_college_bonfire", stateName: "Texas", place: "Tarrant County College District", buyer: "Tarrant County College District", idPrefix: "tccdbonfire", location: "Fort Worth, TX" },
  { tenant: "hccs", source: "tx_houston_city_college_bonfire", stateName: "Texas", place: "Houston City College", buyer: "Houston City College", idPrefix: "hccsbonfire", location: "Houston, TX" },
  { tenant: "delmar", source: "tx_del_mar_college_bonfire", stateName: "Texas", place: "Del Mar College", buyer: "Del Mar College", idPrefix: "delmarbonfire", location: "Corpus Christi, TX" },
  // Virginia, captured 2026-11-04 (owner: "we need more construction bids in VA").
  { tenant: "fauquiercounty", source: "va_fauquier_county_bonfire", stateName: "Virginia", place: "Fauquier County", buyer: "Fauquier County, Virginia", idPrefix: "fauquiercountybonfire" },
  { tenant: "fcps", source: "va_fairfax_schools_bonfire", stateName: "Virginia", place: "Fairfax County Public Schools", buyer: "Fairfax County Public Schools", idPrefix: "fcpsbonfire", location: "Fairfax County, VA" },
  { tenant: "pwcs", source: "va_prince_william_schools_bonfire", stateName: "Virginia", place: "Prince William County Schools", buyer: "Prince William County Schools", idPrefix: "pwcsbonfire", location: "Prince William County, VA" },
  { tenant: "cnu", source: "va_cnu_bonfire", stateName: "Virginia", place: "Christopher Newport University", buyer: "Christopher Newport University", idPrefix: "cnubonfire", location: "Newport News, VA" },
  { tenant: "chesterfield", source: "va_chesterfield_county_bonfire", stateName: "Virginia", place: "Chesterfield County", buyer: "Chesterfield County, Virginia", idPrefix: "chesterfieldbonfire" },
  { tenant: "loudounwater", source: "va_loudoun_water_bonfire", stateName: "Virginia", place: "Loudoun Water", buyer: "Loudoun Water", idPrefix: "loudounwaterbonfire", location: "Loudoun County, VA" },
  { tenant: "apsva", source: "va_arlington_schools_bonfire", stateName: "Virginia", place: "Arlington Public Schools", buyer: "Arlington Public Schools", idPrefix: "apsvabonfire", location: "Arlington, VA" },
  // California, captured 2026-11-04 (owner: "I can branch out" → "dl all 3").
  { tenant: "lawa", source: "ca_lawa_bonfire", stateName: "California", place: "Los Angeles World Airports", buyer: "Los Angeles World Airports (LAWA)", idPrefix: "lawabonfire", location: "Los Angeles, CA" },
  { tenant: "actransit", source: "ca_ac_transit_bonfire", stateName: "California", place: "AC Transit", buyer: "AC Transit (Alameda-Contra Costa Transit District)", idPrefix: "actransitbonfire", location: "Oakland, CA" },
  { tenant: "sutter", source: "ca_sutter_county_bonfire", stateName: "California", place: "Sutter County", buyer: "Sutter County, California", idPrefix: "sutterbonfire" },
  { tenant: "ventura", source: "ca_ventura_county_bonfire", stateName: "California", place: "County of Ventura", buyer: "County of Ventura, California", idPrefix: "venturabonfire", location: "Ventura County, CA" },
  { tenant: "egusd", source: "ca_elk_grove_schools_bonfire", stateName: "California", place: "Elk Grove Unified School District", buyer: "Elk Grove Unified School District", idPrefix: "egusdbonfire", location: "Elk Grove, CA" },
  { tenant: "alamedacounty", source: "ca_alameda_county_bonfire", stateName: "California", place: "Alameda County", buyer: "Alameda County, California", idPrefix: "alamedacountybonfire" },
  { tenant: "yolocounty", source: "ca_yolo_county_bonfire", stateName: "California", place: "Yolo County", buyer: "Yolo County, California", idPrefix: "yolocountybonfire" },
  { tenant: "cityofirvine", source: "ca_irvine_bonfire", stateName: "California", place: "Irvine", buyer: "City of Irvine, California", idPrefix: "cityofirvinebonfire" },
  { tenant: "oaklandca", source: "ca_oakland_capital_bonfire", stateName: "California", place: "Oakland", buyer: "City of Oakland, Capital Contracts Division", idPrefix: "oaklandcabonfire", location: "Oakland, CA" },
  { tenant: "cityofwestminster", source: "ca_westminster_bonfire", stateName: "California", place: "Westminster", buyer: "City of Westminster, California", idPrefix: "cityofwestminsterbonfire", location: "Westminster, CA" },
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
