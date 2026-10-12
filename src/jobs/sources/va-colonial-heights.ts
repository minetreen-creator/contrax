/** Colonial Heights' own public CivicEngage board, including honest empty runs. */
import { CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED, fetchCivicEngageBoard, type CivicEngageBoardConfig } from "./civicengage-bids";

export const VA_COLONIAL_HEIGHTS_DUE_DATE_ZONE_UNVERIFIED = CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED;

export const COLONIAL_HEIGHTS_CONFIG: CivicEngageBoardConfig = {
  source: "va_colonial_heights",
  endpoint: "https://www.colonialheightsva.gov/bids.aspx",
  host: "www.colonialheightsva.gov",
  agency: "City of Colonial Heights",
  location: "Colonial Heights, VA",
  idPrefix: "colonial-heights",
};

export function fetchVaColonialHeightsBids(now = Date.now()) {
  return fetchCivicEngageBoard(COLONIAL_HEIGHTS_CONFIG, now);
}
