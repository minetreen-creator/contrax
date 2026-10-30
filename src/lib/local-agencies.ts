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
  { source: "oh_worthington", slug: "city-of-worthington", name: "City of Worthington" },
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
