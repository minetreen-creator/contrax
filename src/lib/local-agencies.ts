/**
 * Local buyer registry for the city/county and agency landing pages
 * (/bids-in/{state}/{place} and /agency/{slug}).
 *
 * Each entry is EITHER one local source we read directly from the buyer's own
 * board (every row under that source is that buyer's solicitation; the place and
 * state come from its SOURCE_CLASSES record), OR one buyer inside a state portal
 * whose buyer field is structured, matched on that exact buyer name (owner
 * 2026-10-12: Richmond, VA posts on eVA; its own OpenGov portal is behind a bot
 * check, which we never get around). Neither is ever guessed from row text. The
 * test pins every local source in SOURCE_CLASSES to an entry here.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { SOURCE_CLASSES } from "~/lib/source-class";

export interface LocalAgency {
  /** `bids.source` label. */
  source: string;
  /** URL slug for /agency/{slug}. */
  slug: string;
  /** Buyer name as people search for it. */
  name: string;
  /** Exact `bids.agency` value, for a buyer inside a multi-buyer state portal. */
  agencyName?: string;
  /** Place and state for an `agencyName` entry (a portal's source record has none). */
  place?: string;
  stateCode?: string;
  /** Portal an `agencyName` buyer posts on, as shown to visitors. */
  via?: string;
}

