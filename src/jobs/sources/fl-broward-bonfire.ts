/** Broward County's official public Bonfire board, "BPRO Electronic Procurement
 * System" (the county moved new solicitations from Periscope S2G to Bonfire; see
 * https://www.broward.org/Purchasing/Pages/BPRO.aspx).
 * Captured 2026-10-27: 25 open projects, including Broward County Judicial Court
 * West Tower Repairs (PNC2132739C1) and Transit Bus Stop ADA Improvements (FTA).
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

export const FL_BROWARD_BONFIRE_CONFIG: BonfireConfig = {
  source: "fl_broward_bonfire",
  host: "https://broward.bonfirehub.com",
  idPrefix: "browardbonfire",
  stateName: "Florida",
  locationName: "Broward County, FL",
  buyerName: "Broward County, Florida",
  portalName: "Broward County's BPRO Electronic Procurement System (Bonfire)",
  agencyName: (dept) => {
    const name = bonfireAgencyName(dept, "Broward County, Florida");
    return name === "Broward County, Florida" ? name : `Broward County ${name}`;
  },
};

export function parseFlBrowardBonfire(payload: BonfirePayload, now = Date.now()) {
  return parseBonfire(FL_BROWARD_BONFIRE_CONFIG, payload, now);
}

export function fetchFlBrowardBonfireBids(now = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(FL_BROWARD_BONFIRE_CONFIG, now);
}
