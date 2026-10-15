/** Wayne County's official public CivicEngage board, checked 2026-10-15.
 * County solicitations only; does not claim City of Goldsboro coverage.
 * Published closing times have no stated zone; countdowns are suppressed.
 */
import type { FetchResult } from "../runner";
import { ncEvpWallTimeToIso } from "./nc-evp";
import { fetchCivicEngageBoard, parseCivicEngageBoard, CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED, type CivicEngageBoardConfig } from "./civicengage-bids";
export const NC_WAYNE_COUNTY_SOURCE = "nc_wayne_county";
export const NC_WAYNE_COUNTY_ENDPOINT = "https://www.waynegov.com/Bids.aspx";
export const NC_WAYNE_COUNTY_DUE_DATE_ZONE_UNVERIFIED = CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED;
/** Interpret the county wall clock in its North Carolina jurisdiction (Eastern).
 * The board does not explicitly print a zone, so countdowns remain suppressed.
 * Avoid the generic date-only decoder dropping the board's 2 PM close time.
 */
export function waynePublishedDeadline(value: string): string | null {
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!m) return null;
  const [, month, day, year, hour, minute, period] = m;
  if (+hour < 1 || +hour > 12 || +minute > 59 || +month < 1 || +month > 12 || +day < 1 || +day > 31) return null;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour % 12 + (period.toUpperCase() === "PM" ? 12 : 0), +minute));
  if (date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day) return null;
  return ncEvpWallTimeToIso(`/Date(${date.getTime()})/`);
}
export const NC_WAYNE_COUNTY_CONFIG: CivicEngageBoardConfig = {
  parseDueDate: waynePublishedDeadline,
  source: NC_WAYNE_COUNTY_SOURCE, endpoint: NC_WAYNE_COUNTY_ENDPOINT,
  host: "www.waynegov.com", agency: "Wayne County", location: "Wayne County, NC", idPrefix: "nc-waynecounty",
};
export function parseNcWayneCountyBoard(html: string, now: number = Date.now()) {
  return parseCivicEngageBoard(html, NC_WAYNE_COUNTY_CONFIG, now);
}
export function fetchNcWayneCountyBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchCivicEngageBoard(NC_WAYNE_COUNTY_CONFIG, now);
}
