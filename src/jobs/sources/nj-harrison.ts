/**
 * Town of Harrison, New Jersey — its OWN CivicEngage / CivicPlus bid board
 * (`nj_harrison`). Owner 2026-10-12 ("what about harrison, nj?").
 *
 * SOURCE: https://townofharrison.com/bids.aspx — server-rendered ASP.NET, no auth /
 * no CAPTCHA / no JS, robots.txt does not disallow it, read by the SHARED reader
 * (`civicengage-bids.ts`) with the bare URL only. On 2026-10-12 it listed 2 bid
 * postings (bidID 189, 190). Captured as fixtures/nj-harrison/bids-2026-10-12.html.gz.
 * The www. host does not answer, so the bare host is the endpoint.
 *
 * WHAT IS / IS NOT CLAIMED:
 *   - `location` = the literal "Harrison, NJ" and `agency` = "Town of Harrison"
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

export const NJ_HARRISON_SOURCE = "nj_harrison";
export const NJ_HARRISON_ENDPOINT = "https://townofharrison.com/bids.aspx";

export const NJ_HARRISON_CONFIG: CivicEngageBoardConfig = {
  source: NJ_HARRISON_SOURCE,
  endpoint: NJ_HARRISON_ENDPOINT,
  host: "townofharrison.com",
  agency: "Town of Harrison",
  location: "Harrison, NJ",
  idPrefix: "harrisonnj",
};

/** PURE parse of Harrison's board (no network, no DB, injected clock). */
export function parseNjHarrisonBoard(html: string, now: number = Date.now()): CivicEngageParseResult {
  return parseCivicEngageBoard(html, NJ_HARRISON_CONFIG, now);
}

/** Fetch Harrison's board (ONE bare GET; fail-closed on every error mode). */
export function fetchNjHarrisonBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchCivicEngageBoard(NJ_HARRISON_CONFIG, now);
}