export const LOCAL_AGENCIES: LocalAgency[] = [
  { source: "ma_boston", slug: "city-of-boston", name: "City of Boston" },
  { source: "va_virginia_beach_oracle", slug: "city-of-virginia-beach", name: "City of Virginia Beach" },
  { source: "ky_louisville_bonfire", slug: "louisville-metro-government", name: "Louisville Metro Government" },
  { source: "al_mobile", slug: "city-of-mobile", name: "City of Mobile" },
  { source: "al_birmingham_purchasing", slug: "city-of-birmingham", name: "City of Birmingham" },
  { source: "ne_omaha_ionwave", slug: "city-of-omaha", name: "City of Omaha" },
  { source: "nyc_open_data", slug: "city-of-new-york", name: "City of New York" },
  { source: "la_open_data", slug: "city-of-los-angeles", name: "City of Los Angeles" },
  { source: "wi_milwaukee_bonfire", slug: "city-of-milwaukee", name: "City of Milwaukee" },
  { source: "wi_milwaukee_county_bonfire", slug: "milwaukee-county", name: "Milwaukee County" },
  { source: "wi_mps_bonfire", slug: "milwaukee-public-schools", name: "Milwaukee Public Schools" },
  { source: "ca_san_diego_county", slug: "county-of-san-diego", name: "County of San Diego" },
  { source: "ca_sacramento_library_bonfire", slug: "sacramento-public-library", name: "Sacramento Public Library" },
  { source: "il_chicago_dps", slug: "city-of-chicago", name: "City of Chicago" },
  { source: "il_cook_county_bonfire", slug: "cook-county", name: "Cook County" },
  { source: "il_cps_bonfire", slug: "chicago-public-schools", name: "Chicago Public Schools" },
  { source: "il_cook_county_health_bonfire", slug: "cook-county-health", name: "Cook County Health" },
  { source: "md_montgomery", slug: "montgomery-county-md", name: "Montgomery County, Maryland" },
  { source: "va_colonial_heights", slug: "city-of-colonial-heights", name: "City of Colonial Heights" },
  { source: "va_loudoun", slug: "loudoun-county", name: "Loudoun County" },
  { source: "tx_dallas_bonfire", slug: "city-of-dallas", name: "City of Dallas" },
  { source: "nc_gastonia", slug: "city-of-gastonia", name: "City of Gastonia" },
  { source: "nc_wayne_county", slug: "wayne-county-nc", name: "Wayne County, North Carolina" },
  { source: "nc_gaston_county", slug: "gaston-county", name: "Gaston County" },
  { source: "va_suffolk", slug: "city-of-suffolk", name: "City of Suffolk" },
  { source: "va_lynchburg", slug: "city-of-lynchburg", name: "City of Lynchburg" },
  { source: "va_charlottesville", slug: "city-of-charlottesville", name: "City of Charlottesville" },
  { source: "va_fairfax_bonfire", slug: "fairfax-county", name: "Fairfax County" },
  { source: "va_alexandria_bonfire", slug: "city-of-alexandria", name: "City of Alexandria" },
  { source: "va_botetourt_bonfire", slug: "botetourt-county", name: "Botetourt County" },
  { source: "fl_broward_bonfire", slug: "broward-county", name: "Broward County" },
  { source: "fl_miami_dade", slug: "miami-dade-county", name: "Miami-Dade County" },
  { source: "nj_panynj_bonfire", slug: "port-authority-ny-nj", name: "Port Authority of New York and New Jersey" },
  { source: "tx_harris_bonfire", slug: "harris-county-tx", name: "Harris County, Texas" },
  { source: "fl_hillsborough_bonfire", slug: "hillsborough-county-fl", name: "Hillsborough County, Florida" },
  { source: "ga_forsyth_bonfire", slug: "forsyth-county-ga", name: "Forsyth County, Georgia" },
  { source: "ga_columbia_bonfire", slug: "columbia-county-ga", name: "Columbia County, Georgia" },
  { source: "fl_monroe_bonfire", slug: "monroe-county-fl", name: "Monroe County, Florida" },
  { source: "tn_montgomery_bonfire", slug: "montgomery-county-tn", name: "Montgomery County, Tennessee" },
  { source: "tx_hood_bonfire", slug: "hood-county-tx", name: "Hood County, Texas" },
  { source: "tx_parker_bonfire", slug: "parker-county-tx", name: "Parker County, Texas" },
  { source: "ga_alpharetta_bonfire", slug: "city-of-alpharetta", name: "City of Alpharetta, Georgia" },
  { source: "tx_denton_bonfire", slug: "denton-county-tx", name: "Denton County, Texas" },
  { source: "va_hopewell", slug: "city-of-hopewell", name: "City of Hopewell" },
  { source: "va_danville", slug: "city-of-danville", name: "City of Danville" },
  { source: "va_salem", slug: "city-of-salem-va", name: "City of Salem, Virginia" },
  { source: "va_pittsylvania", slug: "pittsylvania-county", name: "Pittsylvania County" },
  { source: "va_williamsburg", slug: "city-of-williamsburg", name: "City of Williamsburg" },
  { source: "md_hagerstown", slug: "city-of-hagerstown", name: "City of Hagerstown" },
  { source: "md_queen_annes", slug: "queen-annes-county-md", name: "Queen Anne's County, Maryland" },
  { source: "md_college_park", slug: "city-of-college-park", name: "City of College Park" },
  { source: "nc_high_point", slug: "city-of-high-point", name: "City of High Point" },
  { source: "nc_pitt_county", slug: "pitt-county-nc", name: "Pitt County, North Carolina" },
  { source: "fl_bay_county", slug: "bay-county-fl", name: "Bay County, Florida" },
  { source: "fl_titusville", slug: "city-of-titusville", name: "City of Titusville" },
  { source: "ga_hall_county", slug: "hall-county-ga", name: "Hall County, Georgia" },
  { source: "ga_barrow_county", slug: "barrow-county-ga", name: "Barrow County, Georgia" },
  { source: "tx_league_city", slug: "city-of-league-city", name: "City of League City" },
  { source: "tx_longview", slug: "city-of-longview-tx", name: "City of Longview, Texas" },
  { source: "tx_midland", slug: "city-of-midland-tx", name: "City of Midland, Texas" },
  { source: "tx_odessa", slug: "city-of-odessa-tx", name: "City of Odessa, Texas" },
  { source: "az_yuma_bonfire", slug: "city-of-yuma", name: "City of Yuma, Arizona" },
  { source: "az_buckeye_bonfire", slug: "city-of-buckeye", name: "City of Buckeye, Arizona" },
  { source: "az_mcccd_bonfire", slug: "maricopa-community-colleges", name: "Maricopa County Community Colleges" },
  { source: "az_prescott_valley_bonfire", slug: "town-of-prescott-valley", name: "Town of Prescott Valley, Arizona" },
  { source: "az_peoria_bonfire", slug: "city-of-peoria-az", name: "City of Peoria, Arizona" },
  { source: "az_scottsdale_bonfire", slug: "city-of-scottsdale", name: "City of Scottsdale, Arizona" },
  { source: "az_goodyear_bonfire", slug: "city-of-goodyear", name: "City of Goodyear, Arizona" },
  { source: "az_pinal_bonfire", slug: "pinal-county-az", name: "Pinal County, Arizona" },
  { source: "az_sedona_bonfire", slug: "city-of-sedona", name: "City of Sedona, Arizona" },
  { source: "az_tempe_bonfire", slug: "city-of-tempe", name: "City of Tempe, Arizona" },
  { source: "az_mesa_engineering", slug: "city-of-mesa", name: "City of Mesa, Arizona" },
  { source: "az_maricopa_bidnet", slug: "maricopa-county-az", name: "Maricopa County, Arizona" },
  { source: "az_lake_havasu", slug: "city-of-lake-havasu-city", name: "City of Lake Havasu City" },
  { source: "az_casa_grande", slug: "city-of-casa-grande", name: "City of Casa Grande" },
  { source: "az_douglas", slug: "city-of-douglas-az", name: "City of Douglas, Arizona" },
  { source: "mo_kansas_city_bonfire", slug: "city-of-kansas-city-mo", name: "City of Kansas City, Missouri" },
  { source: "mo_st_louis_county_bonfire", slug: "st-louis-county-mo", name: "St. Louis County, Missouri" },
  { source: "mo_jackson_county_bonfire", slug: "jackson-county-mo", name: "Jackson County, Missouri" },
  { source: "mo_jefferson_city_bonfire", slug: "city-of-jefferson-city", name: "City of Jefferson City, Missouri" },
  { source: "mo_slps_bonfire", slug: "saint-louis-public-schools", name: "Saint Louis Public Schools" },
  { source: "mo_springfield", slug: "city-of-springfield-mo", name: "City of Springfield, Missouri" },
  { source: "mo_st_charles_county", slug: "st-charles-county-mo", name: "St. Charles County, Missouri" },
  { source: "mo_st_charles", slug: "city-of-st-charles-mo", name: "City of St. Charles, Missouri" },
  { source: "mo_liberty", slug: "city-of-liberty-mo", name: "City of Liberty, Missouri" },
  { source: "mo_ozark", slug: "city-of-ozark-mo", name: "City of Ozark, Missouri" },
  { source: "mo_ballwin", slug: "city-of-ballwin", name: "City of Ballwin" },
  { source: "in_lafayette", slug: "city-of-lafayette-in", name: "City of Lafayette, Indiana" },
  { source: "in_zionsville", slug: "town-of-zionsville", name: "Town of Zionsville" },
  { source: "in_carmel", slug: "city-of-carmel-in", name: "City of Carmel, Indiana" },
  { source: "in_hamilton_county", slug: "hamilton-county-in", name: "Hamilton County, Indiana" },
  { source: "in_tippecanoe_county", slug: "tippecanoe-county-in", name: "Tippecanoe County, Indiana" },
  { source: "in_anderson", slug: "city-of-anderson-in", name: "City of Anderson, Indiana" },
  { source: "in_avon", slug: "town-of-avon-in", name: "Town of Avon, Indiana" },
  { source: "in_brownsburg", slug: "town-of-brownsburg", name: "Town of Brownsburg" },
  { source: "nj_cherry_hill", slug: "cherry-hill-township-nj", name: "Cherry Hill Township, New Jersey" },
  { source: "nj_trenton", slug: "city-of-trenton-nj", name: "City of Trenton, New Jersey" },
  { source: "nj_cranford", slug: "township-of-cranford-nj", name: "Township of Cranford, New Jersey" },
  { source: "nj_fort_lee", slug: "borough-of-fort-lee-nj", name: "Borough of Fort Lee, New Jersey" },
  { source: "nj_west_orange", slug: "township-of-west-orange-nj", name: "Township of West Orange, New Jersey" },
  { source: "nj_princeton", slug: "municipality-of-princeton-nj", name: "Municipality of Princeton, New Jersey" },
  { source: "nj_millville", slug: "city-of-millville-nj", name: "City of Millville, New Jersey" },
  { source: "nj_livingston", slug: "township-of-livingston-nj", name: "Township of Livingston, New Jersey" },
  { source: "nj_mahwah", slug: "township-of-mahwah-nj", name: "Township of Mahwah, New Jersey" },
  { source: "nj_wall", slug: "wall-township-nj", name: "Wall Township, New Jersey" },
  { source: "nj_ridgewood", slug: "village-of-ridgewood-nj", name: "Village of Ridgewood, New Jersey" },
  { source: "nj_westfield", slug: "town-of-westfield-nj", name: "Town of Westfield, New Jersey" },
  { source: "nj_montgomery", slug: "montgomery-township-nj", name: "Montgomery Township, New Jersey" },
  { source: "nj_east_brunswick", slug: "township-of-east-brunswick-nj", name: "Township of East Brunswick, New Jersey" },
  { source: "md_harford_bonfire", slug: "harford-county-md", name: "Harford County, Maryland" },
  { source: "md_stadium_authority_bonfire", slug: "maryland-stadium-authority", name: "Maryland Stadium Authority" },
  { source: "co_boulder_county_bonfire", slug: "boulder-county-co", name: "Boulder County, Colorado" },
  { source: "oh_akron_bonfire", slug: "city-of-akron-oh", name: "City of Akron, Ohio" },
  { source: "oh_cincinnati_bonfire", slug: "city-of-cincinnati-oh", name: "City of Cincinnati, Ohio" },
  { source: "oh_westerville_bonfire", slug: "city-of-westerville-oh", name: "City of Westerville, Ohio" },
  { source: "tx_galveston_county_bonfire", slug: "galveston-county-tx", name: "Galveston County, Texas" },
  { source: "tx_lewisville_bonfire", slug: "city-of-lewisville-tx", name: "City of Lewisville, Texas" },
  { source: "tx_lubbock_county_bonfire", slug: "lubbock-county-tx", name: "Lubbock County, Texas" },
  { source: "tx_reeves_county_bonfire", slug: "reeves-county-tx", name: "Reeves County, Texas" },
  { source: "tx_hutchins_bonfire", slug: "city-of-hutchins-tx", name: "City of Hutchins, Texas" },
  { source: "id_meridian_bonfire", slug: "city-of-meridian-id", name: "City of Meridian, Idaho" },
  { source: "mi_muskegon_county_bonfire", slug: "muskegon-county-mi", name: "Muskegon County, Michigan" },
  { source: "ca_solano_county_bonfire", slug: "solano-county-ca", name: "Solano County, California" },
  { source: "az_cochise_county_bonfire", slug: "cochise-county-az", name: "Cochise County, Arizona" },
  { source: "id_bannock_county_bonfire", slug: "bannock-county-id", name: "Bannock County, Idaho" },
  { source: "nm_bernalillo_county_bonfire", slug: "bernalillo-county-nm", name: "Bernalillo County, New Mexico" },
  { source: "ny_rockland_county_bonfire", slug: "rockland-county-ny", name: "Rockland County, New York" },
  { source: "pa_allegheny_dhs_bonfire", slug: "allegheny-county-dhs-pa", name: "Allegheny County Department of Human Services" },
  { source: "ga_cobb_schools_bonfire", slug: "cobb-county-school-district", name: "Cobb County School District" },
  { source: "va_fairfax_eda_bonfire", slug: "fairfax-county-eda", name: "Fairfax County Economic Development Authority" },
  { source: "sc_charleston_county_bonfire", slug: "charleston-county-sc", name: "Charleston County, South Carolina" },
  { source: "mt_billings", slug: "city-of-billings-mt", name: "City of Billings, Montana" },
  { source: "mt_missoula", slug: "city-of-missoula-mt", name: "City of Missoula, Montana" },
  { source: "mt_butte_silver_bow", slug: "butte-silver-bow-mt", name: "Butte-Silver Bow, Montana" },
  { source: "mt_kalispell", slug: "city-of-kalispell-mt", name: "City of Kalispell, Montana" },
  { source: "mt_cascade_county", slug: "cascade-county-mt", name: "Cascade County, Montana" },
  { source: "mt_gallatin_county", slug: "gallatin-county-mt", name: "Gallatin County, Montana" },
  { source: "sc_charleston", slug: "city-of-charleston-sc", name: "City of Charleston, South Carolina" },
  { source: "sc_spartanburg", slug: "city-of-spartanburg-sc", name: "City of Spartanburg, South Carolina" },
  { source: "sc_mount_pleasant", slug: "town-of-mount-pleasant-sc", name: "Town of Mount Pleasant, South Carolina" },
  { source: "sc_summerville", slug: "town-of-summerville-sc", name: "Town of Summerville, South Carolina" },
  { source: "sc_fort_mill", slug: "town-of-fort-mill-sc", name: "Town of Fort Mill, South Carolina" },
  { source: "nc_wake_county_bonfire", slug: "wake-county-nc", name: "Wake County, North Carolina" },
  { source: "nc_charlotte_bonfire", slug: "city-of-charlotte-nc", name: "City of Charlotte, North Carolina" },
  { source: "ga_chatham_county_bonfire", slug: "chatham-county-ga", name: "Chatham County, Georgia" },
  { source: "ga_floyd_county_bonfire", slug: "floyd-county-ga", name: "Floyd County, Georgia" },
  { source: "ga_roswell_bonfire", slug: "city-of-roswell-ga", name: "City of Roswell, Georgia" },
  { source: "ga_paulding_schools_bonfire", slug: "paulding-county-schools-ga", name: "Paulding County Schools" },
  { source: "wv_marshall_university_bonfire", slug: "marshall-university", name: "Marshall University" },
  { source: "nc_apex", slug: "town-of-apex-nc", name: "Town of Apex, North Carolina" },
  { source: "nc_winston_salem", slug: "city-of-winston-salem-nc", name: "City of Winston-Salem, North Carolina" },
  { source: "nc_brunswick_county", slug: "brunswick-county-nc", name: "Brunswick County, North Carolina" },
  { source: "nc_new_hanover_county", slug: "new-hanover-county-nc", name: "New Hanover County, North Carolina" },
  { source: "nc_burlington", slug: "city-of-burlington-nc", name: "City of Burlington, North Carolina" },
  { source: "nc_iredell_county", slug: "iredell-county-nc", name: "Iredell County, North Carolina" },
  { source: "nc_jacksonville", slug: "city-of-jacksonville-nc", name: "City of Jacksonville, North Carolina" },
  { source: "nc_rowan_county", slug: "rowan-county-nc", name: "Rowan County, North Carolina" },
  { source: "ga_peachtree_city", slug: "city-of-peachtree-city-ga", name: "City of Peachtree City, Georgia" },
  { source: "ga_lowndes_county", slug: "lowndes-county-ga", name: "Lowndes County, Georgia" },
  { source: "ga_lawrenceville", slug: "city-of-lawrenceville-ga", name: "City of Lawrenceville, Georgia" },
  { source: "ga_newnan", slug: "city-of-newnan-ga", name: "City of Newnan, Georgia" },
  { source: "ga_liberty_county", slug: "liberty-county-ga", name: "Liberty County, Georgia" },
  { source: "ga_savannah", slug: "city-of-savannah-ga", name: "City of Savannah, Georgia" },
  { source: "ga_athens_clarke", slug: "athens-clarke-county-ga", name: "Athens-Clarke County, Georgia" },
  { source: "ga_douglas_county", slug: "douglas-county-ga", name: "Douglas County, Georgia" },
  { source: "ga_coweta_county", slug: "coweta-county-ga", name: "Coweta County, Georgia" },
  { source: "ga_carroll_county", slug: "carroll-county-ga", name: "Carroll County, Georgia" },
  { source: "ga_effingham_county", slug: "effingham-county-ga", name: "Effingham County, Georgia" },
  { source: "ga_dawson_county", slug: "dawson-county-ga", name: "Dawson County, Georgia" },
  { source: "ga_jackson_county", slug: "jackson-county-ga", name: "Jackson County, Georgia" },
  { source: "ga_rome", slug: "city-of-rome-ga", name: "City of Rome, Georgia" },
  { source: "wv_fairmont", slug: "city-of-fairmont-wv", name: "City of Fairmont, West Virginia" },
  { source: "wv_berkeley_county", slug: "berkeley-county-wv", name: "Berkeley County, West Virginia" },
  { source: "wv_vienna", slug: "city-of-vienna-wv", name: "City of Vienna, West Virginia" },
  { source: "wv_weirton", slug: "city-of-weirton-wv", name: "City of Weirton, West Virginia" },
  { source: "wv_morgantown", slug: "city-of-morgantown-wv", name: "City of Morgantown, West Virginia" },
  { source: "tn_pigeon_forge", slug: "city-of-pigeon-forge-tn", name: "City of Pigeon Forge, Tennessee" },
  { source: "tn_la_vergne", slug: "city-of-la-vergne-tn", name: "City of La Vergne, Tennessee" },
  { source: "tn_mt_juliet", slug: "city-of-mt-juliet-tn", name: "City of Mt. Juliet, Tennessee" },
  { source: "tn_spring_hill", slug: "city-of-spring-hill-tn", name: "City of Spring Hill, Tennessee" },
  { source: "tn_cookeville", slug: "city-of-cookeville-tn", name: "City of Cookeville, Tennessee" },
  { source: "tn_oak_ridge", slug: "city-of-oak-ridge-tn", name: "City of Oak Ridge, Tennessee" },
  { source: "tn_lebanon", slug: "city-of-lebanon-tn", name: "City of Lebanon, Tennessee" },
  { source: "tn_gallatin", slug: "city-of-gallatin-tn", name: "City of Gallatin, Tennessee" },
  { source: "tn_cleveland", slug: "city-of-cleveland-tn", name: "City of Cleveland, Tennessee" },
  { source: "tn_goodlettsville", slug: "city-of-goodlettsville-tn", name: "City of Goodlettsville, Tennessee" },
  { source: "tn_white_house", slug: "city-of-white-house-tn", name: "City of White House, Tennessee" },
  { source: "tn_springfield", slug: "city-of-springfield-tn", name: "City of Springfield, Tennessee" },
  { source: "tn_wilson_county", slug: "wilson-county-tn", name: "Wilson County, Tennessee" },
  { source: "tn_maury_county", slug: "maury-county-tn", name: "Maury County, Tennessee" },
  { source: "tn_washington_county", slug: "washington-county-tn", name: "Washington County, Tennessee" },
  { source: "tn_coffee_county", slug: "coffee-county-tn", name: "Coffee County, Tennessee" },
  { source: "fl_pasco_county_bonfire", slug: "pasco-county-fl", name: "Pasco County, Florida" },
  { source: "fl_indian_river_county_bonfire", slug: "indian-river-county-fl", name: "Indian River County, Florida" },
  { source: "fl_tallahassee_bonfire", slug: "city-of-tallahassee-fl", name: "City of Tallahassee, Florida" },
  { source: "fl_fau_bonfire", slug: "florida-atlantic-university", name: "Florida Atlantic University" },
  { source: "fl_ucf_bonfire", slug: "university-of-central-florida", name: "University of Central Florida" },
  { source: "fl_lee_schools_bonfire", slug: "school-district-of-lee-county", name: "The School District of Lee County" },
  { source: "fl_sunrise_bonfire", slug: "city-of-sunrise-fl", name: "City of Sunrise, Florida" },
  { source: "fl_plantation_bonfire", slug: "city-of-plantation-fl", name: "City of Plantation, Florida" },
  { source: "fl_duval_schools_bonfire", slug: "duval-county-public-schools", name: "Duval County Public Schools" },
  { source: "fl_fgcu_bonfire", slug: "florida-gulf-coast-university", name: "Florida Gulf Coast University" },
  { source: "fl_jaxport_bonfire", slug: "jaxport", name: "JAXPORT (Jacksonville Port Authority)" },
  { source: "fl_pensacola", slug: "city-of-pensacola-fl", name: "City of Pensacola, Florida" },
  { source: "fl_florida_city", slug: "city-of-florida-city-fl", name: "City of Florida City, Florida" },
  { source: "fl_cocoa", slug: "city-of-cocoa-fl", name: "City of Cocoa, Florida" },
  { source: "fl_wellington", slug: "village-of-wellington-fl", name: "Village of Wellington, Florida" },
  { source: "fl_miami_gardens", slug: "city-of-miami-gardens-fl", name: "City of Miami Gardens, Florida" },
  { source: "fl_casselberry", slug: "city-of-casselberry-fl", name: "City of Casselberry, Florida" },
  { source: "fl_new_smyrna_beach", slug: "city-of-new-smyrna-beach-fl", name: "City of New Smyrna Beach, Florida" },
  { source: "fl_levy_county", slug: "levy-county-fl", name: "Levy County, Florida" },
  { source: "in_indygo_bonfire", slug: "indygo", name: "IndyGo (Indianapolis Public Transportation Corporation)" },
  { source: "in_fort_wayne_schools_bonfire", slug: "fort-wayne-community-schools", name: "Fort Wayne Community Schools" },
  { source: "in_crown_point", slug: "city-of-crown-point-in", name: "City of Crown Point, Indiana" },
  { source: "in_shelbyville", slug: "city-of-shelbyville-in", name: "City of Shelbyville, Indiana" },
  { source: "in_westfield", slug: "city-of-westfield-in", name: "City of Westfield, Indiana" },
  { source: "in_crawfordsville", slug: "city-of-crawfordsville-in", name: "City of Crawfordsville, Indiana" },
  // Texas boards added 2026-11-03.
  { source: "tx_fort_worth_bonfire", slug: "city-of-fort-worth-tx", name: "City of Fort Worth, Texas" },
  { source: "tx_arlington_bonfire", slug: "city-of-arlington-tx", name: "City of Arlington, Texas" },
  { source: "tx_frisco_bonfire", slug: "city-of-frisco-tx", name: "City of Frisco, Texas" },
  { source: "tx_mckinney_bonfire", slug: "city-of-mckinney-tx", name: "City of McKinney, Texas" },
  { source: "tx_richardson_bonfire", slug: "city-of-richardson-tx", name: "City of Richardson, Texas" },
  { source: "tx_round_rock_bonfire", slug: "city-of-round-rock-tx", name: "City of Round Rock, Texas" },
  { source: "tx_leander_bonfire", slug: "city-of-leander-tx", name: "City of Leander, Texas" },
  { source: "tx_temple_bonfire", slug: "city-of-temple-tx", name: "City of Temple, Texas" },
  { source: "tx_brownsville_bonfire", slug: "city-of-brownsville-tx", name: "City of Brownsville, Texas" },
  { source: "tx_amarillo_bonfire", slug: "city-of-amarillo-tx", name: "City of Amarillo, Texas" },
  { source: "tx_san_angelo_bonfire", slug: "city-of-san-angelo-tx", name: "City of San Angelo, Texas" },
  { source: "tx_schertz_bonfire", slug: "city-of-schertz-tx", name: "City of Schertz, Texas" },
  { source: "tx_wylie_bonfire", slug: "city-of-wylie-tx", name: "City of Wylie, Texas" },
  { source: "tx_southlake_bonfire", slug: "city-of-southlake-tx", name: "City of Southlake, Texas" },
  { source: "tx_fort_bend_county_bonfire", slug: "fort-bend-county-tx", name: "Fort Bend County, Texas" },
  { source: "tx_williamson_county_bonfire", slug: "williamson-county-tx", name: "Williamson County, Texas" },
  { source: "tx_johnson_county_bonfire", slug: "johnson-county-tx", name: "Johnson County, Texas" },
  { source: "tx_austin_isd_bonfire", slug: "austin-independent-school-district", name: "Austin Independent School District" },
  { source: "tx_dallas_isd_bonfire", slug: "dallas-independent-school-district", name: "Dallas Independent School District" },
  { source: "tx_northside_isd_bonfire", slug: "northside-independent-school-district", name: "Northside Independent School District" },
  { source: "tx_san_antonio_isd_bonfire", slug: "san-antonio-independent-school-district", name: "San Antonio Independent School District" },
  { source: "tx_cypress_fairbanks_isd_bonfire", slug: "cypress-fairbanks-independent-school-district", name: "Cypress-Fairbanks Independent School District" },
  { source: "tx_fort_bend_isd_bonfire", slug: "fort-bend-independent-school-district", name: "Fort Bend Independent School District" },
  { source: "tx_garland_isd_bonfire", slug: "garland-independent-school-district", name: "Garland Independent School District" },
  { source: "tx_richardson_isd_bonfire", slug: "richardson-independent-school-district", name: "Richardson Independent School District" },
  { source: "tx_klein_isd_bonfire", slug: "klein-independent-school-district", name: "Klein Independent School District" },
  { source: "tx_hays_cisd_bonfire", slug: "hays-consolidated-independent-school-district", name: "Hays Consolidated Independent School District" },
  { source: "tx_corpus_christi_isd_bonfire", slug: "corpus-christi-independent-school-district", name: "Corpus Christi Independent School District" },
  { source: "tx_dfw_airport_bonfire", slug: "dallas-fort-worth-international-airport", name: "Dallas Fort Worth International Airport" },
  { source: "tx_lcra_bonfire", slug: "lower-colorado-river-authority-lcra", name: "Lower Colorado River Authority (LCRA)" },
  { source: "tx_san_antonio_river_authority_bonfire", slug: "san-antonio-river-authority", name: "San Antonio River Authority" },
  { source: "tx_ntmwd_bonfire", slug: "north-texas-municipal-water-district", name: "North Texas Municipal Water District" },
  { source: "tx_dart_bonfire", slug: "dallas-area-rapid-transit-dart", name: "Dallas Area Rapid Transit (DART)" },
  { source: "tx_ut_system_bonfire", slug: "the-university-of-texas-system", name: "The University of Texas System" },
  { source: "tx_ut_austin_bonfire", slug: "the-university-of-texas-at-austin", name: "The University of Texas at Austin" },
  { source: "tx_ut_dallas_bonfire", slug: "the-university-of-texas-at-dallas", name: "The University of Texas at Dallas" },
  { source: "tx_utrgv_bonfire", slug: "the-university-of-texas-rio-grande-valley", name: "The University of Texas Rio Grande Valley" },
  { source: "tx_ut_health_san_antonio_bonfire", slug: "ut-health-san-antonio", name: "UT Health San Antonio" },
  { source: "tx_tarrant_county_college_bonfire", slug: "tarrant-county-college-district", name: "Tarrant County College District" },
  { source: "tx_houston_city_college_bonfire", slug: "houston-city-college", name: "Houston City College" },
  { source: "tx_del_mar_college_bonfire", slug: "del-mar-college", name: "Del Mar College" },
  { source: "tx_garland", slug: "city-of-garland-tx", name: "City of Garland, Texas" },
  { source: "tx_mesquite", slug: "city-of-mesquite-tx", name: "City of Mesquite, Texas" },
  { source: "tx_san_marcos", slug: "city-of-san-marcos-tx", name: "City of San Marcos, Texas" },
  { source: "tx_killeen", slug: "city-of-killeen-tx", name: "City of Killeen, Texas" },
  { source: "tx_abilene", slug: "city-of-abilene-tx", name: "City of Abilene, Texas" },
  { source: "tx_missouri_city", slug: "city-of-missouri-city-tx", name: "City of Missouri City, Texas" },
  { source: "tx_baytown", slug: "city-of-baytown-tx", name: "City of Baytown, Texas" },
  { source: "tx_pasadena", slug: "city-of-pasadena-tx", name: "City of Pasadena, Texas" },
  { source: "tx_friendswood", slug: "city-of-friendswood-tx", name: "City of Friendswood, Texas" },
  { source: "tx_texas_city", slug: "city-of-texas-city-tx", name: "City of Texas City, Texas" },
  { source: "tx_lake_jackson", slug: "city-of-lake-jackson-tx", name: "City of Lake Jackson, Texas" },
  { source: "tx_victoria", slug: "city-of-victoria-tx", name: "City of Victoria, Texas" },
  { source: "tx_buda", slug: "city-of-buda-tx", name: "City of Buda, Texas" },
  { source: "tx_boerne", slug: "city-of-boerne-tx", name: "City of Boerne, Texas" },
  { source: "tx_universal_city", slug: "city-of-universal-city-tx", name: "City of Universal City, Texas" },
  { source: "tx_kerrville", slug: "city-of-kerrville-tx", name: "City of Kerrville, Texas" },
  { source: "tx_fredericksburg", slug: "city-of-fredericksburg-tx", name: "City of Fredericksburg, Texas" },
  { source: "tx_mansfield", slug: "city-of-mansfield-tx", name: "City of Mansfield, Texas" },
  { source: "tx_cedar_hill", slug: "city-of-cedar-hill-tx", name: "City of Cedar Hill, Texas" },
  { source: "tx_desoto", slug: "city-of-desoto-tx", name: "City of DeSoto, Texas" },
  { source: "tx_duncanville", slug: "city-of-duncanville-tx", name: "City of Duncanville, Texas" },
  { source: "tx_lancaster", slug: "city-of-lancaster-tx", name: "City of Lancaster, Texas" },
  { source: "tx_rowlett", slug: "city-of-rowlett-tx", name: "City of Rowlett, Texas" },
  { source: "tx_sachse", slug: "city-of-sachse-tx", name: "City of Sachse, Texas" },
  { source: "tx_murphy", slug: "city-of-murphy-tx", name: "City of Murphy, Texas" },
  { source: "tx_prosper", slug: "town-of-prosper-tx", name: "Town of Prosper, Texas" },
  { source: "tx_little_elm", slug: "town-of-little-elm-tx", name: "Town of Little Elm, Texas" },
  { source: "tx_the_colony", slug: "city-of-the-colony-tx", name: "City of The Colony, Texas" },
  { source: "tx_flower_mound", slug: "town-of-flower-mound-tx", name: "Town of Flower Mound, Texas" },
  { source: "tx_bedford", slug: "city-of-bedford-tx", name: "City of Bedford, Texas" },
  { source: "tx_haltom_city", slug: "city-of-haltom-city-tx", name: "City of Haltom City, Texas" },
  { source: "tx_watauga", slug: "city-of-watauga-tx", name: "City of Watauga, Texas" },
  { source: "tx_azle", slug: "city-of-azle-tx", name: "City of Azle, Texas" },
  { source: "tx_weatherford", slug: "city-of-weatherford-tx", name: "City of Weatherford, Texas" },
  { source: "tx_granbury", slug: "city-of-granbury-tx", name: "City of Granbury, Texas" },
  { source: "tx_midlothian", slug: "city-of-midlothian-tx", name: "City of Midlothian, Texas" },
  { source: "tx_corsicana", slug: "city-of-corsicana-tx", name: "City of Corsicana, Texas" },
  { source: "tx_sherman", slug: "city-of-sherman-tx", name: "City of Sherman, Texas" },
  { source: "tx_denison", slug: "city-of-denison-tx", name: "City of Denison, Texas" },
  { source: "tx_texarkana", slug: "city-of-texarkana-tx", name: "City of Texarkana, Texas" },
  { source: "tx_marshall", slug: "city-of-marshall-tx", name: "City of Marshall, Texas" },
  { source: "tx_nacogdoches", slug: "city-of-nacogdoches-tx", name: "City of Nacogdoches, Texas" },
  { source: "tx_huntsville", slug: "city-of-huntsville-tx", name: "City of Huntsville, Texas" },
  { source: "tx_harker_heights", slug: "city-of-harker-heights-tx", name: "City of Harker Heights, Texas" },
  { source: "tx_copperas_cove", slug: "city-of-copperas-cove-tx", name: "City of Copperas Cove, Texas" },
  { source: "tx_taylor", slug: "city-of-taylor-tx", name: "City of Taylor, Texas" },
  { source: "tx_lakeway", slug: "city-of-lakeway-tx", name: "City of Lakeway, Texas" },
  { source: "tx_lockhart", slug: "city-of-lockhart-tx", name: "City of Lockhart, Texas" },
  { source: "tx_plainview", slug: "city-of-plainview-tx", name: "City of Plainview, Texas" },
  { source: "tx_borger", slug: "city-of-borger-tx", name: "City of Borger, Texas" },
  { source: "tx_port_arthur", slug: "city-of-port-arthur-tx", name: "City of Port Arthur, Texas" },
  { source: "tx_alvin", slug: "city-of-alvin-tx", name: "City of Alvin, Texas" },
  { source: "tx_angleton", slug: "city-of-angleton-tx", name: "City of Angleton, Texas" },
  { source: "tx_la_porte", slug: "city-of-la-porte-tx", name: "City of La Porte, Texas" },
  { source: "tx_seabrook", slug: "city-of-seabrook-tx", name: "City of Seabrook, Texas" },
  { source: "tx_webster", slug: "city-of-webster-tx", name: "City of Webster, Texas" },
  { source: "tx_tomball", slug: "city-of-tomball-tx", name: "City of Tomball, Texas" },
  { source: "tx_bellaire", slug: "city-of-bellaire-tx", name: "City of Bellaire, Texas" },
  { source: "tx_rockport", slug: "city-of-rockport-tx", name: "City of Rockport, Texas" },
  { source: "tx_eagle_pass", slug: "city-of-eagle-pass-tx", name: "City of Eagle Pass, Texas" },
  { source: "tx_donna", slug: "city-of-donna-tx", name: "City of Donna, Texas" },
  { source: "tx_san_benito", slug: "city-of-san-benito-tx", name: "City of San Benito, Texas" },
  { source: "tx_snyder", slug: "city-of-snyder-tx", name: "City of Snyder, Texas" },
  { source: "tx_brownwood", slug: "city-of-brownwood-tx", name: "City of Brownwood, Texas" },
  { source: "tx_stephenville", slug: "city-of-stephenville-tx", name: "City of Stephenville, Texas" },
  { source: "tx_mineral_wells", slug: "city-of-mineral-wells-tx", name: "City of Mineral Wells, Texas" },
  { source: "tx_jacksonville", slug: "city-of-jacksonville-tx", name: "City of Jacksonville, Texas" },
  { source: "tx_kilgore", slug: "city-of-kilgore-tx", name: "City of Kilgore, Texas" },
  { source: "tx_bexar_county", slug: "bexar-county-tx", name: "Bexar County, Texas" },
  { source: "tx_smith_county", slug: "smith-county-tx", name: "Smith County, Texas" },
  { source: "tx_hidalgo_county", slug: "hidalgo-county-tx", name: "Hidalgo County, Texas" },
  { source: "tx_webb_county", slug: "webb-county-tx", name: "Webb County, Texas" },
  { source: "tx_ellis_county", slug: "ellis-county-tx", name: "Ellis County, Texas" },
  { source: "tx_kaufman_county", slug: "kaufman-county-tx", name: "Kaufman County, Texas" },
  { source: "tx_rockwall_county", slug: "rockwall-county-tx", name: "Rockwall County, Texas" },
  { source: "tx_randall_county", slug: "randall-county-tx", name: "Randall County, Texas" },
  { source: "tx_midland_county", slug: "midland-county-tx", name: "Midland County, Texas" },
  { source: "tx_ector_county", slug: "ector-county-tx", name: "Ector County, Texas" },
  { source: "tx_chambers_county", slug: "chambers-county-tx", name: "Chambers County, Texas" },
  { source: "tx_bowie_county", slug: "bowie-county-tx", name: "Bowie County, Texas" },
  { source: "tx_henderson_county", slug: "henderson-county-tx", name: "Henderson County, Texas" },
  { source: "tx_wise_county", slug: "wise-county-tx", name: "Wise County, Texas" },
  { source: "tx_kendall_county", slug: "kendall-county-tx", name: "Kendall County, Texas" },
  { source: "va_roanoke_county", slug: "roanoke-county-va", name: "Roanoke County, Virginia" },
  { source: "va_spotsylvania_county", slug: "spotsylvania-county-va", name: "Spotsylvania County, Virginia" },
  { source: "va_rockingham_county", slug: "rockingham-county-va", name: "Rockingham County, Virginia" },
  { source: "va_warren_county", slug: "warren-county-va", name: "Warren County, Virginia" },
  { source: "va_christiansburg", slug: "town-of-christiansburg-va", name: "Town of Christiansburg, Virginia" },
  { source: "va_radford", slug: "city-of-radford-va", name: "City of Radford, Virginia" },
  { source: "va_campbell_county", slug: "campbell-county-va", name: "Campbell County, Virginia" },
  { source: "va_amherst_county", slug: "amherst-county-va", name: "Amherst County, Virginia" },
  { source: "va_franklin_county", slug: "franklin-county-va", name: "Franklin County, Virginia" },
  { source: "va_henry_county", slug: "henry-county-va", name: "Henry County, Virginia" },
  { source: "va_martinsville", slug: "city-of-martinsville-va", name: "City of Martinsville, Virginia" },
  { source: "va_bristol", slug: "city-of-bristol-va", name: "City of Bristol, Virginia" },
  { source: "va_wise_county", slug: "wise-county-va", name: "Wise County, Virginia" },
  { source: "va_dinwiddie_county", slug: "dinwiddie-county-va", name: "Dinwiddie County, Virginia" },
  { source: "va_falls_church", slug: "city-of-falls-church-va", name: "City of Falls Church, Virginia" },
  { source: "va_purcellville", slug: "town-of-purcellville-va", name: "Town of Purcellville, Virginia" },
  { source: "va_warrenton", slug: "town-of-warrenton-va", name: "Town of Warrenton, Virginia" },
  { source: "va_orange_county", slug: "orange-county-va", name: "Orange County, Virginia" },
  { source: "va_caroline_county", slug: "caroline-county-va", name: "Caroline County, Virginia" },
  { source: "va_norton", slug: "city-of-norton-va", name: "City of Norton, Virginia" },
  { source: "va_king_william_county", slug: "king-william-county-va", name: "King William County, Virginia" },
  { source: "va_surry_county", slug: "surry-county-va", name: "Surry County, Virginia" },
  { source: "va_mecklenburg_county", slug: "mecklenburg-county-va", name: "Mecklenburg County, Virginia" },
  { source: "va_halifax_county", slug: "halifax-county-va", name: "Halifax County, Virginia" },
  { source: "va_cumberland_county", slug: "cumberland-county-va", name: "Cumberland County, Virginia" },
  { source: "va_appomattox_county", slug: "appomattox-county-va", name: "Appomattox County, Virginia" },
  { source: "va_greene_county", slug: "greene-county-va", name: "Greene County, Virginia" },
  { source: "va_madison_county", slug: "madison-county-va", name: "Madison County, Virginia" },
  { source: "va_page_county", slug: "page-county-va", name: "Page County, Virginia" },
  { source: "va_grayson_county", slug: "grayson-county-va", name: "Grayson County, Virginia" },
  { source: "va_patrick_county", slug: "patrick-county-va", name: "Patrick County, Virginia" },
  { source: "va_russell_county", slug: "russell-county-va", name: "Russell County, Virginia" },
  { source: "va_dickenson_county", slug: "dickenson-county-va", name: "Dickenson County, Virginia" },
  { source: "va_scott_county", slug: "scott-county-va", name: "Scott County, Virginia" },
  { source: "va_ashland", slug: "town-of-ashland-va", name: "Town of Ashland, Virginia" },
  { source: "va_wythe_county", slug: "wythe-county-va", name: "Wythe County, Virginia" },
  { source: "va_bedford", slug: "town-of-bedford-va", name: "Town of Bedford, Virginia" },
  { source: "va_woodstock", slug: "town-of-woodstock-va", name: "Town of Woodstock, Virginia" },
  { source: "va_vinton", slug: "town-of-vinton-va", name: "Town of Vinton, Virginia" },
  { source: "va_middleburg", slug: "town-of-middleburg-va", name: "Town of Middleburg, Virginia" },
  { source: "va_fauquier_county_bonfire", slug: "fauquier-county-va", name: "Fauquier County, Virginia" },
  { source: "va_fairfax_schools_bonfire", slug: "fairfax-county-public-schools", name: "Fairfax County Public Schools" },
  { source: "va_prince_william_schools_bonfire", slug: "prince-william-county-schools", name: "Prince William County Schools" },
  { source: "va_cnu_bonfire", slug: "christopher-newport-university", name: "Christopher Newport University" },
  { source: "va_chesterfield_county_bonfire", slug: "chesterfield-county-va", name: "Chesterfield County, Virginia" },
  { source: "va_loudoun_water_bonfire", slug: "loudoun-water", name: "Loudoun Water" },
  { source: "va_arlington_schools_bonfire", slug: "arlington-public-schools", name: "Arlington Public Schools" },
  { source: "ca_alhambra", slug: "city-of-alhambra-ca", name: "City of Alhambra, California" },
  { source: "ca_gilroy", slug: "city-of-gilroy-ca", name: "City of Gilroy, California" },
  { source: "ca_inglewood", slug: "city-of-inglewood-ca", name: "City of Inglewood, California" },
  { source: "ca_san_mateo", slug: "city-of-san-mateo-ca", name: "City of San Mateo, California" },
  { source: "ca_moorpark", slug: "city-of-moorpark-ca", name: "City of Moorpark, California" },
  { source: "ca_lawa_bonfire", slug: "los-angeles-world-airports", name: "Los Angeles World Airports (LAWA)" },
  { source: "ca_ac_transit_bonfire", slug: "ac-transit", name: "AC Transit (Alameda-Contra Costa Transit District)" },
  { source: "ca_sutter_county_bonfire", slug: "sutter-county-ca", name: "Sutter County, California" },
  { source: "ca_ventura_county_bonfire", slug: "ventura-county-ca", name: "County of Ventura, California" },
  { source: "ca_elk_grove_schools_bonfire", slug: "elk-grove-unified-school-district", name: "Elk Grove Unified School District" },
  { source: "ca_alameda_county_bonfire", slug: "alameda-county-ca", name: "Alameda County, California" },
  { source: "ca_yolo_county_bonfire", slug: "yolo-county-ca", name: "Yolo County, California" },
  { source: "ca_irvine_bonfire", slug: "city-of-irvine-ca", name: "City of Irvine, California" },
  { source: "ca_oakland_capital_bonfire", slug: "city-of-oakland-capital-contracts", name: "City of Oakland, Capital Contracts Division" },
  { source: "ca_westminster_bonfire", slug: "city-of-westminster-ca", name: "City of Westminster, California" },
  { source: "oh_worthington", slug: "city-of-worthington", name: "City of Worthington" },
  { source: "tx_san_antonio", slug: "city-of-san-antonio-tx", name: "City of San Antonio, Texas" },
  { source: "tx_houston_beacon", slug: "city-of-houston-tx", name: "City of Houston, Texas" },
  { source: "oh_franklin_county", slug: "franklin-county-oh", name: "Franklin County, Ohio" },
  { source: "nj_harrison", slug: "town-of-harrison-nj", name: "Town of Harrison, New Jersey" },
  { source: "oh_dayton", slug: "city-of-dayton", name: "City of Dayton" },
  // Richmond, VA buyers on eVA (va_eva `agencyname`, exact).
  { source: "va_eva", agencyName: "City of Richmond Government", slug: "city-of-richmond", name: "City of Richmond", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Richmond Schools", slug: "richmond-public-schools", name: "Richmond Public Schools", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Greater Richmond Transit Company", slug: "grtc-transit", name: "Greater Richmond Transit Company (GRTC)", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Richmond Redevelopment Housing Authority", slug: "richmond-redevelopment-housing-authority", name: "Richmond Redevelopment and Housing Authority", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  // More Virginia buyers on eVA (owner 2026-10-12), same exact-name match.
  { source: "va_eva", agencyName: "Henrico County Government", slug: "henrico-county", name: "Henrico County", place: "Henrico County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Norfolk", slug: "city-of-norfolk", name: "City of Norfolk", place: "Norfolk", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Norfolk Airport Authority", slug: "norfolk-airport-authority", name: "Norfolk Airport Authority", place: "Norfolk", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Norfolk Redevelopment Housing Authority", slug: "norfolk-redevelopment-housing-authority", name: "Norfolk Redevelopment and Housing Authority", place: "Norfolk", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Hampton", slug: "city-of-hampton", name: "City of Hampton", place: "Hampton", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Hampton City Schools", slug: "hampton-city-schools", name: "Hampton City Schools", place: "Hampton", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Arlington County Government", slug: "arlington-county", name: "Arlington County", place: "Arlington County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Chesapeake", slug: "city-of-chesapeake", name: "City of Chesapeake", place: "Chesapeake", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  // Goochland County and its neighbors around the Lilly site in West Creek (owner 2026-10-24),
  // exact eVA buyer names from the agencyname facets.
  { source: "va_eva", agencyName: "Goochland County Government", slug: "goochland-county", name: "Goochland County", place: "Goochland County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Goochland County Public Schools", slug: "goochland-county-public-schools", name: "Goochland County Public Schools", place: "Goochland County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Hanover County", slug: "hanover-county", name: "Hanover County", place: "Hanover County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Powhatan County", slug: "powhatan-county", name: "Powhatan County", place: "Powhatan County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Louisa County", slug: "louisa-county", name: "Louisa County", place: "Louisa County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  // Northern Neck, around Rappahannock General Hospital (owner 2026-10-24); exact eVA buyer name.
  { source: "va_eva", agencyName: "Westmoreland County Public Schools", slug: "westmoreland-county-public-schools", name: "Westmoreland County Public Schools", place: "Westmoreland County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
];

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface ResolvedAgency extends LocalAgency {
  place: string;
  placeSlug: string;
  stateCode: string;
  stateName: string;
  stateSlug: string;
}

export interface LocalPlace {
  name: string;
  slug: string;
  stateCode: string;
  stateName: string;
  stateSlug: string;
  agencies: ResolvedAgency[];
}

function resolve(a: LocalAgency): ResolvedAgency | null {
  const rec = SOURCE_CLASSES[a.source];
  if (!rec) return null;
  let place: string | undefined;
  let stateCode: string | undefined;
  if (a.agencyName) {
    // A buyer inside a state portal: the portal must be that state's.
    if (rec.scopeState !== a.stateCode) return null;
    place = a.place;
    stateCode = a.stateCode;
  } else if (rec.class === "local") {
    place = rec.city;
    stateCode = rec.scopeState;
  }
  if (!place || !stateCode) return null;
  const stateName = STATE_NAMES[stateCode];
  if (!stateName) return null;
  return {
    ...a,
    place,
    placeSlug: slugify(place),
    stateCode,
    stateName,
    stateSlug: slugify(stateName),
  };
}

/** SQL scope for a set of agencies: whole sources, plus (source, exact agency) pairs. */
export function agencyScope(agencies: readonly LocalAgency[]): {
  sources: string[];
  pairSources: string[];
  pairAgencies: string[];
} {
  const sources = [...new Set(agencies.filter((a) => !a.agencyName).map((a) => a.source))];
  const named = agencies.filter((a) => a.agencyName);
  return {
    sources,
    pairSources: named.map((a) => a.source),
    pairAgencies: named.map((a) => a.agencyName!),
  };
}

/** Which agency a (source, agency) row belongs to, if any. */
export function agencyForRow(
  agencies: readonly LocalAgency[],
  source: string,
  agency: string | null,
): LocalAgency | undefined {
  return (
    agencies.find((a) => a.agencyName && a.source === source && a.agencyName === agency) ??
    agencies.find((a) => !a.agencyName && a.source === source)
  );
}

export const RESOLVED_AGENCIES: ResolvedAgency[] = LOCAL_AGENCIES.map(resolve).filter(
  (a): a is ResolvedAgency => a !== null,
);

export const AGENCY_BY_SLUG: Record<string, ResolvedAgency> = Object.fromEntries(
  RESOLVED_AGENCIES.map((a) => [a.slug, a]),
);

/** Places (cities and counties), each with the agencies we read there. Sorted by state, then name. */
export const LOCAL_PLACES: LocalPlace[] = (() => {
  const byKey = new Map<string, LocalPlace>();
  for (const a of RESOLVED_AGENCIES) {
    const key = `${a.stateSlug}/${a.placeSlug}`;
    let p = byKey.get(key);
    if (!p) {
      p = { name: a.place, slug: a.placeSlug, stateCode: a.stateCode, stateName: a.stateName, stateSlug: a.stateSlug, agencies: [] };
      byKey.set(key, p);
    }
    p.agencies.push(a);
  }
  return [...byKey.values()].sort(
    (x, y) => x.stateName.localeCompare(y.stateName) || x.name.localeCompare(y.name),
  );
})();

export function findPlace(stateSlug: string, placeSlug: string): LocalPlace | null {
  return LOCAL_PLACES.find((p) => p.stateSlug === stateSlug && p.slug === placeSlug) ?? null;
}

export function placesInState(stateCode: string): LocalPlace[] {
  return LOCAL_PLACES.filter((p) => p.stateCode === stateCode);
}

export function placeHref(p: { stateSlug: string; slug: string }): string {
  return `/bids-in/${p.stateSlug}/${p.slug}`;
}

export function agencyHref(a: { slug: string }): string {
  return `/agency/${a.slug}`;
}
