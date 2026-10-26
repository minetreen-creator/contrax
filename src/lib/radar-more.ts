/**
 * Owner 2026-10-26: 39% of anonymous Radar searches found nothing and most
 * visitors left 11 seconds after results. When a search finds 0–3 bids in a
 * state, Radar shows more real options: the same trade in bordering states,
 * federal contracts in the state coming up for rebid, and industry days.
 */

/** Land borders (plus DC with MD/VA). AK and HI have none. */
export const NEIGHBOR_STATES: Record<string, readonly string[]> = {
  AL: ["FL", "GA", "MS", "TN"], AK: [], AZ: ["CA", "CO", "NM", "NV", "UT"], AR: ["LA", "MO", "MS", "OK", "TN", "TX"],
  CA: ["AZ", "NV", "OR"], CO: ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"], CT: ["MA", "NY", "RI"], DE: ["MD", "NJ", "PA"],
  DC: ["MD", "VA"], FL: ["AL", "GA"], GA: ["AL", "FL", "NC", "SC", "TN"], HI: [], ID: ["MT", "NV", "OR", "UT", "WA", "WY"],
  IL: ["IA", "IN", "KY", "MO", "WI"], IN: ["IL", "KY", "MI", "OH"], IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  KS: ["CO", "MO", "NE", "OK"], KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"], LA: ["AR", "MS", "TX"], ME: ["NH"],
  MD: ["DC", "DE", "PA", "VA", "WV"], MA: ["CT", "NH", "NY", "RI", "VT"], MI: ["IN", "OH", "WI"], MN: ["IA", "ND", "SD", "WI"],
  MS: ["AL", "AR", "LA", "TN"], MO: ["AR", "IA", "IL", "KS", "KY", "NE", "OK", "TN"], MT: ["ID", "ND", "SD", "WY"],
  NE: ["CO", "IA", "KS", "MO", "SD", "WY"], NV: ["AZ", "CA", "ID", "OR", "UT"], NH: ["MA", "ME", "VT"], NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"], NY: ["CT", "MA", "NJ", "PA", "VT"], NC: ["GA", "SC", "TN", "VA"], ND: ["MN", "MT", "SD"],
  OH: ["IN", "KY", "MI", "PA", "WV"], OK: ["AR", "CO", "KS", "MO", "NM", "TX"], OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"], RI: ["CT", "MA"], SC: ["GA", "NC"], SD: ["IA", "MN", "MT", "ND", "NE", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MO", "MS", "NC", "VA"], TX: ["AR", "LA", "NM", "OK"], UT: ["AZ", "CO", "ID", "NM", "NV", "WY"],
  VT: ["MA", "NH", "NY"], VA: ["DC", "KY", "MD", "NC", "TN", "WV"], WA: ["ID", "OR"], WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IA", "IL", "MI", "MN"], WY: ["CO", "ID", "MT", "NE", "SD", "UT"],
};

export function neighborStates(state: string): readonly string[] {
  return NEIGHBOR_STATES[state.toUpperCase()] ?? [];
}

/** Radar shows the extra options when a state search finds this many bids or fewer. */
export const RADAR_MORE_THRESHOLD = 3;

export function wantsRadarMore(matches: number, state: string | null | undefined): boolean {
  return Boolean(state) && matches <= RADAR_MORE_THRESHOLD;
}

// Free-text trade → the trades we hold federal rebid data for (MAX_RECOMPETE_TRADES).
const RECOMPETE_KEYWORDS: [string, RegExp][] = [
  ["janitorial", /janitor|custodial|cleaning/],
  ["security-guard", /security guard|guard service|\bguards?\b|security officer/],
  ["trucking", /truck|freight|transport/],
  ["landscaping", /landscap|lawn|mowing|grounds|tree/],
  ["waste-hauling", /waste|trash|refuse|garbage|recycl|dumpster/],
  ["hvac", /hvac|heating|air condition|mechanical/],
  ["electrical", /electric/],
  ["cybersecurity", /cyber/],
  ["it-services", /\bit\b|software|computer|tech support|network/],
  ["construction", /construct|contractor|roof|paving|concrete|renovat|carpent|plumb|paint|build/],
];

export function recompeteTradeFor(trade: string): string | null {
  const t = trade.toLowerCase();
  for (const [slug, re] of RECOMPETE_KEYWORDS) if (re.test(t)) return slug;
  return null;
}
