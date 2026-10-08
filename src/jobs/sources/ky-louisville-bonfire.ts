/** Louisville Metro Government's own public Bonfire list. Verified 2026-10-08.
 * Uses the shared UTC deadline reader; only IFB/RFB/RFP/RFQ/RFI references
 * enter the procurement feed. RFA notices are excluded, not relabeled as bids.
 */
import type { FetchResult } from "../runner";
import { fetchBonfireBids, parseBonfire, type BonfireConfig, type BonfirePayload } from "./bonfire-public";

export const LOUISVILLE_CONFIG: BonfireConfig = {
  source: "ky_louisville_bonfire",
  host: "https://louisvilleky.bonfirehub.com",
  idPrefix: "louisvillebonfire",
  stateName: "Kentucky",
  locationName: "Louisville, KY",
  buyerName: "Louisville Metro Government",
  portalName: "Louisville Metro Government Procurement Portal (Bonfire)",
  agencyName: () => "Louisville Metro Government",
};

function procurementOnly(result: FetchResult): FetchResult {
  const skipped = { ...result.skipped };
  const skippedRows = [...(result.skippedRows ?? [])];
  const rows = result.rows.filter(row => {
    if (/^(?:IFB|RFB|RFP|RFQ|RFI)\d/i.test(row.solicitation_number ?? "")) return true;
    skipped.unsupported_notice_type = (skipped.unsupported_notice_type ?? 0) + 1;
    skippedRows.push({ id: row.external_id, reason: "unsupported_notice_type" });
    return false;
  });
  return { rows, skipped, skippedRows };
}

export function parseLouisvilleBonfire(payload: BonfirePayload, now = Date.now()): FetchResult {
  return procurementOnly(parseBonfire(LOUISVILLE_CONFIG, payload, now));
}

export async function fetchLouisvilleBonfireBids(now = Date.now()): Promise<FetchResult> {
  const result = procurementOnly(await fetchBonfireBids(LOUISVILLE_CONFIG, now));
  console.log(`  ky_louisville_bonfire: ${result.rows.length} procurement notices retained; ${result.skipped.unsupported_notice_type ?? 0} unsupported notice types excluded`);
  return result;
}
