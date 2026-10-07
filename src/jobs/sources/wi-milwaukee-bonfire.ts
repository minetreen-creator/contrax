/**
 * City of Milwaukee Bonfire — `wi_milwaukee_bonfire` (owner 2026-10-07: a
 * Milwaukee janitorial visitor found only 2 Wisconsin matches; add Milwaukee-area
 * sources). The City of Milwaukee's Purchasing Division posts its bids and RFPs
 * on its own Bonfire portal (`cityofmilwaukee.bonfirehub.com`) — the city's
 * purchasing pages name Bonfire as where all bid and RFP submissions go.
 *
 * WHY: Wisconsin's state feed (`wi_vendornet`) carries state agencies; city
 * purchasing (janitorial, grounds, fleet, construction) lives on the city's own
 * portal.
 *
 * SOURCE: the same public, no-login open-opportunities endpoint every Bonfire
 * tenant serves (see bonfire-public.ts):
 *   GET https://cityofmilwaukee.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * The tenant host was identified from public search results on 2026-10-07; the
 * Contrax dev sandbox could not reach bonfirehub.com, so the first scheduled sync
 * is the first live read. A failed read records an error run and stores nothing.
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * Bonfire tenant and documented in bonfire-public.ts.
 *
 * IDENTITY: `external_id = milwaukeebonfire-<ProjectID>`.
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
export const WI_MILWAUKEE_BONFIRE_SOURCE = "wi_milwaukee_bonfire";
/** The tenant itself — the only host this source reads or cites. */
export const WI_MILWAUKEE_BONFIRE_HOST = "https://cityofmilwaukee.bonfirehub.com";

export const WI_MILWAUKEE_BONFIRE_CONFIG: BonfireConfig = {
  source: WI_MILWAUKEE_BONFIRE_SOURCE,
  host: WI_MILWAUKEE_BONFIRE_HOST,
  idPrefix: "milwaukeebonfire",
  stateName: "Wisconsin",
  buyerName: "City of Milwaukee",
  portalName: "the City of Milwaukee Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "City of Milwaukee"),
};

/** PURE parse of the City of Milwaukee open-opportunity list — no network, no DB; `now` is injected. */
export function parseWiMilwaukeeBonfire(payload: BonfirePayload, now: number = Date.now()): BonfireParseResult {
  return parseBonfire(WI_MILWAUKEE_BONFIRE_CONFIG, payload, now);
}

/** Fetch the City of Milwaukee open-opportunity list and return ingest rows. */
export function fetchWiMilwaukeeBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(WI_MILWAUKEE_BONFIRE_CONFIG, now);
}
