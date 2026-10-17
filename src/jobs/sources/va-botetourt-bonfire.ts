/** Botetourt County's official public Bonfire board, linked by the county at
 * https://www.botetourtva.gov/496/Vendor-Registration.
 * Captured 2026-10-17: Janitorial Services (26-045), closing Nov 5, 19:00 UTC,
 * and Landfill Vegetation Mowing and Brush Removal (26-054).
 * Use the shared reader's open-status, deadline, and purchased-service guards.
 * No detail documents, private opportunities, or registration are accessed.
 */
import type { FetchResult } from "../runner";
import {
  bonfireAgencyName,
  fetchBonfireBids,
  parseBonfire,
  type BonfireConfig,
  type BonfirePayload,
} from "./bonfire-public";

export const VA_BOTETOURT_BONFIRE_CONFIG: BonfireConfig = {
  source: "va_botetourt_bonfire",
  host: "https://botetourtva.bonfirehub.com",
  idPrefix: "botetourtbonfire",
  stateName: "Virginia",
  locationName: "Botetourt County, VA",
  buyerName: "Botetourt County, Virginia",
  portalName: "the Botetourt County Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Botetourt County, Virginia"),
};

export function parseVaBotetourtBonfire(payload: BonfirePayload, now = Date.now()) {
  return parseBonfire(VA_BOTETOURT_BONFIRE_CONFIG, payload, now);
}

export function fetchVaBotetourtBonfireBids(now = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(VA_BOTETOURT_BONFIRE_CONFIG, now);
}
