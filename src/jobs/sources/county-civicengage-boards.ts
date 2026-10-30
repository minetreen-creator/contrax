/**
 * County and city CivicEngage bid boards (owner 2026-10-27: more counties in the
 * outreach states). Each is the jurisdiction's own public `bids.aspx` board, read
 * with the shared reader (bare URL only, open-status and deadline guards). Group
 * headers that are not open competitions (emergency, sole source, results,
 * plan holders, awards) are skipped via CIVICENGAGE_NOT_A_BID_GROUP. Captured
 * 2026-10-27 (fixtures/county-civicengage); no logins, detail pages or documents.
 */
import type { FetchResult } from "../runner";
import {
  CIVICENGAGE_NOT_A_BID_GROUP,
  fetchCivicEngageBoard,
  parseCivicEngageBoard,
  type CivicEngageBoardConfig,
} from "./civicengage-bids";

const board = (source: string, host: string, agency: string, location: string, idPrefix: string): CivicEngageBoardConfig => ({
  source,
  endpoint: `https://${host}/bids.aspx`,
  host,
  agency,
  location,
  idPrefix,
  excludeGroup: CIVICENGAGE_NOT_A_BID_GROUP,
});

export const COUNTY_CIVICENGAGE_CONFIGS: readonly CivicEngageBoardConfig[] = [
  board("va_hopewell", "www.hopewellva.gov", "City of Hopewell", "Hopewell, VA", "hopewellcivic"),
  board("va_danville", "www.danville-va.gov", "City of Danville", "Danville, VA", "danvillecivic"),
  board("va_salem", "www.salemva.gov", "City of Salem", "Salem, VA", "salemcivic"),
  board("va_pittsylvania", "www.pittsylvaniacountyva.gov", "Pittsylvania County", "Pittsylvania County, VA", "pittsylvaniacivic"),
  board("va_williamsburg", "www.williamsburgva.gov", "City of Williamsburg", "Williamsburg, VA", "williamsburgcivic"),
  board("md_hagerstown", "www.hagerstownmd.org", "City of Hagerstown", "Hagerstown, MD", "hagerstowncivic"),
  board("md_queen_annes", "www.qac.org", "Queen Anne's County", "Queen Anne's County, MD", "queenannescivic"),
  board("md_college_park", "www.collegeparkmd.gov", "City of College Park", "College Park, MD", "collegeparkcivic"),
  board("nc_high_point", "www.highpointnc.gov", "City of High Point", "High Point, NC", "highpointcivic"),
  board("nc_pitt_county", "www.pittcountync.gov", "Pitt County", "Pitt County, NC", "pittcountycivic"),
  board("fl_bay_county", "www.baycountyfl.gov", "Bay County", "Bay County, FL", "baycountycivic"),
  board("fl_titusville", "www.titusville.com", "City of Titusville", "Titusville, FL", "titusvillecivic"),
  board("ga_hall_county", "www.hallcounty.org", "Hall County", "Hall County, GA", "hallcountycivic"),
  board("ga_barrow_county", "www.barrowga.org", "Barrow County", "Barrow County, GA", "barrowcountycivic"),
  board("tx_league_city", "www.leaguecitytx.gov", "City of League City", "League City, TX", "leaguecitycivic"),
  board("tx_longview", "www.longviewtexas.gov", "City of Longview", "Longview, TX", "longviewcivic"),
  board("tx_midland", "www.midlandtexas.gov", "City of Midland", "Midland, TX", "midlandcivic"),
  board("tx_odessa", "www.odessa-tx.gov", "City of Odessa", "Odessa, TX", "odessacivic"),
  // Arizona (owner 2026-10-27).
  board("az_lake_havasu", "www.lhcaz.gov", "City of Lake Havasu City", "Lake Havasu City, AZ", "lakehavasucivic"),
  board("az_casa_grande", "www.casagrandeaz.gov", "City of Casa Grande", "Casa Grande, AZ", "casagrandecivic"),
  board("az_douglas", "www.douglasaz.gov", "City of Douglas", "Douglas, AZ", "douglascivic"),
  // Missouri (owner 2026-10-27).
  board("mo_springfield", "www.springfieldmo.gov", "City of Springfield", "Springfield, MO", "springfieldcivic"),
  board("mo_st_charles_county", "www.sccmo.org", "St. Charles County", "St. Charles County, MO", "stcharlescountycivic"),
  board("mo_st_charles", "www.stcharlescitymo.gov", "City of St. Charles", "St. Charles, MO", "stcharlescivic"),
  board("mo_liberty", "www.libertymissouri.gov", "City of Liberty", "Liberty, MO", "libertycivic"),
  board("mo_ozark", "www.ozarkmissouri.com", "City of Ozark", "Ozark, MO", "ozarkcivic"),
  board("mo_ballwin", "www.ballwin.mo.us", "City of Ballwin", "Ballwin, MO", "ballwincivic"),
  // Indiana (owner 2026-10-27).
  board("in_lafayette", "www.lafayette.in.gov", "City of Lafayette", "Lafayette, IN", "lafayettecivic"),
  board("in_zionsville", "www.zionsville-in.gov", "Town of Zionsville", "Zionsville, IN", "zionsvillecivic"),
  board("in_carmel", "www.carmel.in.gov", "City of Carmel", "Carmel, IN", "carmelcivic"),
  board("in_hamilton_county", "www.hamiltoncounty.in.gov", "Hamilton County", "Hamilton County, IN", "hamiltoncountycivic"),
  board("in_tippecanoe_county", "www.tippecanoe.in.gov", "Tippecanoe County", "Tippecanoe County, IN", "tippecanoecountycivic"),
  board("in_anderson", "www.cityofanderson.com", "City of Anderson", "Anderson, IN", "andersoncivic"),
  board("in_avon", "www.avonindiana.gov", "Town of Avon", "Avon, IN", "avoncivic"),
  board("in_brownsburg", "www.brownsburg.org", "Town of Brownsburg", "Brownsburg, IN", "brownsburgcivic"),
  // New Jersey (owner 2026-10-28: NJ had almost no local bids).
  board("nj_cherry_hill", "www.chnj.gov", "Cherry Hill Township", "Cherry Hill, NJ", "cherryhillcivic"),
  board("nj_trenton", "www.trentonnj.org", "City of Trenton", "Trenton, NJ", "trentoncivic"),
  board("nj_cranford", "www.cranfordnj.org", "Township of Cranford", "Cranford, NJ", "cranfordcivic"),
  board("nj_fort_lee", "www.fortleenj.org", "Borough of Fort Lee", "Fort Lee, NJ", "fortleecivic"),
  board("nj_west_orange", "www.westorange.org", "Township of West Orange", "West Orange, NJ", "westorangecivic"),
  board("nj_princeton", "www.princetonnj.gov", "Municipality of Princeton", "Princeton, NJ", "princetoncivic"),
  board("nj_millville", "www.millvillenj.gov", "City of Millville", "Millville, NJ", "millvillecivic"),
  board("nj_livingston", "www.livingstonnj.org", "Township of Livingston", "Livingston, NJ", "livingstoncivic"),
  board("nj_mahwah", "www.mahwahtwp.org", "Township of Mahwah", "Mahwah, NJ", "mahwahcivic"),
  board("nj_wall", "www.wallnj.gov", "Wall Township", "Wall Township, NJ", "wallcivic"),
  board("nj_ridgewood", "www.ridgewoodnj.net", "Village of Ridgewood", "Ridgewood, NJ", "ridgewoodcivic"),
  board("nj_westfield", "www.westfieldnj.gov", "Town of Westfield", "Westfield, NJ", "westfieldcivic"),
  board("nj_montgomery", "www.montgomerynj.gov", "Montgomery Township", "Montgomery Township, NJ", "montgomerycivic"),
  board("nj_east_brunswick", "www.eastbrunswick.org", "Township of East Brunswick", "East Brunswick, NJ", "eastbrunswickcivic"),
  // Montana (owner 2026-10-30: "find more Montana boards too").
  board("mt_billings", "www.billingsmt.gov", "City of Billings", "Billings, MT", "billingscivic"),
  board("mt_missoula", "www.ci.missoula.mt.us", "City of Missoula", "Missoula, MT", "missoulacivic"),
  board("mt_butte_silver_bow", "www.bsbmt.gov", "Butte-Silver Bow", "Butte, MT", "buttesilverbowcivic"),
  board("mt_kalispell", "www.kalispell.com", "City of Kalispell", "Kalispell, MT", "kalispellcivic"),
  board("mt_cascade_county", "www.cascadecountymt.gov", "Cascade County", "Cascade County, MT", "cascadecountycivic"),
  board("mt_gallatin_county", "www.gallatinmt.gov", "Gallatin County", "Gallatin County, MT", "gallatincountycivic"),
  // South Carolina (owner 2026-10-30: "what about SC").
  board("sc_charleston", "www.charleston-sc.gov", "City of Charleston", "Charleston, SC", "charlestoncivic"),
  board("sc_spartanburg", "www.cityofspartanburg.org", "City of Spartanburg", "Spartanburg, SC", "spartanburgcivic"),
  board("sc_mount_pleasant", "www.tompsc.com", "Town of Mount Pleasant", "Mount Pleasant, SC", "mountpleasantcivic"),
  board("sc_summerville", "www.summervillesc.gov", "Town of Summerville", "Summerville, SC", "summervillecivic"),
  board("sc_fort_mill", "www.fortmillsc.gov", "Town of Fort Mill", "Fort Mill, SC", "fortmillcivic"),
  // North Carolina, Georgia and West Virginia (owner 2026-10-30: "and NC", "and GA", "then WVA").
  board("nc_apex", "www.apexnc.org", "Town of Apex", "Apex, NC", "apexcivic"),
  board("nc_winston_salem", "www.cityofws.org", "City of Winston-Salem", "Winston-Salem, NC", "winstonsalemcivic"),
  board("nc_brunswick_county", "www.brunswickcountync.gov", "Brunswick County", "Brunswick County, NC", "brunswickcountycivic"),
  board("nc_new_hanover_county", "www.nhcgov.com", "New Hanover County", "New Hanover County, NC", "newhanovercivic"),
  board("nc_burlington", "www.burlingtonnc.gov", "City of Burlington", "Burlington, NC", "burlingtoncivic"),
  board("nc_iredell_county", "www.iredellcountync.gov", "Iredell County", "Iredell County, NC", "iredellcountycivic"),
  board("nc_jacksonville", "www.jacksonvillenc.gov", "City of Jacksonville", "Jacksonville, NC", "jacksonvillenccivic"),
  board("nc_rowan_county", "www.rowancountync.gov", "Rowan County", "Rowan County, NC", "rowancountycivic"),
  board("ga_peachtree_city", "www.peachtree-city.org", "City of Peachtree City", "Peachtree City, GA", "peachtreecitycivic"),
  board("ga_lowndes_county", "www.lowndescounty.com", "Lowndes County", "Lowndes County, GA", "lowndescountycivic"),
  board("ga_lawrenceville", "www.lawrencevillega.org", "City of Lawrenceville", "Lawrenceville, GA", "lawrencevillecivic"),
  board("ga_newnan", "www.newnanga.gov", "City of Newnan", "Newnan, GA", "newnancivic"),
  board("ga_liberty_county", "www.libertycountyga.gov", "Liberty County", "Liberty County, GA", "libertycountygacivic"),
  board("ga_savannah", "www.savannahga.gov", "City of Savannah", "Savannah, GA", "savannahcivic"),
  board("ga_athens_clarke", "www.accgov.com", "Athens-Clarke County", "Athens, GA", "athensclarkecivic"),
  board("ga_douglas_county", "www.douglascountyga.gov", "Douglas County", "Douglas County, GA", "douglascountygacivic"),
  board("ga_coweta_county", "www.coweta.ga.us", "Coweta County", "Coweta County, GA", "cowetacountycivic"),
  board("ga_carroll_county", "www.carrollcountyga.gov", "Carroll County", "Carroll County, GA", "carrollcountygacivic"),
  board("ga_effingham_county", "www.effinghamcounty.org", "Effingham County", "Effingham County, GA", "effinghamcountycivic"),
  board("ga_dawson_county", "www.dawsoncountyga.gov", "Dawson County", "Dawson County, GA", "dawsoncountycivic"),
  board("ga_jackson_county", "www.jacksoncountygov.com", "Jackson County", "Jackson County, GA", "jacksoncountygacivic"),
  board("ga_rome", "www.romega.us", "City of Rome", "Rome, GA", "romecivic"),
  board("wv_fairmont", "www.fairmontwv.gov", "City of Fairmont", "Fairmont, WV", "fairmontcivic"),
  board("wv_berkeley_county", "www.berkeleywv.org", "Berkeley County", "Berkeley County, WV", "berkeleycountywvcivic"),
  board("wv_vienna", "www.vienna-wv.com", "City of Vienna", "Vienna, WV", "viennacivic"),
  board("wv_weirton", "www.cityofweirton.com", "City of Weirton", "Weirton, WV", "weirtoncivic"),
  board("wv_morgantown", "www.morgantownwv.gov", "City of Morgantown", "Morgantown, WV", "morgantowncivic"),
  // Tennessee (owner 2026-10-30: "and Tennessee").
  board("tn_pigeon_forge", "www.cityofpigeonforgetn.gov", "City of Pigeon Forge", "Pigeon Forge, TN", "pigeonforgecivic"),
  board("tn_la_vergne", "www.lavergnetn.gov", "City of La Vergne", "La Vergne, TN", "lavergnecivic"),
  board("tn_mt_juliet", "www.mtjuliet-tn.gov", "City of Mt. Juliet", "Mt. Juliet, TN", "mtjulietcivic"),
  board("tn_spring_hill", "www.springhilltn.org", "City of Spring Hill", "Spring Hill, TN", "springhillcivic"),
  board("tn_cookeville", "www.cookeville-tn.gov", "City of Cookeville", "Cookeville, TN", "cookevillecivic"),
  board("tn_oak_ridge", "www.oakridgetn.gov", "City of Oak Ridge", "Oak Ridge, TN", "oakridgecivic"),
  board("tn_lebanon", "www.lebanontn.org", "City of Lebanon", "Lebanon, TN", "lebanoncivic"),
  board("tn_gallatin", "www.gallatintn.gov", "City of Gallatin", "Gallatin, TN", "gallatintncivic"),
  board("tn_cleveland", "www.clevelandtn.gov", "City of Cleveland", "Cleveland, TN", "clevelandtncivic"),
  board("tn_goodlettsville", "www.goodlettsville.gov", "City of Goodlettsville", "Goodlettsville, TN", "goodlettsvillecivic"),
  board("tn_white_house", "www.whitehousetn.gov", "City of White House", "White House, TN", "whitehousecivic"),
  board("tn_springfield", "www.springfield-tn.org", "City of Springfield", "Springfield, TN", "springfieldtncivic"),
  board("tn_wilson_county", "www.wilsoncountytn.gov", "Wilson County", "Wilson County, TN", "wilsoncountytncivic"),
  board("tn_maury_county", "www.maurycounty-tn.gov", "Maury County", "Maury County, TN", "maurycountycivic"),
  board("tn_washington_county", "www.washingtoncountytn.org", "Washington County", "Washington County, TN", "washingtoncountytncivic"),
  board("tn_coffee_county", "www.coffeecountytn.gov", "Coffee County", "Coffee County, TN", "coffeecountycivic"),
];

export function countyCivicEngageConfig(source: string): CivicEngageBoardConfig {
  const cfg = COUNTY_CIVICENGAGE_CONFIGS.find((c) => c.source === source);
  if (!cfg) throw new Error(`unknown county CivicEngage source ${source}`);
  return cfg;
}

export function parseCountyCivicEngage(source: string, html: string, now = Date.now()) {
  return parseCivicEngageBoard(html, countyCivicEngageConfig(source), now);
}

/** One scheduled entry per board, so each source fails and reports on its own. */
export const COUNTY_CIVICENGAGE_SOURCES: readonly { name: string; fetchFn: (now?: number) => Promise<FetchResult> }[] =
  COUNTY_CIVICENGAGE_CONFIGS.map((cfg) => ({
    name: cfg.source,
    fetchFn: (now: number = Date.now()) => fetchCivicEngageBoard(cfg, now),
  }));
