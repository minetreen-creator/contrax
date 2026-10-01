/**
 * Kentucky eProcurement Vendor Self Service — `ky_vss`, the Commonwealth of
 * Kentucky's public solicitation board (vss.ky.gov, CGI Advantage 4, run by
 * the Finance and Administration Cabinet's Office of Procurement Services).
 *
 * WHY: Contrax had no state Kentucky feed. Commonwealth agencies (Facilities
 * & Support Services, the Office of the Controller, Transportation, Parks,
 * Corrections, …) post their bids and proposals on Kentucky VSS.
 *
 * The reading, mapping and identity rules are shared with every CGI Advantage
 * VSS portal and documented in advantage-vss.ts (verified on Kentucky VSS live
 * 2026-10-01: 57 open solicitations). The app lives under /vssprod-ext/.
 *
 * WHAT IS KEPT: Requests for Bids, Requests for Proposals, Requests for
 * Quote and Requests for Information. Skipped (`not_biddable_type`): P3
 * notices (public-private partnership announcements, not solicitations).
 *
 * IDENTITY: `external_id = kyvss-<code>-<dept>-<number>`.
 */
import type { FetchResult } from "../runner";
import { fetchVssBids, parseVssGrid, vssUrl, type VssConfig, type VssGrid, type VssParseResult } from "./advantage-vss";

export const KYVSS_CONFIG: VssConfig = {
  source: "ky_vss",
  origin: "https://vss.ky.gov",
  path: "/vssprod-ext/Advantage4",
  idPrefix: "kyvss",
  stateName: "Kentucky",
  portalName: "Kentucky eProcurement Vendor Self Service",
  biddableTypes: new Set(["RFB", "RFP", "RFQ", "RFI"]),
};

export const KYVSS_URL = vssUrl(KYVSS_CONFIG);

/** PURE parse of the Kentucky grid — no network, no DB; `now` is injected. */
export function parseKyVssGrid(grid: VssGrid, now: number = Date.now()): VssParseResult {
  return parseVssGrid(KYVSS_CONFIG, grid, now);
}

/** Fetch every open Kentucky VSS solicitation and return ingest rows. */
export function fetchKyVssBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchVssBids(KYVSS_CONFIG, now);
}
