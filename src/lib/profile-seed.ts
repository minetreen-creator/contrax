/**
 * Trade from search (owner 2026-11-04: "people aren't filling out their
 * trades"). New accounts skip onboarding's trade questions, so the 6 AM email
 * goes out with every bid in the country. But nearly everyone searched first:
 * the first $5 customer searched "Flooring · WA" and got an account with no
 * trade. When an account has NO business profile, it gets one from the
 * visitor's most recent real Radar search (trade + state). PURE part here; the
 * DB step is in ./profile-seed.server.
 */
import { NAICS_NAMES } from "./naics-names";
import { looksLikeAddress } from "./trade-input";

export interface SearchRow {
  trade: string | null;
  state: string | null;
  matched: number | null;
}

export interface SeededProfile {
  industry: string;
  naicsCodes: string[];
  locations: string[];
}

/** A typed trade we can trust as a trade (not an address, email or a stray word). */
function usableTrade(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 120) return null;
  if (t.includes("@") || looksLikeAddress(t)) return null;
  return t;
}

/** From newest-first searches: the latest one that found bids, else the latest usable one. */
export function profileFromSearches(searches: readonly SearchRow[]): SeededProfile | null {
  const usable = searches.filter((s) => usableTrade(s.trade));
  const pick = usable.find((s) => Number(s.matched) > 0) ?? usable[0];
  if (!pick) return null;
  const trade = usableTrade(pick.trade)!;
  const state = String(pick.state ?? "").trim().toUpperCase();
  const locations = /^[A-Z]{2}$/.test(state) ? [state] : [];
  if (/^\d{6}$/.test(trade)) {
    return { industry: NAICS_NAMES[trade] ?? trade, naicsCodes: [trade], locations };
  }
  const industry = trade.charAt(0).toUpperCase() + trade.slice(1);
  return { industry, naicsCodes: [], locations };
}

/**
 * Trade and state typed on the signup form (owner 2026-11-14: half of new
 * accounts still had no trade, because they never searched before signing up).
 * Same rules as a search: an address or email is never a trade, and a state
 * must be a two-letter code. Null when the trade is not usable.
 */
export function profileFromAnswer(trade: string | null | undefined, state: string | null | undefined): SeededProfile | null {
  return profileFromSearches([{ trade: trade ?? null, state: state ?? null, matched: null }]);
}
