/**
 * University of Houston — `tx_uh_jaggaer`: UH's own public bid portal, on
 * JAGGAER (bids.sciquest.com, CustomerOrg=UH), where the university posts its
 * open solicitations (facilities, housing, IT and equipment, professional
 * services) for every department.
 *
 * WHY: Texas had one state feed (`tx_esbd`, which covers state agencies,
 * universities, ISDs, counties and cities), the TxDOT and UT Tyler Bonfire
 * tenants (`tx_txdot_bonfire`, `tx_uttyler_bonfire`) and nothing that reads a
 * Texas university's own JAGGAER portal. The desk research + live probe
 * (2026-10-06) confirmed the reader family already handles these bytes: the
 * repo's own `parseJaggaerPage()` accepted 5/5 open events from the capture in
 * `fixtures/tx-uh-jaggaer/`.
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * JAGGAER public site and documented in jaggaer-public.ts — this file is UH's
 * config; nothing about how a row is read is re-decided here.
 *
 * SOURCE (verified live 2026-10-06 ~05:58Z, no login, no cookie, no CAPTCHA):
 *   GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=UH&tab=PHX_NAV_SourcingOpenForBid&PageSize=200
 * → 200, 5 open events ("Open for Bid" tab). The page prints NO "of N Results"
 * total (the list is short enough not to page) — see jaggaer-public.ts's header
 * for how the count is still cross-checked. The public list names no agency per
 * event, so the buyer is "University of Houston"; the publishing department's
 * own code stays in the event number (e.g. "RFP-730-UofH-3154"), kept verbatim
 * and never expanded.
 *
 * IDENTITY: `external_id = txuhjaggaer-<JAGGAER event id>`.
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
export const TX_UH_JAGGAER_SOURCE = "tx_uh_jaggaer";

export const TX_UH_JAGGAER_CONFIG: JaggaerConfig = {
  source: TX_UH_JAGGAER_SOURCE,
  customerOrg: "UH",
  idPrefix: "txuhjaggaer",
  stateName: "Texas",
  buyerName: "University of Houston",
  portalName: "the University of Houston bid portal (JAGGAER)",
};

export const TX_UH_JAGGAER_URL = jaggaerListUrl(TX_UH_JAGGAER_CONFIG);

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` / #588 pattern).
 */
export const TX_UH_JAGGAER_COPY = {
  publisherLine:
    "Open solicitations as published by the University of Houston on its own public bid portal (JAGGAER / SciQuest).",
  /** The badge comes from `source-class.ts` (STATE → "State (TX)"); pinned here too. */
  badge: "State (TX)",
  openSetDefinition:
    'Showing the events the portal itself lists under "Open for Bid": status Open on the source, with a close date that has not passed. Sole-source notices (type "SolSour", or "sole source" in the title) are excluded by the source\'s own labels.',
  buyerMixNote:
    "The portal lists no agency per event; the publishing department's own code stays in the event number (e.g. \"RFP-730-UofH-3154\") and is kept verbatim, never expanded.",
  timeZoneNote:
    "Close dates carry the time zone the portal prints beside them (CDT for the events in this capture); the instant shown here is the one the source printed.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every University of Houston solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/** PURE parse of UH's Open for Bid page — no network, no DB; `now` is injected. */
export function parseTxUhJaggaerPage(html: string, now: number = Date.now()): JaggaerParseResult {
  return parseJaggaerPage(TX_UH_JAGGAER_CONFIG, html, now);
}

/** Fetch every open UH event and return ingest rows. */
export function fetchTxUhJaggaerBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchJaggaerBids(TX_UH_JAGGAER_CONFIG, now);
}
