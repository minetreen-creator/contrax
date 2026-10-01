/**
 * West Virginia wvOASIS Vendor Self Service — `wv_oasis`, the State of West
 * Virginia's public solicitation board (prd311.wvoasis.gov, CGI Advantage 4,
 * run by the Purchasing Division).
 *
 * WHY: Contrax had no state West Virginia feed. State agencies (Division of
 * Highways, DEP, Natural Resources, Corrections, Office of Technology, …)
 * post their quotes and proposals on wvOASIS VSS, both agency-level and
 * centralized through the Purchasing Division.
 *
 * The reading, mapping and identity rules are shared with every CGI Advantage
 * VSS portal and documented in advantage-vss.ts (verified on wvOASIS live
 * 2026-10-01: 52 open solicitations). The app lives under /PRDVSS1X1ERP/.
 *
 * WHAT IS KEPT: Requests for Quote, Requests for Proposals, Requests for
 * Information and Expressions of Interest, agency (A…) and centralized (C…).
 * Skipped (`not_biddable_type`): sole source determinations (ASSD, CSSD) and
 * Best and Final Offer rounds (BAFO, shortlisted offerors only).
 *
 * IDENTITY: `external_id = wvoasis-<code>-<dept>-<number>`.
 */
import type { FetchResult } from "../runner";
import { fetchVssBids, parseVssGrid, vssUrl, type VssConfig, type VssGrid, type VssParseResult } from "./advantage-vss";

export const WVOASIS_CONFIG: VssConfig = {
  source: "wv_oasis",
  origin: "https://prd311.wvoasis.gov",
  path: "/PRDVSS1X1ERP/Advantage4",
  idPrefix: "wvoasis",
  stateName: "West Virginia",
  portalName: "West Virginia wvOASIS Vendor Self Service",
  biddableTypes: new Set(["ARFQ", "CRFQ", "ARFP", "CRFP", "ARFI", "CRFI", "AEOI", "CEOI"]),
};

export const WVOASIS_URL = vssUrl(WVOASIS_CONFIG);

/** PURE parse of the West Virginia grid — no network, no DB; `now` is injected. */
export function parseWvOasisGrid(grid: VssGrid, now: number = Date.now()): VssParseResult {
  return parseVssGrid(WVOASIS_CONFIG, grid, now);
}

/** Fetch every open wvOASIS solicitation and return ingest rows. */
export function fetchWvOasisBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchVssBids(WVOASIS_CONFIG, now);
}
