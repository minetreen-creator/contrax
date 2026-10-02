/**
 * Montana eMACS (Montana Acquisition & Contracting System) — `mt_emacs`, the
 * State of Montana's public list of open IFBs and RFPs for every state
 * agency and the university system, on JAGGAER
 * (bids.sciquest.com, CustomerOrg=StateOfMontana).
 *
 * WHY: Contrax had no state Montana feed. Agencies (DPHHS, DNRC, MDT,
 * Military Affairs, …) and the Montana University System post there.
 *
 * The reading, mapping and identity rules are shared with every JAGGAER
 * public site and documented in jaggaer-public.ts (verified live
 * 2026-10-02: 30 open events). The public list names no agency per event,
 * so the buyer is "State of Montana"; the agency code stays in the event
 * number (DNRC-…, DPHHS-…, MSU-…).
 *
 * IDENTITY: `external_id = mtemacs-<JAGGAER event id>`.
 */
import type { FetchResult } from "../runner";
import { fetchJaggaerBids, jaggaerListUrl, parseJaggaerPage, type JaggaerConfig, type JaggaerParseResult } from "./jaggaer-public";

export const MT_EMACS_CONFIG: JaggaerConfig = {
  source: "mt_emacs",
  customerOrg: "StateOfMontana",
  idPrefix: "mtemacs",
  stateName: "Montana",
  buyerName: "State of Montana",
  portalName: "Montana eMACS",
};

export const MT_EMACS_URL = jaggaerListUrl(MT_EMACS_CONFIG);

/** PURE parse of the Montana Open for Bid page — no network, no DB; `now` is injected. */
export function parseMtEmacsPage(html: string, now: number = Date.now()): JaggaerParseResult {
  return parseJaggaerPage(MT_EMACS_CONFIG, html, now);
}

/** Fetch every open Montana eMACS event and return ingest rows. */
export function fetchMtEmacsBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchJaggaerBids(MT_EMACS_CONFIG, now);
}
