/**
 * Michigan SIGMA Vendor Self Service — `mi_sigma`, the State of Michigan's
 * public solicitation board (sigma.michigan.gov, CGI Advantage 4, run by the
 * Department of Technology, Management and Budget).
 *
 * WHY: Contrax had no state Michigan feed; its Michigan rows came from the
 * federal SAM.gov pass. State departments (DTMB, MDOT, DHHS, …) post on
 * SIGMA, and so do local schools and districts that buy through it (Kent ISD,
 * Gibraltar School District, …).
 *
 * The reading, mapping and identity rules are shared with every CGI Advantage
 * VSS portal and documented in advantage-vss.ts (verified on SIGMA live
 * 2026-10-01: 119 open solicitations).
 *
 * WHAT IS KEPT: Request for Proposals (RFP), Request for Quotes (RFQ),
 * Request for Information (RFI), Invitation to Negotiate (ITN) and
 * Competitive Proof of Concept (CPC). Skipped (`not_biddable_type`): Notices
 * of Intent to Award (NIA1), Negotiations rounds (BAFO, shortlisted offerors
 * only) and Direct Solicitations (DS, sent to invited vendors).
 *
 * The grid's department names include local buyers, so `agency` is the
 * buyer as SIGMA shows it and `location` is "Michigan".
 *
 * IDENTITY: `external_id = misigma-<code>-<dept>-<number>`.
 */
import type { FetchResult } from "../runner";
import { fetchVssBids, parseVssGrid, vssUrl, type VssConfig, type VssGrid, type VssParseResult } from "./advantage-vss";

export const MISIGMA_CONFIG: VssConfig = {
  source: "mi_sigma",
  origin: "https://sigma.michigan.gov",
  idPrefix: "misigma",
  stateName: "Michigan",
  portalName: "Michigan SIGMA Vendor Self Service",
  biddableTypes: new Set(["RFP", "RFQ", "RFI", "ITN", "CPC"]),
};

export const MISIGMA_URL = vssUrl(MISIGMA_CONFIG);

/** PURE parse of the Michigan grid — no network, no DB; `now` is injected. */
export function parseMiSigmaGrid(grid: VssGrid, now: number = Date.now()): VssParseResult {
  return parseVssGrid(MISIGMA_CONFIG, grid, now);
}

/** Fetch every open SIGMA solicitation and return ingest rows. */
export function fetchMiSigmaBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchVssBids(MISIGMA_CONFIG, now);
}
