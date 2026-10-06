/**
 * The University of Texas at San Antonio — `tx_utsa_jaggaer`: UTSA's own public
 * bid portal, on JAGGAER (bids.sciquest.com, CustomerOrg=UTSA), where the
 * university posts its open solicitations (design and professional services,
 * planning studies, construction-related work) for every department.
 *
 * WHY: Texas had one state feed (`tx_esbd`) plus the two Bonfire tenants and the
 * UH and TAMU JAGGAER portals; nothing read UTSA's. The live probe (2026-10-06)
 * confirmed the reader family already handles its bytes: the repo's own
 * `parseJaggaerPage()` accepted 2/2 open events from the capture in
 * `fixtures/tx-utsa-jaggaer/`.
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * JAGGAER public site and documented in jaggaer-public.ts — this file is UTSA's
 * config; nothing about how a row is read is re-decided here.
 *
 * SOURCE (verified live 2026-10-06 ~05:58Z, no login, no cookie, no CAPTCHA):
 *   GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=UTSA&tab=PHX_NAV_SourcingOpenForBid&PageSize=200
 * → 200, 2 open events ("Open for Bid" tab). The page prints NO "of N Results"
 * total (the list is short enough not to page) — see jaggaer-public.ts's header
 * for how the count is still cross-checked. The page's own title is "UTSA" and
 * its banner prints the full name "The University of Texas at San Antonio";
 * that full name is the buyer used here. The public list names no agency per
 * event, so the solicitation number stays verbatim ("743-2027-RFQ-1562").
 *
 * IDENTITY: `external_id = txutsajaggaer-<JAGGAER event id>`.
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
export const TX_UTSA_JAGGAER_SOURCE = "tx_utsa_jaggaer";

export const TX_UTSA_JAGGAER_CONFIG: JaggaerConfig = {
  source: TX_UTSA_JAGGAER_SOURCE,
  customerOrg: "UTSA",
  idPrefix: "txutsajaggaer",
  stateName: "Texas",
  buyerName: "The University of Texas at San Antonio",
  portalName: "the UT San Antonio bid portal (JAGGAER)",
};

export const TX_UTSA_JAGGAER_URL = jaggaerListUrl(TX_UTSA_JAGGAER_CONFIG);

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` / #588 pattern).
 */
export const TX_UTSA_JAGGAER_COPY = {
  publisherLine:
    "Open solicitations as published by The University of Texas at San Antonio on its own public bid portal (JAGGAER / SciQuest).",
  /** The badge comes from `source-class.ts` (STATE → "State (TX)"); pinned here too. */
  badge: "State (TX)",
  openSetDefinition:
    'Showing the events the portal itself lists under "Open for Bid": status Open on the source, with a close date that has not passed. Sole-source notices (type "SolSour", or "sole source" in the title) are excluded by the source\'s own labels.',
  buyerMixNote:
    "The portal lists no agency per event; the department's own event number stays verbatim (e.g. \"743-2027-RFQ-1562\"). The buyer name is the one the portal's own banner prints (its page title is the short \"UTSA\").",
  timeZoneNote:
    "Close dates carry the time zone the portal prints beside them (CDT for the events in this capture); the instant shown here is the one the source printed.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every UT San Antonio solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/** PURE parse of UTSA's Open for Bid page — no network, no DB; `now` is injected. */
export function parseTxUtsaJaggaerPage(html: string, now: number = Date.now()): JaggaerParseResult {
  return parseJaggaerPage(TX_UTSA_JAGGAER_CONFIG, html, now);
}

/** Fetch every open UTSA event and return ingest rows. */
export function fetchTxUtsaJaggaerBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchJaggaerBids(TX_UTSA_JAGGAER_CONFIG, now);
}
