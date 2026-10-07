/**
 * Milwaukee Public Schools Bonfire — `wi_mps_bonfire` (owner 2026-10-07; the
 * owner supplied the portal URL mps.bonfirehub.com/portal/?tab=openOpportunities).
 * MPS accepts bids and RFPs only through its Bonfire (Euna Procurement) portal;
 * janitorial, grounds, food service, transportation and facilities work for the
 * district's schools is posted here.
 *
 * SOURCE: the same public, no-login open-opportunities endpoint every Bonfire
 * tenant serves (see bonfire-public.ts):
 *   GET https://mps.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * The Contrax dev sandbox could not reach bonfirehub.com, so the first scheduled
 * sync is the first live read. A failed read records an error run and stores nothing.
 *
 * IDENTITY: `external_id = mpsbonfire-<ProjectID>`.
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
export const WI_MPS_BONFIRE_SOURCE = "wi_mps_bonfire";
/** The tenant itself — the only host this source reads or cites. */
export const WI_MPS_BONFIRE_HOST = "https://mps.bonfirehub.com";

export const WI_MPS_BONFIRE_CONFIG: BonfireConfig = {
  source: WI_MPS_BONFIRE_SOURCE,
  host: WI_MPS_BONFIRE_HOST,
  idPrefix: "mpsbonfire",
  stateName: "Wisconsin",
  buyerName: "Milwaukee Public Schools",
  portalName: "the Milwaukee Public Schools Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Milwaukee Public Schools"),
};

/** PURE parse of the Milwaukee Public Schools open-opportunity list — no network, no DB; `now` is injected. */
export function parseWiMpsBonfire(payload: BonfirePayload, now: number = Date.now()): BonfireParseResult {
  return parseBonfire(WI_MPS_BONFIRE_CONFIG, payload, now);
}

/** Fetch the Milwaukee Public Schools open-opportunity list and return ingest rows. */
export function fetchWiMpsBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(WI_MPS_BONFIRE_CONFIG, now);
}
