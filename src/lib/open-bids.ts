/**
 * Shared open-solicitation filtering primitives.
 *
 * Single source of truth for the predicates the site applies to OPEN
 * solicitations across surfaces. Keeping them here (rather than re-declared
 * per route) is what guarantees the onboarding "We found N opportunities"
 * count, the homepage Live Award Feed search, and every other listing surface
 * filter the SAME population — `due_date > NOW()`, the shared low-content
 * filter (LOW_CONTENT_SQL, imported by callers), and the same keyword
 * predicate. See also PR #185 (expired-bid exclusion) and #181/#183/#184
 * (homepage instant search).
 */

import { US_STATES } from "~/lib/states";

/**
 * The state-abbreviation location regex used to TARGET a bid's geography
 * ("City, ST"). Mirrors the /awards page's STATE_LOCATION_REGEX. Kept here
 * (not re-declared per route) so every surface that applies a geography
 * filter uses the identical rule.
 */
export const STATE_LOCATION_REGEX = new RegExp(
  `(?:^|,\\s*)(${US_STATES.join("|")})(?:$|\\s|,)`,
  "i",
);

/**
 * Decides whether to apply the strict 2-letter state (geography) filter at
 * all. SINGLE SOURCE OF TRUTH for the geography decision shared by the
 * onboarding match count AND any results feed.
 *
 * Returns FALSE → geography is a NO-OP (nationwide = every bid regardless of
 * location) when:
 *   - NO states are selected (`states.length === 0`), or
 *   - "Select all states" (the selection covers every state).
 * In both cases the location regex is NOT applied, so national /
 * unspecified-location bids (e.g. a bid whose location is just "United
 * States") are NOT dropped — fixing the under-counting of nationwide
 * opportunities.
 *
 * Returns TRUE only for a NON-EMPTY, PROPER subset of states (one or more
 * SPECIFIC states, but not every state) → apply the targeted 2-letter state
 * regex exactly as today.
 */
export function shouldApplyStateFilter(states: readonly string[]): boolean {
  if (!states || states.length === 0) return false;
  if (states.length === US_STATES.length) return false;
  return true;
}

/**
 * Whether a bid's location is included by the selected geography. Honors the
 * shared decision (shouldApplyStateFilter): when geography is a no-op
 * (nationwide) EVERY location matches; otherwise the bid must contain one of
 * the selected 2-letter state codes. Pure, client-safe.
 */
export function locationMatchesStates(
  location: string | null | undefined,
  states: readonly string[],
): boolean {
  if (!shouldApplyStateFilter(states)) return true;
  const m = (location || "").match(STATE_LOCATION_REGEX);
  return !!m && states.includes(m[1].toUpperCase());
}

/**
 * Full-corpus keyword predicate. Treats the query as a single case-insensitive
 * substring and matches rows where it appears across ANY of the meaningful
 * fields — title, description, location, set_aside, agency, naics_code. The
 * whole query is ONE bound parameter so the match is injection-safe. Returns an
 * EMPTY sql fragment when the query is blank so callers can interpolate
 * `$${pred}` unconditionally.
 *
 * `sql` here must be the neon FACTORY (the value returned by `~/db`'s `sql`),
 * so `sql()` yields the tagged template — the app-wide pattern.
 *
 * NOTE: each LIKE value is a plain `${...}` interpolation (neon → positional
 * $N). Do NOT write `$${...}`: the extra literal `$` makes Postgres parse it
 * as a dollar quote and throw `syntax error at or near "2"`.
 */
export function keywordPred(q: string, sql: any) {
  const phrase = q.trim().toLowerCase();
  if (!phrase) return sql()``;
  return sql()`AND (
    LOWER(COALESCE(title,'')) LIKE ${"%" + phrase + "%"} OR
    LOWER(COALESCE(description,'')) LIKE ${"%" + phrase + "%"} OR
    LOWER(COALESCE(location,'')) LIKE ${"%" + phrase + "%"} OR
    LOWER(COALESCE(set_aside,'')) LIKE ${"%" + phrase + "%"} OR
    LOWER(COALESCE(agency,'')) LIKE ${"%" + phrase + "%"} OR
    LOWER(COALESCE(naics_code,'')) LIKE ${"%" + phrase + "%"}
  )`;
}

