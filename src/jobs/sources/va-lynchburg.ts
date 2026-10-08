/**
 * City of Lynchburg, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_lynchburg`). Owner green-light 2026-10-08 (Virginia locality boards,
 * dispatch A; evidence: shared/virginia-delivery-courier-probe-2026-10-08/ and
 * shared/va-locality-civicengage-2026-10-08/).
 *
 * SOURCE: https://www.lynchburgva.gov/bids.aspx — the City's own board,
 * server-rendered ASP.NET, no auth / no CAPTCHA / no JS, parsed with string
 * anchors + regex by the SHARED reader (`civicengage-bids.ts`). The bare URL is
 * the only request: `?showAllBids=true&Status=all` answers HTTP 404 with no item
 * container (measured 2026-10-08; the trap response is committed under
 * fixtures/lynchburg/). NO pagination: the whole open list renders on one page.
 *
 * This board is the ONLY one of the four that renders MORE THAN ONE group header
 * today ("Invitation for Bids" ×2, "Request for Proposals" ×1), which is why the
 * shared reader never assumes a group set or order.
 *
 * WHAT IS / IS NOT CLAIMED:
 *   - `location` = the literal "Lynchburg, VA" and `agency` = "City of Lynchburg"
 *     (the board's own publisher). Neither is inferred per row.
 *   - the four fetches of 2026-10-08 each listed **3** open solicitations — quoted
 *     from the board (see VA_LYNCHBURG_CAPTURED_OPEN_ROWS_...), not a coverage
 *     claim, and three rows is not a coverage claim either.
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
export const VA_LYNCHBURG_SOURCE = "va_lynchburg";
/** The City of Lynchburg's own board — the only URL this source reads or cites. */
export const VA_LYNCHBURG_ENDPOINT = "https://www.lynchburgva.gov/bids.aspx";
/** The board's own publisher identity. */
export const VA_LYNCHBURG_AGENCY = "City of Lynchburg";
/** City-level place, provable by construction (the City publishes this board). */
export const VA_LYNCHBURG_LOCATION = "Lynchburg, VA";
/** `external_id` prefix → `lynchburg-245` (stable: upsert refreshes, never dupes). */
export const VA_LYNCHBURG_ID_PREFIX = "lynchburg";
/**
 * Open rows the board itself listed at capture time (4 fetches, 2026-10-08 — all
 * four fingerprints identical). Quoted, never arithmetic.
 */
export const VA_LYNCHBURG_CAPTURED_OPEN_ROWS_2026_10_08 = 3;

export const VA_LYNCHBURG_CONFIG: CivicEngageBoardConfig = {
  source: VA_LYNCHBURG_SOURCE,
  endpoint: VA_LYNCHBURG_ENDPOINT,
  host: "www.lynchburgva.gov",
  agency: VA_LYNCHBURG_AGENCY,
  location: VA_LYNCHBURG_LOCATION,
  idPrefix: VA_LYNCHBURG_ID_PREFIX,
};

/** A countdown surface MUST read this before rendering a deadline count. */
export const VA_LYNCHBURG_DUE_DATE_ZONE_UNVERIFIED = CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED;

/** The board's copy (honesty wording; no trade/coverage claim). */
export const VA_LYNCHBURG_COPY = civicEngageCopy(VA_LYNCHBURG_CONFIG);

/** Live-count honesty line — `count` must come from a REAL run. */
export function vaLynchburgCountLine(count: number, asOf: Date | string): string {
  return civicEngageCountLine(VA_LYNCHBURG_CONFIG, count, asOf);
}

/** PURE parse of the City of Lynchburg's board (no network, no DB, injected clock). */
export function parseVaLynchburgBoard(
  html: string,
  now: number = Date.now(),
): CivicEngageParseResult {
  return parseCivicEngageBoard(html, VA_LYNCHBURG_CONFIG, now);
}

/** Fetch the City of Lynchburg's board (ONE bare GET; fail-closed on every error mode). */
export function fetchVaLynchburgBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchCivicEngageBoard(VA_LYNCHBURG_CONFIG, now);
}
