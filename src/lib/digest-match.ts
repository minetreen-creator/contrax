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
 *   - TRADE: a bid with a NAICS code fits when it is one of the profile's
 *     codes (when the profile has codes); otherwise its title/description/
 *     category must hit the trade expansion (trade-registry
 *     `expandTrade`, the same synonyms Radar uses) of the profile's typed trade
 *     words or of the curated trade entries those NAICS codes belong to. No
 *     trade information means no trade filter.
 *   - A profile with neither is NOT personal: that member keeps the full list
 *     (as before) and the email suggests setting a trade and states.
 *
 * PURE (no DB, no server imports); unit-tested in digest-match.test.ts.
 */
import { bidInStates, profileNaicsCodes, profileStateCodes, profileTradeExpansions } from "./profile-match";
import { resolveStateFromText } from "./location-state";
import { shouldApplyStateFilter } from "./open-bids";
import { tradeTextIncludes, type TradeExpansion } from "./trade-registry";

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


export function buildDigestMatcher(profile: DigestProfile | null | undefined): DigestMatcher {
  const states = profileStateCodes(profile?.locations);
  const stateFilter = shouldApplyStateFilter(states);
  const naicsCodes = profileNaicsCodes(profile);
  const expansions = profileTradeExpansions(profile);
  const tradeFilter = naicsCodes.length > 0 || expansions.length > 0;

  const tradeLabel = expansions[0]?.original ?? (naicsCodes.length ? `NAICS ${naicsCodes.slice(0, 2).join(", ")}` : "");
  const label = [tradeLabel, stateFilter ? `in ${states.slice(0, 4).join(", ")}${states.length > 4 ? "…" : ""}` : ""]
    .filter(Boolean)
    .join(" ");

  return {
    personal: stateFilter || tradeFilter,
    states,
    naicsCodes,
    expansions,
    label,
    matches(bid) {
      // NO-STATE GUARD (owner 2026-10-19, nightly SAM.gov CSV ingest spec
      // §Owner's rules 1/§Emails — "a bid with no place-of-performance state may
      // ONLY match a saved search via trade/NAICS … never by default / swept in
      // by a blank-state clause").
      //
      // The nightly ingest stores ~12,000 future-deadline federal notices, 69% of
      // which (8,439 of 12,232 on SAM's 2026-10-17 extract) publish NO
      // place-of-performance state. Such a row has no geography to match on, so
      // geography must never be the reason it lands in someone's email:
      //   • no state published  → the STATE dimension is refused outright (it is
      //     not admitted by a blank location, and not by a state read off the
      //     buyer/agency string either — an office is not a work site);
      //   • a state published   → the existing test, unchanged.
      // A no-state bid still reaches the members whose TRADE it matches (the
      // allowed route), and a member who selected states but no trade gets no
      // no-state bids at all.
      const hasPlaceState = !!resolveStateFromText(bid.location);
      if (stateFilter) {
        if (!hasPlaceState) {
          if (!tradeFilter) return false;
        } else if (!bidInStates(bid.location, bid.agency, states)) {
          return false;
        }
      }
      if (!tradeFilter) return true;
      const code = String(bid.naics_code ?? "").trim();
      // A bid with a NAICS code is held to the profile's codes when it has
      // some (same rule as the dashboard feed, profile-match.ts).
      if (code && naicsCodes.length > 0) return naicsCodes.includes(code);
      const text = `${bid.title ?? ""} ${bid.description ?? ""} ${bid.category ?? ""}`;
      return expansions.some((e) => tradeTextIncludes(text, e));
    },
  };
}
