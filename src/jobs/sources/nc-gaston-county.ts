/**
 * Gaston County, North Carolina — its OWN CivicEngage / CivicPlus bid board
 * (`nc_gaston_county`). Owner 2026-10-12 ("lets do gastonia, nc"): the county
 * around Gastonia; the City's own page is `nc_gastonia`.
 *
 * SOURCE: https://www.gastongov.com/Bids.aspx — server-rendered ASP.NET, no auth /
 * no CAPTCHA / no JS, read by the SHARED reader (`civicengage-bids.ts`) with the
 * bare URL only. On 2026-10-12 the board said "There are no open bid postings at
 * this time." with its item region present, which the shared reader reads as an
 * honest empty board (0 rows, no error); a page without that region still fails
 * closed. Captured as fixtures/nc-gaston-county/bids-2026-10-12.html.gz.
 *
 * WHAT IS / IS NOT CLAIMED:
 *   - `location` = the literal "Gaston County, NC" and `agency` = "Gaston County"
 *     (the board's own publisher). Neither is inferred per row.
 *   - `set_aside` is NULL unless a row's own text states a program;
 *     `naics_code` / `psc` / `notice_type` / `solicitation_number` are NULL.
 *   - the close time carries no zone and the board states none, so the due-date
 *     zone is UNVERIFIED (see CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED).
 */
import type { FetchResult } from "../runner";
import {
  fetchCivicEngageBoard,
  parseCivicEngageBoard,
  type CivicEngageBoardConfig,
  type CivicEngageParseResult,
} from "./civicengage-bids";

export const NC_GASTON_COUNTY_SOURCE = "nc_gaston_county";
export const NC_GASTON_COUNTY_ENDPOINT = "https://www.gastongov.com/Bids.aspx";

export const NC_GASTON_COUNTY_CONFIG: CivicEngageBoardConfig = {
  source: NC_GASTON_COUNTY_SOURCE,
  endpoint: NC_GASTON_COUNTY_ENDPOINT,
  host: "www.gastongov.com",
  agency: "Gaston County",
  location: "Gaston County, NC",
  idPrefix: "gastoncounty",
};

/** PURE parse of Gaston County's board (no network, no DB, injected clock). */
export function parseNcGastonCountyBoard(html: string, now: number = Date.now()): CivicEngageParseResult {
  return parseCivicEngageBoard(html, NC_GASTON_COUNTY_CONFIG, now);
}

/** Fetch Gaston County's board (ONE bare GET; fail-closed on every error mode). */
export function fetchNcGastonCountyBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchCivicEngageBoard(NC_GASTON_COUNTY_CONFIG, now);
}
