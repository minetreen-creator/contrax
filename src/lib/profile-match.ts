/**
 * Does a bid fit a business profile's STATES and TRADE? Shared by the
 * dashboard feed (+ its archive count), the trial-start card, the onboarding
 * "We found N" count, and the paying members' personal email (digest-match.ts).
 *
 * WHY (owner 2026-10-01): state portal bids (TX, FL, CA, PA, NY, …) were
 * invisible in logged-in feeds for two reasons:
 *   1. TRADE: the feed matched `naics_code = ANY(profile codes)`, and state
 *      portals publish no NAICS code, so a NAICS-onboarded profile never saw a
 *      single state bid;
 *   2. STATES: the feed's geography test only recognised "City, ST"
 *      locations, so "Ohio" or "Hamilton County, Ohio" never matched OH.
 *
 * The fix keeps every bid the old rules matched and adds:
 *   - TRADE (`profileTradePred`): a bid WITH a NAICS code still has to match
 *     one of the profile's codes (unchanged). A bid WITHOUT one matches when
 *     its title/description/category contains the profile's trade words: the
 *     typed trade (`industry`, `service_categories`) and the curated trade
 *     entries the profile's NAICS codes belong to (561720 → janitorial,
 *     custodial, …). A profile without NAICS codes keeps no trade filter here,
 *     as before.
 *   - STATES (`bidInStates`): the old "City, ST" rule OR the full state
 *     resolver (resolveBidState), which reads state names too.
 *   - CERTIFICATIONS (`profileSetAsidePred`, owner 2026-10-01 "yes"): a
 *     certified profile (SDVOSB, 8(a), WOSB, HUBZone, VOSB) still sees its
 *     matching federal set-asides, AND now also state/local portal bids that
 *     publish no set-aside — open to every business, so a certified one can
 *     bid. Only sources registered as state or local count (an unknown or
 *     federal source with no set-aside stays excluded, as before).
 */
import { resolveBidState, STATE_NAME_TO_CODE } from "./location-state";
import { locationMatchesStates, setAsideLikeClauses, shouldApplyStateFilter } from "./open-bids";
import { isStateLocalLabel, SOURCE_CLASSES } from "./source-class";
import { US_STATES } from "./states";
import { expandTrade, TRADE_ALIASES, type TradeExpansion } from "./trade-registry";

export interface MatchProfile {
  locations?: readonly string[] | null;
  naics_codes?: readonly (string | number)[] | null;
  industry?: string | null;
  service_categories?: readonly string[] | null;
}

/** Most trade terms put in one SQL predicate (each adds three LIKEs). */
export const MAX_PROFILE_TRADE_TERMS = 24;

/** The profile's states as USPS codes ("OH", "Ohio" → "OH"), de-duplicated. */
export function profileStateCodes(locations: readonly string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const raw of locations ?? []) {
    const t = String(raw ?? "").trim();
    const code = /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : STATE_NAME_TO_CODE[t.toLowerCase()];
    if (code && (US_STATES as readonly string[]).includes(code)) out.add(code);
  }
  return [...out];
}

/** Is the bid in one of the states? No states / every state = no filter. */
export function bidInStates(
  location: string | null | undefined,
  agency: string | null | undefined,
  states: readonly string[],
): boolean {
  const codes = profileStateCodes(states);
  if (!shouldApplyStateFilter(codes)) return true;
  if (locationMatchesStates(location, codes)) return true;
  const code = resolveBidState(location ?? null, agency ?? null);
  return !!code && codes.includes(code);
}

/** The profile's valid 6-digit NAICS codes. */
export function profileNaicsCodes(profile: MatchProfile | null | undefined): string[] {
  return [...new Set((profile?.naics_codes ?? []).map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c)))];
}

/** Trade expansions from the profile's typed trade words and its NAICS codes' curated trades. */
export function profileTradeExpansions(profile: MatchProfile | null | undefined): TradeExpansion[] {
  const codes = profileNaicsCodes(profile);
  const words = [profile?.industry ?? "", ...(profile?.service_categories ?? [])]
    .map((w) => String(w ?? "").trim())
    .filter((w) => w.length >= 3 && !/^\d{6}$/.test(w));
  for (const entry of Object.values(TRADE_ALIASES)) {
    if (entry.naics.some((code) => codes.includes(code)) && entry.synonyms[0]) words.push(entry.synonyms[0]);
  }
  return [...new Set(words.map((w) => w.toLowerCase()))]
    .map((w) => expandTrade(w))
    .filter((e) => !e.isNaics && e.terms.length > 0);
}

/** The de-duplicated keyword terms of the expansions, capped. */
export function profileTradeTerms(expansions: readonly TradeExpansion[]): string[] {
  const terms = new Set<string>();
  for (const e of expansions) for (const t of e.terms) if (t.length >= 3) terms.add(t);
  return [...terms].slice(0, MAX_PROFILE_TRADE_TERMS);
}

/**
 * SQL trade predicate for a profile (an `AND (...)` fragment, or empty):
 * `naics_code = ANY(codes)` OR (no NAICS code, NULL or '', AND the text has a trade term).
 * Empty when the profile has no NAICS codes (no trade filter, as before).
 * `sql` is the ~/db factory; values are bound parameters (injection-safe).
 */
