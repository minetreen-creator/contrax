/**
 * Texas Tech University — `tx_texastech_jaggaer`: Texas Tech's own public bid
 * portal, on JAGGAER (bids.sciquest.com, CustomerOrg=TexasTech), where the
 * university posts its open solicitations (professional and search services,
 * renovation and construction work, consulting).
 *
 * WHY: Texas had one state feed (`tx_esbd`) plus the two Bonfire tenants, UH's
 * and TAMU's JAGGAER portals; nothing read Texas Tech's. The live probe
 * (2026-10-06) confirmed the reader family already handles its bytes: the repo's
 * own `parseJaggaerPage()` accepted 4/4 open events from the capture in
 * `fixtures/tx-texastech-jaggaer/`.
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * JAGGAER public site and documented in jaggaer-public.ts — this file is Texas
 * Tech's config; nothing about how a row is read is re-decided here.
 *
 * SOURCE (verified live 2026-10-06 ~05:58Z, no login, no cookie, no CAPTCHA):
 *   GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=TexasTech&tab=PHX_NAV_SourcingOpenForBid&PageSize=200
 * → 200, 4 open events ("Open for Bid" tab). The page prints NO "of N Results"
 * total (the list is short enough not to page) — see jaggaer-public.ts's header
 * for how the count is still cross-checked. The page's own title is "Texas Tech";
 * that is the buyer name used here. The public list names no agency per event, so
 * each publishing unit's own code stays in the event number (e.g.
 * "TTUHSCEP-RFP 774-214971517", "2026-1191"), kept verbatim and never expanded.
 *
 * IDENTITY: `external_id = txtexastechjaggaer-<JAGGAER event id>`.
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
export const TX_TEXASTECH_JAGGAER_SOURCE = "tx_texastech_jaggaer";

export const TX_TEXASTECH_JAGGAER_CONFIG: JaggaerConfig = {
  source: TX_TEXASTECH_JAGGAER_SOURCE,
  customerOrg: "TexasTech",
  idPrefix: "txtexastechjaggaer",
  stateName: "Texas",
  buyerName: "Texas Tech",
  portalName: "the Texas Tech bid portal (JAGGAER)",
};

export const TX_TEXASTECH_JAGGAER_URL = jaggaerListUrl(TX_TEXASTECH_JAGGAER_CONFIG);

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` / #588 pattern).
 */
export const TX_TEXASTECH_JAGGAER_COPY = {
  publisherLine:
    "Open solicitations as published by Texas Tech on its own public bid portal (JAGGAER / SciQuest).",
  /** The badge comes from `source-class.ts` (STATE → "State (TX)"); pinned here too. */
  badge: "State (TX)",
  openSetDefinition:
    'Showing the events the portal itself lists under "Open for Bid": status Open on the source, with a close date that has not passed. Sole-source notices (type "SolSour", or "sole source" in the title) are excluded by the source\'s own labels.',
  buyerMixNote:
    'The portal lists no agency per event; each publishing unit\'s own code stays in the event number (e.g. "TTUHSCEP-RFP 774-214971517") and is kept verbatim — the source publishes no expansion of those codes.',
  timeZoneNote:
    "Close dates carry the time zone the portal prints beside them (CDT, and MST for the December event in this capture); the instant shown here is the one the source printed.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every Texas Tech solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/** PURE parse of Texas Tech's Open for Bid page — no network, no DB; `now` is injected. */
export function parseTxTexasTechJaggaerPage(html: string, now: number = Date.now()): JaggaerParseResult {
  return parseJaggaerPage(TX_TEXASTECH_JAGGAER_CONFIG, html, now);
}

/** Fetch every open Texas Tech event and return ingest rows. */
export function fetchTxTexasTechJaggaerBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchJaggaerBids(TX_TEXASTECH_JAGGAER_CONFIG, now);
}
