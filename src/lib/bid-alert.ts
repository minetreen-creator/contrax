import { NAICS_NAMES } from "~/lib/naics-names";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";

/**
 * "Get bids like this by email" on /bid/<id> (owner 2026-10-15: a Kansas City
 * visitor opened two bids and pricing, never ran Radar, and left no way to be
 * reached). Builds the match-alert profile from the bid itself, the same shape
 * /api/radar/lead stores from a Radar scan: the bid's 6-digit NAICS code as the
 * trade (alerts match it exactly) and its state. PURE — unit-tested.
 */
export interface BidAlertProfile {
  trade: string | null;
  state: string | null;
  /** e.g. "Computer Systems Design Services bids in Missouri". */
  label: string;
}

export function bidAlertProfile(bid: { naics_code: string | null; state_code: string | null }): BidAlertProfile | null {
  const naics = bid.naics_code && /^\d{6}$/.test(bid.naics_code.trim()) ? bid.naics_code.trim() : null;
  const state = bid.state_code && STATE_CODE_TO_NAME[bid.state_code] ? bid.state_code : null;
  if (!naics && !state) return null;
  const tradeName = naics ? NAICS_NAMES[naics] ?? null : null;
  const stateName = state ? STATE_CODE_TO_NAME[state] : null;
  const what = tradeName ? `${tradeName} bids` : naics ? `NAICS ${naics} bids` : "New bids";
  return { trade: naics, state, label: stateName ? `${what} in ${stateName}` : what };
}

/**
 * The same alert profile for a trade page such as /recompetes (owner
 * 2026-10-19): the trade's Radar search term (as a Radar scan stores it) and
 * the state, if one is chosen.
 */
export function tradeAlertProfile(trade: { radarTerm: string; label: string } | null | undefined, stateCode: string | null): BidAlertProfile | null {
  if (!trade) return null;
  const state = stateCode && STATE_CODE_TO_NAME[stateCode] ? stateCode : null;
  const stateName = state ? STATE_CODE_TO_NAME[state] : null;
  return { trade: trade.radarTerm, state, label: `New ${trade.label.toLowerCase()} bids${stateName ? ` in ${stateName}` : ""}` };
}
