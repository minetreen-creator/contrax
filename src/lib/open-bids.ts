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
