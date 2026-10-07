/**
 * Milwaukee County Bonfire — `wi_milwaukee_county_bonfire` (owner 2026-10-07,
 * with the owner-supplied county Bids & RFPs page). Milwaukee County Procurement
 * releases most of its bids and RFPs on its own Bonfire portal
 * (`countymilwaukee.bonfirehub.com`); some solicitations (e.g. A&E construction
 * on Bid Express) live elsewhere and are not read here.
 *
 * SOURCE: the same public, no-login open-opportunities endpoint every Bonfire
 * tenant serves (see bonfire-public.ts):
 *   GET https://countymilwaukee.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * The tenant host was identified from public search results on 2026-10-07; the
 * Contrax dev sandbox could not reach bonfirehub.com or county.milwaukee.gov, so
 * the first scheduled sync is the first live read. A failed read records an error
 * run and stores nothing.
 *
 * IDENTITY: `external_id = mkecountybonfire-<ProjectID>`.
 */
import type { FetchResult } from "../runner";
import {
  bonfireAgencyName,
  fetchBonfireBids,
  parseBonfire,
  type BonfireConfig,
  type BonfireParseResult,
  type BonfirePayload,
} from "./bonfire-public";

/** The stored `bids.source` label. */
export const WI_MILWAUKEE_COUNTY_BONFIRE_SOURCE = "wi_milwaukee_county_bonfire";
/** The tenant itself — the only host this source reads or cites. */
export const WI_MILWAUKEE_COUNTY_BONFIRE_HOST = "https://countymilwaukee.bonfirehub.com";

export const WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG: BonfireConfig = {
  source: WI_MILWAUKEE_COUNTY_BONFIRE_SOURCE,
  host: WI_MILWAUKEE_COUNTY_BONFIRE_HOST,
  idPrefix: "mkecountybonfire",
  stateName: "Wisconsin",
  buyerName: "Milwaukee County",
  portalName: "the Milwaukee County Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Milwaukee County"),
};

/** PURE parse of the Milwaukee County open-opportunity list — no network, no DB; `now` is injected. */
export function parseWiMilwaukeeCountyBonfire(payload: BonfirePayload, now: number = Date.now()): BonfireParseResult {
  return parseBonfire(WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG, payload, now);
}

/** Fetch the Milwaukee County open-opportunity list and return ingest rows. */
export function fetchWiMilwaukeeCountyBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(WI_MILWAUKEE_COUNTY_BONFIRE_CONFIG, now);
}
