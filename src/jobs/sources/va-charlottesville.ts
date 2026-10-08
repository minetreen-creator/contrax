/**
 * City of Charlottesville, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_charlottesville`). Owner green-light 2026-10-08 (Virginia locality boards,
 * dispatch A; evidence: shared/virginia-delivery-courier-probe-2026-10-08/ and
 * shared/va-locality-civicengage-2026-10-08/).
 *
 * SOURCE: https://www.charlottesville.gov/bids.aspx — the City's own board,
 * server-rendered ASP.NET, no auth / no CAPTCHA / no JS, parsed with string
 * anchors + regex by the SHARED reader (`civicengage-bids.ts`). The bare URL is
 * the only request: `?showAllBids=true&Status=all` answers HTTP 404 with no item
 * container (measured 2026-10-08; the trap response is committed under
 * fixtures/charlottesville/). NO pagination: the whole open list renders on one
 * page.
 *
 * NOTE ON A SEPARATE TENANT: `charlottesville.bonfirehub.com` also exists and is
 * EMPTY (0 open projects, measured 2026-10-08). That Bonfire tenant is NOT this
 * source and is not read here — Bonfire work is a separate dispatch. This source
 * reads only the City's own CivicEngage board.
 *
 * WHAT IS / IS NOT CLAIMED:
 *   - `location` = the literal "Charlottesville, VA" and `agency` = "City of
 *     Charlottesville" (the board's own publisher). Neither is inferred per row.
 *   - the four fetches of 2026-10-08 each listed **1** open solicitation — quoted
 *     from the board (see VA_CHARLOTTESVILLE_CAPTURED_OPEN_ROWS_...), not a
 *     coverage claim. One row is emphatically not coverage, and the copy claims
 *     nothing about which trades appear.
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
export const VA_CHARLOTTESVILLE_SOURCE = "va_charlottesville";
/** The City of Charlottesville's own board — the only URL this source reads or cites. */
export const VA_CHARLOTTESVILLE_ENDPOINT = "https://www.charlottesville.gov/bids.aspx";
/** The board's own publisher identity. */
export const VA_CHARLOTTESVILLE_AGENCY = "City of Charlottesville";
/** City-level place, provable by construction (the City publishes this board). */
export const VA_CHARLOTTESVILLE_LOCATION = "Charlottesville, VA";
/** `external_id` prefix → `charlottesville-504` (stable: upsert refreshes, never dupes). */
export const VA_CHARLOTTESVILLE_ID_PREFIX = "charlottesville";
/**
 * Open rows the board itself listed at capture time (4 fetches, 2026-10-08 — all
 * four fingerprints identical). Quoted, never arithmetic.
 */
export const VA_CHARLOTTESVILLE_CAPTURED_OPEN_ROWS_2026_10_08 = 1;

export const VA_CHARLOTTESVILLE_CONFIG: CivicEngageBoardConfig = {
  source: VA_CHARLOTTESVILLE_SOURCE,
  endpoint: VA_CHARLOTTESVILLE_ENDPOINT,
  host: "www.charlottesville.gov",
  agency: VA_CHARLOTTESVILLE_AGENCY,
  location: VA_CHARLOTTESVILLE_LOCATION,
  idPrefix: VA_CHARLOTTESVILLE_ID_PREFIX,
};

/** A countdown surface MUST read this before rendering a deadline count. */
export const VA_CHARLOTTESVILLE_DUE_DATE_ZONE_UNVERIFIED = CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED;

/** The board's copy (honesty wording; no trade/coverage claim). */
export const VA_CHARLOTTESVILLE_COPY = civicEngageCopy(VA_CHARLOTTESVILLE_CONFIG);

/** Live-count honesty line — `count` must come from a REAL run. */
export function vaCharlottesvilleCountLine(count: number, asOf: Date | string): string {
  return civicEngageCountLine(VA_CHARLOTTESVILLE_CONFIG, count, asOf);
}

/** PURE parse of the City of Charlottesville's board (no network, no DB, injected clock). */
export function parseVaCharlottesvilleBoard(
  html: string,
  now: number = Date.now(),
): CivicEngageParseResult {
  return parseCivicEngageBoard(html, VA_CHARLOTTESVILLE_CONFIG, now);
}

/** Fetch the City of Charlottesville's board (ONE bare GET; fail-closed on every error mode). */
export function fetchVaCharlottesvilleBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchCivicEngageBoard(VA_CHARLOTTESVILLE_CONFIG, now);
}
