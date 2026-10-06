/**
 * TxDOT Bonfire — `tx_txdot_bonfire`: the Texas Department of Transportation's
 * own public procurement portal (`txdot.bonfirehub.com`), where TxDOT posts its
 * open solicitations for districts and divisions statewide (construction
 * services, maintenance facilities, professional and support services, IT and
 * equipment). It is the agency's OWN portal, not a statewide board — the Texas
 * statewide board is ESBD (`tx_esbd`).
 *
 * WHY: Texas had one state feed (`tx_esbd`), which carries state agencies,
 * universities, ISDs, counties and cities. TxDOT's own solicitations post to
 * its Bonfire tenant as well, and the desk research + live probe (2026-10-06)
 * confirmed the reader family already handles its bytes (37/37 accepted).
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * Bonfire tenant and documented in bonfire-public.ts. This file is TxDOT's
 * config; nothing about how a row is read is re-decided here.
 *
 * SOURCE (verified live 2026-10-06 ~05:58Z, no login, no cookie, no CAPTCHA):
 *   GET https://txdot.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * → 200, 11,972 bytes, success:1, 37 open projects across 8 departments. The
 * portal's own Department column renders those departments verbatim ("SSD_CM",
 * "PEPS", "PRO_Equip_Gen", "PRO_IT", "PRO_North_East", "PRO_Services",
 * "PRO_South_West", "PRO_Strategic") and no expansion of those codes is
 * published on the source, so `agency` is the verbatim label — never expanded,
 * never replaced with a guess.
 *
 * TIME ZONE: `DateClose` is Bonfire's UTC DB-date string; the tenant page sets
 * `var timezone = "America/Chicago"` for DISPLAY only. Proof and rule in
 * bonfire-public.ts (TxDOT row 249305: stored "2026-10-06 17:00:00", portal
 * prints "Oct 6th 2026, 12:00 PM CDT").
 *
 * OWNER-APPROVED SCOPE: this tenant only. TxDOT *lettings* (the public letting-
 * date calendar + the login-gated iCX bidding system) are explicitly NOT read
 * here and are parked; this connector reads nothing but the Bonfire tenant's own
 * open-opportunities list.
 *
 * IDENTITY: `external_id = txdotbonfire-<ProjectID>`.
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
export const TX_TXDOT_BONFIRE_SOURCE = "tx_txdot_bonfire";
/** The tenant itself — the only host this source reads or cites. */
export const TX_TXDOT_BONFIRE_HOST = "https://txdot.bonfirehub.com";

export const TX_TXDOT_BONFIRE_CONFIG: BonfireConfig = {
  source: TX_TXDOT_BONFIRE_SOURCE,
  host: TX_TXDOT_BONFIRE_HOST,
  idPrefix: "txdotbonfire",
  stateName: "Texas",
  buyerName: "Texas Department of Transportation",
  portalName: "the TxDOT Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Texas Department of Transportation"),
};

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` pattern).
 */
export const TX_TXDOT_BONFIRE_COPY = {
  publisherLine:
    "Open solicitations as published by the Texas Department of Transportation on its own Bonfire procurement portal.",
  /** The badge comes from `source-class.ts` (STATE → "State (TX)"); pinned here too. */
  badge: "State (TX)",
  openSetDefinition:
    "Showing the opportunities TxDOT's portal itself lists as open: status Open on the source, with a close date that has not passed. Amendment and extension requests and notices of intent to award without a competition are excluded by the source's own labels.",
  buyerMixNote:
    "TxDOT posts as its districts and divisions, and the portal's Department column shows each posting department's own label (e.g. \"SSD_CM\", \"PEPS\") — kept verbatim, as the source states it.",
  timeZoneNote:
    "Close dates are stored by Bonfire in UTC. The portal displays them in the organization's own time zone (America/Chicago for TxDOT); the date shown here is the source's own stored instant.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every TxDOT solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/** PURE parse of TxDOT's open-opportunity list — no network, no DB; `now` is injected. */
export function parseTxTxdotBonfire(payload: BonfirePayload, now: number = Date.now()): BonfireParseResult {
  return parseBonfire(TX_TXDOT_BONFIRE_CONFIG, payload, now);
}

/** Fetch TxDOT's open-opportunity list and return ingest rows. */
export function fetchTxTxdotBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(TX_TXDOT_BONFIRE_CONFIG, now);
}
