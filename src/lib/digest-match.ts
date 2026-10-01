/**
 * PERSONAL DAILY EMAIL (owner 2026-10-01, option 2): a paying member's 6 AM
 * email lists only the new bids that fit THEIR business — their states and
 * their trade — instead of every new bid in the country.
 *
 * The profile is the one onboarding and settings already collect
 * (business_profiles): `locations` (state codes), `naics_codes`, and the free-
 * text `industry` / `service_categories` (onboarding stores the typed trade in
 * `industry` when no NAICS code was picked).
 *
 *   - STATES: a bid fits when its resolved state (resolveBidState — the full
 *     resolver, so "Hamilton County, Ohio" and "Ohio" both count, not only
 *     "City, OH") is one of the profile's states. No states, or all 50, means
 *     no state filter.
 *   - TRADE: a bid fits when its NAICS code is one of the profile's codes, OR
 *     its title/description/category hits the trade expansion (trade-registry
 *     `expandTrade`, the same synonyms Radar uses) of the profile's typed trade
 *     words or of the curated trade entries those NAICS codes belong to. No
 *     trade information means no trade filter.
 *   - A profile with neither is NOT personal: that member keeps the full list
 *     (as before) and the email suggests setting a trade and states.
 *
 * PURE (no DB, no server imports); unit-tested in digest-match.test.ts.
 */
import { resolveBidState, STATE_NAME_TO_CODE } from "./location-state";
import { expandTrade, TRADE_ALIASES, tradeTextIncludes, type TradeExpansion } from "./trade-registry";

export interface DigestProfile {
  locations?: readonly string[] | null;
  naics_codes?: readonly (string | number)[] | null;
  industry?: string | null;
  service_categories?: readonly string[] | null;
}

export interface DigestBidFields {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  location?: string | null;
  agency?: string | null;
  naics_code?: string | null;
}

export interface DigestMatcher {
  /** True when the profile narrows the email (any state or trade filter). */
  personal: boolean;
  states: string[];
  naicsCodes: string[];
  expansions: TradeExpansion[];
  /** "janitorial in VA, MD" — for the email's header line; "" when not personal. */
  label: string;
  matches(bid: DigestBidFields): boolean;
}

const ALL_STATES = 50;

function stateCode(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAME_TO_CODE[t.toLowerCase()] ?? null;
}

export function buildDigestMatcher(profile: DigestProfile | null | undefined): DigestMatcher {
  const states = [...new Set((profile?.locations ?? []).map(stateCode).filter((c): c is string => !!c))];
  const stateFilter = states.length > 0 && states.length < ALL_STATES ? new Set(states) : null;

  const naicsCodes = [...new Set((profile?.naics_codes ?? []).map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c)))];
  const words = [profile?.industry ?? "", ...(profile?.service_categories ?? [])]
    .map((w) => String(w ?? "").trim())
    .filter((w) => w.length >= 3 && !/^\d{6}$/.test(w));
  // Trade words from the curated entries the profile's NAICS codes belong to
  // (e.g. 561720 → "janitorial"), so state bids — which carry no NAICS code —
  // still match a NAICS-only profile by their text.
  for (const entry of Object.values(TRADE_ALIASES)) {
    if (entry.naics.some((code) => naicsCodes.includes(code)) && entry.synonyms[0]) words.push(entry.synonyms[0]);
  }
  const expansions = [...new Set(words.map((w) => w.toLowerCase()))]
    .map((w) => expandTrade(w))
    .filter((e) => !e.isNaics && e.terms.length > 0);
  const tradeFilter = naicsCodes.length > 0 || expansions.length > 0;

  const tradeLabel = expansions[0]?.original ?? (naicsCodes.length ? `NAICS ${naicsCodes.slice(0, 2).join(", ")}` : "");
  const label = [tradeLabel, stateFilter ? `in ${states.slice(0, 4).join(", ")}${states.length > 4 ? "…" : ""}` : ""]
    .filter(Boolean)
    .join(" ");

  return {
    personal: !!stateFilter || tradeFilter,
    states,
    naicsCodes,
    expansions,
    label,
    matches(bid) {
      if (stateFilter) {
        const code = resolveBidState(bid.location ?? null, bid.agency ?? null);
        if (!code || !stateFilter.has(code)) return false;
      }
      if (tradeFilter) {
        if (bid.naics_code && naicsCodes.includes(String(bid.naics_code))) return true;
        const text = `${bid.title ?? ""} ${bid.description ?? ""} ${bid.category ?? ""}`;
        return expansions.some((e) => tradeTextIncludes(text, e));
      }
      return true;
    },
  };
}
