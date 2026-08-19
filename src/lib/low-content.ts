/**
 * Shared "low-content solicitation" filter (owner-directed, PR #xxx).
 *
 * A solicitation is LOW-CONTENT — and must be DROPPED from every public
 * listing/display surface — when ALL THREE of these hold at once:
 *   1. title has < 5 words (word count = split on whitespace), AND
 *   2. it has NO real location (NULL/empty, OR a known placeholder value
 *      like 'unknown', 'united states', 'n/a', ...), AND
 *   3. it has no set-aside (NULL/empty).
 *
 * This is an AND-combination: if a title has >=5 words OR a real location OR
 * a set-aside, it is NOT low-content and stays.
 *
 * Bare one-line listings (title="Tubas", agency="W6QM MICC-FT DRUM",
 * location="Unknown", set_aside=null) look like data errors to sophisticated
 * GovCon users and undermine feed credibility, so we exclude them from
 * listings. Id-based retrieval (WHERE id = ... / saved + followed rows) must
 * NOT apply this filter — a user's saved low-content solicit must still
 * resolve.
 *
 * Both the SQL fragment (`LOW_CONTENT_SQL`) and the TypeScript predicate
 * (`isLowContent`) live here so every listing surface stays byte-identical.
 */

/** Location values that mean "no real location" (case-insensitive). */
export const LOW_CONTENT_LOCATION_PLACEHOLDERS = [
  "unknown",
  "not specified",
  "n/a",
  "tbd",
  "none",
  "united states",
  "us",
  "usa",
];

/**
 * Raw SQL predicate that evaluates TRUE for rows we KEEP (i.e. NOT low-content).
 * Interpolate inside a tagged neon template with:
 *   ${sql().unsafe(LOW_CONTENT_SQL)}
 * The fragment references bare column names (title/location/set_aside) so it
 * works in any query whose only table carrying those columns is `bids` — with
 * or without a table alias, and even when `bids` is JOINed to a table that
 * lacks those columns (unqualified refs resolve to the sole matching table).
 */
export const LOW_CONTENT_SQL = `
  NOT (
    cardinality(string_to_array(btrim(title), ' ')) < 5
    AND (
      location IS NULL
      OR btrim(location) = ''
      OR lower(btrim(location)) IN ('unknown','not specified','n/a','tbd','none','united states','us','usa')
    )
    AND (set_aside IS NULL OR btrim(set_aside) = '')
  )
`;

/**
 * Client-safe TypeScript mirror of LOW_CONTENT_SQL, used for the homepage
 * OpenOpportunities merged feed (which combines two SQL sources). Pure
 * function — safe to import from client and server code. Returns true when a
 * solicitation is LOW-CONTENT and should be hidden.
 */
export function isLowContent(
  title: string | null | undefined,
  location: string | null | undefined,
  set_aside: string | null | undefined,
): boolean {
  const words = String(title ?? "").trim().split(/\s+/).filter(Boolean);
  const loc = String(location ?? "").trim().toLowerCase();
  const hasRealLocation =
    loc.length > 0 && !LOW_CONTENT_LOCATION_PLACEHOLDERS.includes(loc);
  const hasSetAside = String(set_aside ?? "").trim().length > 0;
  return words.length < 5 && !hasRealLocation && !hasSetAside;
}
