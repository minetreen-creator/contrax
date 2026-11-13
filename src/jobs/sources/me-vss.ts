/**
 * Maine Vendor Self Service (VSS) — `me_vss`, the State of Maine's public solicitation board (CGI
 * Advantage 4, run by DAFS Procurement Services). Since October 2025 every new state RFP, RFQ and RFI
 * is posted only here (maine.gov/dafs/bbm/procurementservices/vendors/rfps says so); before this
 * Contrax read Maine only through BidNet Direct (`me_bidnet`).
 *
 * The reading, mapping and identity rules are shared with every CGI Advantage VSS portal and documented
 * in advantage-vss.ts. Unlike the other VSS states, Maine is read as ContraxBot (owner rule, 2026-11-13:
 * our reader names itself). Checked from the sync network that day: 21 open rows, 20 biddable (RFQ/RFP),
 * one prequalification list skipped (`not_biddable_type`).
 *
 * IDENTITY: `external_id = mevss-<code>-<dept>-<number>`.
 */
import type { FetchResult } from "../runner";
import { fetchVssBids, parseVssGrid, vssUrl, type VssConfig, type VssGrid, type VssParseResult } from "./advantage-vss";

export const MEVSS_CONFIG: VssConfig = {
  source: "me_vss",
  origin: "https://mevss.hostams.com",
  idPrefix: "mevss",
  stateName: "Maine",
  portalName: "Maine Vendor Self Service (VSS)",
  biddableTypes: new Set(["IFB", "IFB1", "RFP", "RFQ", "RFQ1", "RFI", "ITN", "DQ1", "RFA"]),
  userAgent: "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)",
};

export const MEVSS_SOURCE = MEVSS_CONFIG.source;
export const MEVSS_URL = vssUrl(MEVSS_CONFIG);

/** PURE parse of the Maine grid — no network, no DB; `now` is injected. */
export function parseMeVssGrid(grid: VssGrid, now: number = Date.now()): VssParseResult {
  return parseVssGrid(MEVSS_CONFIG, grid, now);
}

/** Fetch every open Maine VSS solicitation and return ingest rows. */
export function fetchMeVssBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchVssBids(MEVSS_CONFIG, now);
}
