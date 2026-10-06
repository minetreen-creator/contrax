/**
 * UT Tyler / UT Health Science Center at Tyler Bonfire — `tx_uttyler_bonfire`:
 * the University of Texas at Tyler's own public procurement portal
 * (`uttyler.bonfirehub.com`), where UT Tyler posts its open solicitations.
 *
 * ONE TENANT, TWO PUBLISHERS: the tenant's portal is titled "University of Texas
 * at Tyler" and its open list carries rows for BOTH UT Tyler and UT Health
 * Science Center at Tyler — there is no separate UTHSCT portal. Each row's own
 * title says which institution it belongs to, so the pair rides one source
 * (owner-approved scope: "UT Tyler/UT Health bonfire tenant") and no per-row
 * institution is inferred from anything but the row's verbatim text.
 *
 * WHY: Texas's state feed (`tx_esbd`) carries university solicitations only when
 * the university posts them there; the UT Tyler tenant's own list is where its
 * open work appears. The probe (2026-10-06) confirmed the reader family already
 * handles its bytes (2/2 accepted).
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * Bonfire tenant and documented in bonfire-public.ts. This file is UT Tyler's
 * config; nothing about how a row is read is re-decided here.
 *
 * SOURCE (verified live 2026-10-06 ~05:58Z, no login, no cookie, no CAPTCHA; the
 * bare `/opportunities` URL 307-redirects to the portal):
 *   GET https://uttyler.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * → 200, 785 bytes, success:1, 2 open projects. The portal's Department column
 * renders the department verbatim ("Procurement"), so `agency` is that label.
 *
 * TIME ZONE: `DateClose` is Bonfire's UTC DB-date string; the tenant page sets
 * `var timezone = "America/Chicago"` for DISPLAY only. Proof and rule in
 * bonfire-public.ts (UT Tyler row 256294: stored "2026-10-28 20:00:00", portal
 * prints "Oct 28th 2026, 3:00 PM CDT").
 *
 * IDENTITY: `external_id = uttylerbonfire-<ProjectID>`.
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
export const TX_UTTYLER_BONFIRE_SOURCE = "tx_uttyler_bonfire";
/** The tenant itself — the only host this source reads or cites. */
export const TX_UTTYLER_BONFIRE_HOST = "https://uttyler.bonfirehub.com";

export const TX_UTTYLER_BONFIRE_CONFIG: BonfireConfig = {
  source: TX_UTTYLER_BONFIRE_SOURCE,
  host: TX_UTTYLER_BONFIRE_HOST,
  idPrefix: "uttylerbonfire",
  stateName: "Texas",
  buyerName: "University of Texas at Tyler",
  portalName: "the UT Tyler Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "University of Texas at Tyler"),
};

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` pattern).
 */
export const TX_UTTYLER_BONFIRE_COPY = {
  publisherLine:
    "Open solicitations as published by the University of Texas at Tyler on its own Bonfire procurement portal.",
  /** The badge comes from `source-class.ts` (STATE → "State (TX)"); pinned here too. */
  badge: "State (TX)",
  openSetDefinition:
    "Showing the opportunities the UT Tyler portal itself lists as open: status Open on the source, with a close date that has not passed. Amendment and extension requests and notices of intent to award without a competition are excluded by the source's own labels.",
  buyerMixNote:
    "This tenant carries the open solicitations of the University of Texas at Tyler and of UT Health Science Center at Tyler — each row's own title names the institution; the portal's Department column (\"Procurement\") is kept verbatim.",
  timeZoneNote:
    "Close dates are stored by Bonfire in UTC. The portal displays them in the organization's own time zone (America/Chicago for UT Tyler); the date shown here is the source's own stored instant.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every UT Tyler or UT Health Science Center at Tyler solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/** PURE parse of the UT Tyler open-opportunity list — no network, no DB; `now` is injected. */
export function parseTxUttylerBonfire(payload: BonfirePayload, now: number = Date.now()): BonfireParseResult {
  return parseBonfire(TX_UTTYLER_BONFIRE_CONFIG, payload, now);
}

/** Fetch the UT Tyler open-opportunity list and return ingest rows. */
export function fetchTxUttylerBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(TX_UTTYLER_BONFIRE_CONFIG, now);
}
