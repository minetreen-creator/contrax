/**
 * Texas A&M University — `tx_tamu_jaggaer`: TAMU's own public bid portal, on
 * JAGGAER (bids.sciquest.com, CustomerOrg=TAMU), where the university posts its
 * open solicitations (construction, maintenance, laboratory and research
 * equipment, services) for its colleges, agencies and system members.
 *
 * WHY: Texas had one state feed (`tx_esbd`) plus the two Bonfire tenants and
 * UH's JAGGAER portal; nothing read the TAMU portal. The live probe (2026-10-06)
 * confirmed the reader family already handles its bytes: the repo's own
 * `parseJaggaerPage()` accepted 21/21 open events from the capture in
 * `fixtures/tx-tamu-jaggaer/`.
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * JAGGAER public site and documented in jaggaer-public.ts — this file is TAMU's
 * config; nothing about how a row is read is re-decided here.
 *
 * SOURCE (verified live 2026-10-06 ~06:00Z, no login, no cookie, no CAPTCHA):
 *   GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=TAMU&tab=PHX_NAV_SourcingOpenForBid&PageSize=200
 * → 200, 21 open events, and this tenant's page prints a result total where the
 * three other new Texas tenants do not: "1-21 of 21 Results". It is the page's
 * own count and is cross-checked against the rows parsed (jaggaer-public.ts).
 *
 * The public list names no agency per event, so the buyer is "Texas A&M
 * University"; the publishing unit's own code stays in the event number
 * ("TAMU-RFP-27-5121", "TAMUG-ITB-27-0124", "AG-RSCH-ITB-6615", "TTI-ITB-1499",
 * "04-TARLTON-RFP-0024", "28-EQUI-ITB-1729"), kept verbatim and never expanded.
 *
 * IDENTITY: `external_id = txtamujaggaer-<JAGGAER event id>`.
 */
import type { FetchResult } from "../runner";
import {
  fetchJaggaerBids,
  jaggaerListUrl,
  parseJaggaerPage,
  type JaggaerConfig,
  type JaggaerParseResult,
} from "./jaggaer-public";

/** The stored `bids.source` label. */
export const TX_TAMU_JAGGAER_SOURCE = "tx_tamu_jaggaer";

export const TX_TAMU_JAGGAER_CONFIG: JaggaerConfig = {
  source: TX_TAMU_JAGGAER_SOURCE,
  customerOrg: "TAMU",
  idPrefix: "txtamujaggaer",
  stateName: "Texas",
  buyerName: "Texas A&M University",
  portalName: "the Texas A&M University bid portal (JAGGAER)",
};

export const TX_TAMU_JAGGAER_URL = jaggaerListUrl(TX_TAMU_JAGGAER_CONFIG);

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` / #588 pattern).
 */
export const TX_TAMU_JAGGAER_COPY = {
  publisherLine:
    "Open solicitations as published by Texas A&M University on its own public bid portal (JAGGAER / SciQuest).",
  /** The badge comes from `source-class.ts` (STATE → "State (TX)"); pinned here too. */
  badge: "State (TX)",
  openSetDefinition:
    'Showing the events the portal itself lists under "Open for Bid": status Open on the source, with a close date that has not passed. Sole-source notices (type "SolSour", or "sole source" in the title) are excluded by the source\'s own labels.',
  buyerMixNote:
    "The portal lists no agency per event; each publishing unit's own code stays in the event number (e.g. \"TAMU-RFP-27-5121\", \"TAMUG-ITB-27-0124\", \"AG-RSCH-ITB-6615\") and is kept verbatim, never expanded.",
  timeZoneNote:
    "Close dates carry the time zone the portal prints beside them (CDT for the events in this capture); the instant shown here is the one the source printed.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every Texas A&M University solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/** PURE parse of TAMU's Open for Bid page — no network, no DB; `now` is injected. */
export function parseTxTamuJaggaerPage(html: string, now: number = Date.now()): JaggaerParseResult {
  return parseJaggaerPage(TX_TAMU_JAGGAER_CONFIG, html, now);
}

/** Fetch every open TAMU event and return ingest rows. */
export function fetchTxTamuJaggaerBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchJaggaerBids(TX_TAMU_JAGGAER_CONFIG, now);
}
