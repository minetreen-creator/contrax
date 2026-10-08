/**
 * City of Suffolk, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_suffolk`). Owner green-light 2026-10-08 (Virginia locality boards,
 * dispatch A; evidence: shared/virginia-delivery-courier-probe-2026-10-08/ and
 * shared/va-locality-civicengage-2026-10-08/).
 *
 * SOURCE: https://www.suffolkva.us/bids.aspx — the City's own board,
 * server-rendered ASP.NET, no auth / no CAPTCHA / no JS, parsed with string
 * anchors + regex by the SHARED reader (`civicengage-bids.ts`). The bare URL is
 * the only request: `?showAllBids=true&Status=all` answers HTTP 404 with no item
 * container (measured 2026-10-08; the trap response is committed under
 * fixtures/suffolk/). NO pagination: the whole open list renders on one page.
 *
 * WHAT IS / IS NOT CLAIMED:
 *   - `location` = the literal "Suffolk, VA" and `agency` = "City of Suffolk" (the
 *     board's own publisher). Neither is inferred per row.
 *   - the four fetches of 2026-10-08 each listed **8** open solicitations — quoted
 *     from the board (see VA_SUFFOLK_CAPTURED_OPEN_ROWS_...), not a coverage claim.
 *     The copy claims nothing about which trades appear: the probe's single
 *     keyword hit on this board ("Pavement Asset Inventory and Pavement Management
 *     Solutions") is a roadway-asset RFP, NOT delivery/courier/freight work.
 *   - `set_aside` is NULL unless a row's own text states a program;
 *     `naics_code` / `psc` / `notice_type` / `solicitation_number` are NULL (the
 *     board exposes none).
 *   - the close time carries no zone and the board states none, so the due-date
 *     zone is UNVERIFIED (see CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED).
 */
import type { FetchResult } from "../runner";
import {
  CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED,
  civicEngageCopy,
  civicEngageCountLine,
  fetchCivicEngageBoard,
  parseCivicEngageBoard,
  type CivicEngageBoardConfig,
  type CivicEngageParseResult,
} from "./civicengage-bids";

/** Registered source label (runner TAIL_SOURCES / source-class / location-state). */
export const VA_SUFFOLK_SOURCE = "va_suffolk";
/** The City of Suffolk's own board — the only URL this source reads or cites. */
export const VA_SUFFOLK_ENDPOINT = "https://www.suffolkva.us/bids.aspx";
/** The board's own publisher identity. */
export const VA_SUFFOLK_AGENCY = "City of Suffolk";
/** City-level place, provable by construction (the City publishes this board). */
export const VA_SUFFOLK_LOCATION = "Suffolk, VA";
/** `external_id` prefix → `suffolk-1657` (stable: upsert refreshes, never dupes). */
export const VA_SUFFOLK_ID_PREFIX = "suffolk";
/**
 * Open rows the board itself listed at capture time (4 fetches, 2026-10-08 — all
 * four fingerprints identical). Quoted, never arithmetic.
 */
export const VA_SUFFOLK_CAPTURED_OPEN_ROWS_2026_10_08 = 8;

export const VA_SUFFOLK_CONFIG: CivicEngageBoardConfig = {
  source: VA_SUFFOLK_SOURCE,
  endpoint: VA_SUFFOLK_ENDPOINT,
  host: "www.suffolkva.us",
  agency: VA_SUFFOLK_AGENCY,
  location: VA_SUFFOLK_LOCATION,
  idPrefix: VA_SUFFOLK_ID_PREFIX,
};

/** A countdown surface MUST read this before rendering a deadline count. */
export const VA_SUFFOLK_DUE_DATE_ZONE_UNVERIFIED = CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED;

/** The board's copy (honesty wording; no trade/coverage claim). */
export const VA_SUFFOLK_COPY = civicEngageCopy(VA_SUFFOLK_CONFIG);

/** Live-count honesty line — `count` must come from a REAL run. */
export function vaSuffolkCountLine(count: number, asOf: Date | string): string {
  return civicEngageCountLine(VA_SUFFOLK_CONFIG, count, asOf);
}

/** PURE parse of the City of Suffolk's board (no network, no DB, injected clock). */
export function parseVaSuffolkBoard(html: string, now: number = Date.now()): CivicEngageParseResult {
  return parseCivicEngageBoard(html, VA_SUFFOLK_CONFIG, now);
}

/** Fetch the City of Suffolk's board (ONE bare GET; fail-closed on every error mode). */
export function fetchVaSuffolkBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchCivicEngageBoard(VA_SUFFOLK_CONFIG, now);
}
