/**
 * Loudoun County, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_loudoun`). Owner green-light 2026-10-08 (Virginia locality boards,
 * dispatch A; evidence: shared/virginia-delivery-courier-probe-2026-10-08/ and
 * shared/va-locality-civicengage-2026-10-08/).
 *
 * SOURCE: https://www.loudoun.gov/bids.aspx — Loudoun County's own board,
 * server-rendered ASP.NET, no auth / no CAPTCHA / no JS, parsed with string
 * anchors + regex by the SHARED reader (`civicengage-bids.ts`). The bare URL is
 * the only request: `?showAllBids=true&Status=all` answers HTTP 404 with no item
 * container (measured 2026-10-08; the trap response is committed under
 * fixtures/loudoun/). NO pagination: the whole open list renders on one page.
 *
 * WHAT IS / IS NOT CLAIMED:
 *   - `location` = the literal "Loudoun County, VA" and `agency` = "County of
 *     Loudoun" (the board's own publisher, as the board itself writes it: "the
 *     County of Loudoun, Virginia"). Neither is inferred per row.
 *   - the four fetches of 2026-10-08 each listed **10** open solicitations — that
 *     number is QUOTED from the board (see VA_LOUDOUN_CAPTURED_OPEN_ROWS_...), not
 *     a coverage claim, and the copy claims nothing about which trades appear.
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
export const VA_LOUDOUN_SOURCE = "va_loudoun";
/** Loudoun County's own board — the only URL this source reads or cites. */
export const VA_LOUDOUN_ENDPOINT = "https://www.loudoun.gov/bids.aspx";
/** The board's own publisher identity. */
export const VA_LOUDOUN_AGENCY = "County of Loudoun";
/** County-level place, provable by construction (the County publishes this board). */
export const VA_LOUDOUN_LOCATION = "Loudoun County, VA";
/** `external_id` prefix → `loudoun-1107` (stable: upsert refreshes, never dupes). */
export const VA_LOUDOUN_ID_PREFIX = "loudoun";
/**
 * Open rows the board itself listed at capture time (4 fetches, 2026-10-08 — all
 * four fingerprints identical). Quoted, never arithmetic: a board churns, so this
 * is evidence of the capture, NOT a standing count.
 */
export const VA_LOUDOUN_CAPTURED_OPEN_ROWS_2026_10_08 = 10;

export const VA_LOUDOUN_CONFIG: CivicEngageBoardConfig = {
  source: VA_LOUDOUN_SOURCE,
  endpoint: VA_LOUDOUN_ENDPOINT,
  host: "www.loudoun.gov",
  agency: VA_LOUDOUN_AGENCY,
  location: VA_LOUDOUN_LOCATION,
  idPrefix: VA_LOUDOUN_ID_PREFIX,
};

/** A countdown surface MUST read this before rendering a deadline count. */
export const VA_LOUDOUN_DUE_DATE_ZONE_UNVERIFIED = CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED;

/** The board's copy (honesty wording; no trade/coverage claim). */
export const VA_LOUDOUN_COPY = civicEngageCopy(VA_LOUDOUN_CONFIG);

/** Live-count honesty line — `count` must come from a REAL run. */
export function vaLoudounCountLine(count: number, asOf: Date | string): string {
  return civicEngageCountLine(VA_LOUDOUN_CONFIG, count, asOf);
}

/** PURE parse of Loudoun County's board (no network, no DB, injected clock). */
export function parseVaLoudounBoard(html: string, now: number = Date.now()): CivicEngageParseResult {
  return parseCivicEngageBoard(html, VA_LOUDOUN_CONFIG, now);
}

/** Fetch Loudoun County's board (ONE bare GET; fail-closed on every error mode). */
export function fetchVaLoudounBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchCivicEngageBoard(VA_LOUDOUN_CONFIG, now);
}