/**
 * Set-aside predicate from a certification id. Maps the onboarding certification
 * choices to the literal set_aside values used in the bids table (verified
 * against prod: "8(a)", "8AN", "SDVOSB", "WOSB", "EDWOSB", "HUBZone", ...).
 * Unknown/no-set-aside choices (small business, minority-owned, disadvantaged)
 * return an empty fragment so we DON'T over-filter — the data has no tag for
 * those, and a federal set-aside is by definition reserved for small business.
 * Values are hardcoded constants (never user input), so embedding them into the
 * SQL string is injection-safe.
 */
export function setAsidePred(cert: string, sql: any) {
  const ASCII_CODE_TO_SET_ASIDE: Record<string, string[]> = {
    "8a": ["8(a)", "8AN"],
    sdvosb: ["SDVOSB"],
    wosb: ["WOSB", "EDWOSB"],
    hubzone: ["HUBZone"],
    vosb: ["VOSB"],
  };
  const pats = ASCII_CODE_TO_SET_ASIDE[cert];
  if (!pats || pats.length === 0) return sql()``;
  const orClauses = pats
    .map((p) => `LOWER(COALESCE(set_aside,'')) LIKE '%${p.toLowerCase()}%'`)
    .join(" OR ");
  return sql()`AND (${sql().unsafe(orClauses)})`;
}

/**
 * Set-aside predicate for MULTIPLE certifications (e.g. a business profile's
 * `certifications` array, which may hold several at once — an 8(a) firm can
 * also be SDVOSB/WOSB/HUBZone). OR-combines the literal set_aside patterns each
 * cert maps to, using the SAME hardcoded constants as `setAsidePred`. Values are
 * hardcoded constants (never user input), so embedding them in the SQL string is
 * injection-safe. Returns an EMPTY fragment when no cert yields a set-aside
 * pattern (small-business-only / no meaningful set-aside certs), so the filter
 * does NOT over-restrict — matching single-cert semantics.
 */
export function setAsidePredMulti(certs: string[], sql: any) {
  const ASCII_CODE_TO_SET_ASIDE: Record<string, string[]> = {
    "8a": ["8(a)", "8AN"],
    sdvosb: ["SDVOSB"],
    wosb: ["WOSB", "EDWOSB"],
    hubzone: ["HUBZone"],
    vosb: ["VOSB"],
  };
  const orClauses: string[] = [];
  for (const cert of certs ?? []) {
    const pats = ASCII_CODE_TO_SET_ASIDE[cert];
    if (!pats || pats.length === 0) continue;
    for (const p of pats) {
      orClauses.push(`LOWER(COALESCE(set_aside,'')) LIKE '%${p.toLowerCase()}%'`);
    }
  }
  if (orClauses.length === 0) return sql()``;
  return sql()`AND (${sql().unsafe(orClauses.join(" OR "))})`;
}

/**
 * NAICS-code predicate — the exact `naics_code = ANY(codes)` OR-match the
 * onboarding "We found N" count uses. A NULL / absent bid NAICS never matches
 * (NULL = unknown, NOT a match — the honest authoritative semantics), but ANY of
 * the profile's active codes can match. Returns an EMPTY fragment when no valid
 * 6-digit codes are supplied (no trade restriction).
 *
 * `codes` values are bound as parameters via the neon tagged template, so this
 * is injection-safe.
 */
export function naicsPred(codes: string[], sql: any) {
  const valid = (codes ?? [])
    .map((c) => String(c).trim())
    .filter((c) => /^\d{6}$/.test(c));
  if (valid.length === 0) return sql()``;
  return sql()`AND naics_code = ANY(${valid})`;
}