export function profileTradePred(profile: MatchProfile | null | undefined, sql: any): any {
  const s = typeof sql?.unsafe === "function" ? sql : sql();
  const codes = profileNaicsCodes(profile);
  if (codes.length === 0) return s``;
  const terms = profileTradeTerms(profileTradeExpansions(profile));
  if (terms.length === 0) return s`AND naics_code = ANY(${codes})`;
  let text: any = null;
  for (const term of terms) {
    const like = `%${term}%`;
    const clause = s`(LOWER(COALESCE(title,'')) LIKE ${like} OR LOWER(COALESCE(description,'')) LIKE ${like} OR LOWER(COALESCE(category,'')) LIKE ${like})`;
    text = text ? s`${text} OR ${clause}` : clause;
  }
  return s`AND (naics_code = ANY(${codes}) OR (COALESCE(naics_code,'') = '' AND (${text})))`;
}

/** Every source label registered as a state portal or a city board. */
export const STATE_LOCAL_SOURCE_LABELS: readonly string[] = Object.keys(SOURCE_CLASSES).filter((l) => isStateLocalLabel(l));

/**
 * SQL set-aside predicate for a profile's certifications (an `AND (...)`
 * fragment, or empty when no cert maps to a set-aside): a matching federal
 * set-aside, OR a state/local bid with no set-aside at all. Labels and
 * patterns are hardcoded constants (never user input), so inlining is safe.
 */
export function profileSetAsidePred(certs: readonly string[] | null | undefined, sql: any): any {
  const s = typeof sql?.unsafe === "function" ? sql : sql();
  const clauses = setAsideLikeClauses(certs ?? []);
  if (clauses.length === 0) return s``;
  const labels = STATE_LOCAL_SOURCE_LABELS.map((l) => `'${l.replace(/'/g, "")}'`).join(", ");
  const open = labels
    ? ` OR (COALESCE(set_aside,'') = '' AND LOWER(BTRIM(COALESCE(source,''))) IN (${labels}))`
    : "";
  return s`AND (${s.unsafe(`(${clauses.join(" OR ")})${open}`)})`;
}

/**
 * FREE PLAN SCOPE (owner 2026-10-02, Starter value #3): a free account's
 * feed follows ONE state and ONE trade; Starter and up follow every state and
 * trade in the profile. The profile itself is never trimmed (no data is
 * lost, and upgrading takes effect on the next load): only the copy used for
 * matching is narrowed, to the FIRST state and the FIRST trade the member
 * listed. A profile with no states stays nationwide (nothing was chosen).
 *
 * "Trades" are the profile's NAICS codes; for a profile without codes, its
 * typed service categories.
 */
export const FREE_PLAN_STATE_LIMIT = 1;
export const FREE_PLAN_TRADE_LIMIT = 1;

export interface FreePlanScope {
  /** True when the free scope removed states or trades from matching. */
  limited: boolean;
  totalStates: number;
  totalTrades: number;
  followedStates: string[];
  followedTrades: string[];
}

export function scopeProfileToPlan<T extends MatchProfile>(
  profile: T | null,
  paid: boolean,
): { profile: T | null; scope: FreePlanScope | null } {
  if (!profile || paid) return { profile, scope: null };
  const states = profileStateCodes(profile.locations);
  const codes = profileNaicsCodes(profile);
  const services = (profile.service_categories ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  const trades = codes.length > 0 ? codes : services;
  const followedStates = states.slice(0, FREE_PLAN_STATE_LIMIT);
  const followedTrades = trades.slice(0, FREE_PLAN_TRADE_LIMIT);
  const limited = states.length > followedStates.length || trades.length > followedTrades.length;
  const scoped: T = {
    ...profile,
    locations: states.length > FREE_PLAN_STATE_LIMIT ? followedStates : profile.locations,
    naics_codes: codes.length > 0 ? codes.slice(0, FREE_PLAN_TRADE_LIMIT) : profile.naics_codes,
    service_categories: codes.length === 0 ? services.slice(0, FREE_PLAN_TRADE_LIMIT) : profile.service_categories,
  };
  return {
    profile: scoped,
    scope: { limited, totalStates: states.length, totalTrades: trades.length, followedStates, followedTrades },
  };
}

/**
 * The dashboard line for a limited free scope, e.g. "Basic matches 1 state
 * and 1 trade (OH, Janitorial Services). Starter matches all 3 of your states
 * and all 2 of your trades." `tradeLabel` turns a NAICS code into its name.
 */
export function freePlanScopeMessage(scope: FreePlanScope, tradeLabel: (trade: string) => string = (t) => t): string {
  const followed = [scope.followedStates[0], scope.followedTrades[0] ? tradeLabel(scope.followedTrades[0]) : ""].filter(Boolean);
  const more: string[] = [];
  if (scope.totalStates > FREE_PLAN_STATE_LIMIT) more.push(`all ${scope.totalStates} of your states`);
  if (scope.totalTrades > FREE_PLAN_TRADE_LIMIT) more.push(`all ${scope.totalTrades} of your trades`);
  return (
    `Basic matches 1 state and 1 trade${followed.length ? ` (${followed.join(", ")})` : ""}.` +
    (more.length ? ` Starter matches ${more.join(" and ")}.` : "")
  );
}

