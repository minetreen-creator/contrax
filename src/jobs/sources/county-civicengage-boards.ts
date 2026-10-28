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
