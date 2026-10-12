/**
 * City of Dallas, Texas — its own Bonfire portal (`tx_dallas_bonfire`).
 *
 * WHY: Dallas (the 9th-largest US city) had no city source — only Texas state
 * bids (owner 2026-10-12). The City's Office of Procurement Services posts every
 * solicitation on Bonfire ("For up-to-date procurement opportunities please visit
 * Bonfire", dallascityhall.com/departments/procurement).
 *
 * SOURCE (verified live 2026-10-12, no login, no CAPTCHA): the public endpoint
 * every Bonfire tenant serves (see bonfire-public.ts):
 *   GET https://dallascityhall.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * 17 open projects on 2026-10-12 (fixtures/tx-dallas-bonfire/open-2026-10-12.json.gz).
 * The tenant publishes no departments, so every row's agency is "City of Dallas".
 *
 * The reading, mapping, identity, time-zone and rate-limit rules are shared with
 * every Bonfire tenant and documented in bonfire-public.ts.
 *
 * IDENTITY: `external_id = dallasbonfire-<ProjectID>`.
 */
import type { FetchResult } from "../runner";
import { bonfireAgencyName, fetchBonfireBids, type BonfireConfig } from "./bonfire-public";

export const TX_DALLAS_BONFIRE_SOURCE = "tx_dallas_bonfire";

export const TX_DALLAS_BONFIRE_CONFIG: BonfireConfig = {
  source: TX_DALLAS_BONFIRE_SOURCE,
  host: "https://dallascityhall.bonfirehub.com",
  idPrefix: "dallasbonfire",
  stateName: "Texas",
  locationName: "Dallas, TX",
  buyerName: "City of Dallas",
  portalName: "the City of Dallas procurement portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "City of Dallas"),
};

/** Fetch the City of Dallas's open-opportunity list and return ingest rows. */
export function fetchTxDallasBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(TX_DALLAS_BONFIRE_CONFIG, now);
}
