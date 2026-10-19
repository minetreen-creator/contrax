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
  const orClauses = setAsideLikeClauses(certs);
  if (orClauses.length === 0) return sql()``;
  return sql()`AND (${sql().unsafe(orClauses.join(" OR "))})`;
}

/**
 * The literal `set_aside LIKE` clauses the certifications map to (hardcoded
 * constants, injection-safe) — shared by setAsidePredMulti and
 * profile-match.ts profileSetAsidePred. Empty when no cert has a set-aside.
 */
export function setAsideLikeClauses(certs: readonly string[]): string[] {
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
  return orClauses;
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

// ─────────────────────────────────────────────────────────────────────────────
// The PUBLIC CONTRACT-MAP "open bid" definition (owner-approved 2026-10-19,
// Option ① of the federal-bids gap investigation — see
// /home/team/shared/federal-bids-gap-2026-10-17.md).
//
// BEFORE, every public open-opportunity counter and list used:
//
//   (due_date IS NULL OR due_date::date >= NOW()::date)
//
// which called a stored notice with NO deadline at all "open". On production
// that made 9,355 of 52,165 rows open purely for lacking a date — including 702
// federal award / justification notices — and produced a blended homepage
// 14,152 where only ~1,100 federal rows had a real future deadline.
//
// AFTER — "real deadlines only, no award notices". Three fragments, applied
// together by the contract-map family (the homepage money counter, /api/contract-map,
// /map, the state SEO pages, the signup social-proof line):
//
//   OPEN_BID_SQL                a REAL deadline, still ahead
//   AWARD_NOTICE_EXCLUSION_SQL  not an award / justification notice TYPE
//   AWARD_EXCLUSION_SQL         not one of the four award-only city feeds
//                               (src/lib/source-class.ts — unchanged, already
//                                applied by these surfaces before this change)
//   LOW_CONTENT_SQL             the existing title/location/set-aside guard
//
// Both halves of the owner's sentence are load-bearing:
//  - `OPEN_BID_SQL` is what removes the award / justification rows TODAY (SAM
//    gives an award notice no response date, so the NULL branch was the only
//    reason 702 of them counted as open);
//  - `AWARD_NOTICE_EXCLUSION_SQL` closes the leak rule 1 cannot see — an award /
//    justification notice that DOES carry a future date. Measured against
//    production 2026-10-19: zero such rows exist, so this fragment changes no
//    number today; it is here so the count cannot silently regress the moment
//    one appears.
//
// DELIBERATELY NOT EXCLUDED: `Collective Bargaining Agreement`,
// `Davis-Bacon Act` and `Service Contract Act` are informational SAM notices,
// not opportunities, but they are outside the owner's "no award notices"
// instruction and are already removed by rule 1 (measured 2026-10-19: 0 rows of
// each type carry a future due date). Flagged as an optional follow-up rather
// than silently widening the filter.
//
// SCOPE: this is for the PUBLIC surfaces that advertise one shared definition.
// It deliberately does NOT change `LIVE_SQL` in `~/lib/bid-status`, which
// answers a different question for a user's own saved feed ("is this match
// still actionable, given we may not have a deadline for it") — changing that
// would hide rows from dashboards, not correct a public claim.
//
// The raw fragments are interpolated with `sql().unsafe(...)`; their contents
// are hardcoded constants here, never user input, so this is injection-safe
// (same contract as LOW_CONTENT_SQL / AWARD_EXCLUSION_SQL).

/** TRUE for a row that has a real deadline still ahead of it. */
export const OPEN_BID_SQL = `(due_date IS NOT NULL AND due_date::date >= NOW()::date)`;

/**
 * The award / justification notice-type family, normalized exactly as the SQL
 * below compares it. Measured distinct `bids.notice_type` values on production
 * 2026-10-19 that belong to it: `Award Notice` (1,379 rows) and `Justification`
 * (302 rows); `award` is kept as a defensive spelling for a board that stores
 * the bare SAM code word.
 */
export const AWARD_NOTICE_TYPES: readonly string[] = [
  "award notice",
  "award",
  "justification",
  // Added 2026-10-19 with the nightly SAM.gov CSV ingest: SAM's daily extract
  // spells the same family "Justification and Approval (J&A)" (its own `Type`
  // column, alongside the bare "Justification" already stored). Measured against
  // production 2026-10-19: zero stored rows carry this spelling, so the addition
  // changes no number today — it closes the leak for the moment one is stored,
  // exactly like the fragment's original purpose. The CSV ingest additionally
  // refuses the whole "justification…" PREFIX (src/jobs/sam-csv.ts), so no other
  // spelling of it can be ingested either.
  "justification and approval (j&a)",
  "justification & approval (j&a)",
];

/**
 * TRUE for a row we KEEP — i.e. NOT an award / justification notice. A NULL
 * notice_type is KEPT: an unknown type is not evidence of an award, and rule 1
 * has already decided those rows on their deadline alone.
 */
export const AWARD_NOTICE_EXCLUSION_SQL = `(
  notice_type IS NULL
  OR LOWER(BTRIM(notice_type)) NOT IN (${AWARD_NOTICE_TYPES.map((t) => `'${t}'`).join(", ")})
)`;

/**
 * TRUE for a row that has NOT been closed out by the nightly SAM.gov CSV ingest
 * (owner-approved build 2026-10-19, spec shared/sam-csv-ingest-spec-2026-10-19.md
 * §Close-out / §Counter behavior 5).
 *
 * `closed_at` is added nullable by migration 064, so every pre-existing row is
 * NULL and this fragment is a no-op until the nightly job closes something — the
 * counter's numbers cannot move because of the column's existence.
 *
 * WHAT IT ADDS OVER OPEN_BID_SQL: a notice that left SAM's active extract while
 * its deadline is still ahead (cancelled / withdrawn / archived early) is stored
 * with a future `due_date`, so rule 1 alone would keep advertising it as open.
 * Measured 2026-10-19 (the day this fragment was added): zero rows exist, so the
 * fragment is a guard against a future leak, not a correction of a present count.
 *
 * SCOPE: applied by the same contract-map family that applies OPEN_BID_SQL
 * (homepage money counter, /api/contract-map, /map, /api/contract-map/bids, the
 * state SEO region page, the signup social-proof line). It deliberately does NOT
 * touch `LIVE_SQL` in ~/lib/bid-status (a user's own saved feed answers a
 * different question) and it does NOT touch Radar.
 */
export const CLOSED_EXCLUSION_SQL = `(closed_at IS NULL)`;

/**
 * Client-safe mirror of `AWARD_NOTICE_EXCLUSION_SQL` (same contract as
 * `isLowContent`), so a JS-side filter and the SQL can never drift.
 */
export function isAwardNoticeType(noticeType: string | null | undefined): boolean {
  if (noticeType == null) return false;
  return AWARD_NOTICE_TYPES.includes(String(noticeType).toLowerCase().trim());
}
