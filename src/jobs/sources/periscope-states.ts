/**
 * The state marketplaces that run Periscope S2G (BuySpeed), each read by the
 * shared Periscope reader (periscope-bso.ts). Verified live 2026-10-01; open
 * bid counts that day in brackets.
 *
 *   ma_commbuys  COMMBUYS, Massachusetts [935] — state agencies plus the many
 *                towns, housing authorities and school districts that buy on it.
 *   nj_njstart   NJSTART, New Jersey [24]
 *   il_bidbuy    BidBuy, Illinois [191]
 *   or_oregonbuys OregonBuys, Oregon [178]
 *   nv_nevadaepro NevadaEPro, Nevada [31]
 *   ar_arbuy     ARBuy, Arkansas [0 open — VERIFIED EMPTY, not an ingestion
 *                error: rowCount:0 with the table body "No records found." on
 *                the ARBuy open-bids search both in the 2026-10-01 fixture and
 *                on a live fetch 2026-10-09. Arkansas' board is genuinely
 *                quiet; the reader still runs daily, so new solicitations
 *                appear as soon as they are posted]
 */
import type { FetchResult } from "../runner";
import { fetchBsoBids, type BsoConfig } from "./periscope-bso";

const ET = -5;
const CT = -6;
const PT = -8;

export const PERISCOPE_STATES: Record<string, BsoConfig> = {
  ma_commbuys: { source: "ma_commbuys", origin: "https://www.commbuys.com", idPrefix: "commbuys", stateName: "Massachusetts", portalName: "COMMBUYS", standardOffsetHours: ET },
  nj_njstart: { source: "nj_njstart", origin: "https://www.njstart.gov", idPrefix: "njstart", stateName: "New Jersey", portalName: "NJSTART", standardOffsetHours: ET },
  il_bidbuy: { source: "il_bidbuy", origin: "https://www.bidbuy.illinois.gov", idPrefix: "bidbuy", stateName: "Illinois", portalName: "BidBuy", standardOffsetHours: CT },
  or_oregonbuys: { source: "or_oregonbuys", origin: "https://oregonbuys.gov", idPrefix: "oregonbuys", stateName: "Oregon", portalName: "OregonBuys", standardOffsetHours: PT },
  nv_nevadaepro: { source: "nv_nevadaepro", origin: "https://nevadaepro.com", idPrefix: "nevadaepro", stateName: "Nevada", portalName: "NevadaEPro", standardOffsetHours: PT },
  ar_arbuy: { source: "ar_arbuy", origin: "https://arbuy.arkansas.gov", idPrefix: "arbuy", stateName: "Arkansas", portalName: "ARBuy", standardOffsetHours: CT },
};

/** USPS code for each Periscope source (registration + jurisdiction pins). */
export const PERISCOPE_STATE_CODES: Record<string, string> = {
  ma_commbuys: "MA",
  nj_njstart: "NJ",
  il_bidbuy: "IL",
  or_oregonbuys: "OR",
  nv_nevadaepro: "NV",
  ar_arbuy: "AR",
};

export const PERISCOPE_TAIL_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = Object.values(
  PERISCOPE_STATES,
).map((config) => ({ name: config.source, fetchFn: () => fetchBsoBids(config) }));
