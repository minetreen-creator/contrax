/**
 * Colorado Vendor Self Service (VSS) — `co_vss`, the State of Colorado's
 * public solicitation board (CGI Advantage 4, run by the Department of
 * Personnel & Administration, State Purchasing & Contracts Office).
 *
 * WHY: Contrax had no state Colorado feed; its Colorado rows came from the
 * federal SAM.gov "co" keyword pass. State departments and colleges (CDOT,
 * Corrections, CDPHE, CDHS, DOLA, community colleges, …) post on VSS.
 *
 * The reading, mapping and identity rules are shared with every CGI Advantage
 * VSS portal and documented in advantage-vss.ts. 56 open solicitations on
 * 2026-10-01, 44 of them biddable.
 *
 * WHAT IS KEPT: document types a business can respond to — Invitation for
 * Bids (IFB1), Documented Quote (DQ1), Request for Proposals (RFP), Request
 * for Quotes (RFQ), Request for Qualifications (RFQ1), Request for
 * Information (RFI), Invitation to Negotiate (ITN). Contractor-settlement
 * notices (NCS1), sole-source notices (NPSS1), Best and Final Offer rounds
 * (BAFO, shortlisted offerors only) and Grant Funding Opportunities (GFO)
 * are skipped (`not_biddable_type`).
 *
 * IDENTITY: `external_id = covss-<code>-<dept>-<number>`.
 */
import type { FetchResult } from "../runner";
import {
  fetchVssBids,
  parseVssDocRef,
  parseVssGrid,
  vssGrid,
  vssOpenBody,
  vssSessionInfo,
  vssShowLinesBody,
  vssUrl,
  VSS_ROWS,
  VSS_USER_AGENT,
  type VssConfig,
  type VssGrid,
  type VssParseResult,
  type VssRow,
} from "./advantage-vss";

export const COVSS_CONFIG: VssConfig = {
  source: "co_vss",
  origin: "https://prd.co.cgiadvantage.com",
  idPrefix: "covss",
  stateName: "Colorado",
  portalName: "Colorado Vendor Self Service (VSS)",
  biddableTypes: new Set(["IFB1", "DQ1", "RFP", "RFQ", "RFQ1", "RFI", "ITN"]),
};

export const COVSS_SOURCE = COVSS_CONFIG.source;
export const COVSS_ORIGIN = COVSS_CONFIG.origin;
export const COVSS_URL = vssUrl(COVSS_CONFIG);
export const COVSS_ROWS = VSS_ROWS;
export const COVSS_USER_AGENT = VSS_USER_AGENT;
export const COVSS_BIDDABLE_TYPES = COVSS_CONFIG.biddableTypes;

export type CoVssRow = VssRow;
export type CoVssGrid = VssGrid;
export type CoVssParseResult = VssParseResult;

export const parseCoVssDocRef = parseVssDocRef;
export const coVssGrid = vssGrid;
export const coVssSessionInfo = vssSessionInfo;
export const coVssOpenBody = vssOpenBody;
export const coVssShowLinesBody = vssShowLinesBody;

/** PURE parse of the Colorado grid — no network, no DB; `now` is injected. */
export function parseCoVssGrid(grid: CoVssGrid, now: number = Date.now()): CoVssParseResult {
  return parseVssGrid(COVSS_CONFIG, grid, now);
}

/** Fetch every open Colorado VSS solicitation and return ingest rows. */
export function fetchCoVssBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchVssBids(COVSS_CONFIG, now);
}
