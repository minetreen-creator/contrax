/**
 * Location/state normalization for the Radar matcher (owner 2026-09-13, radar
 * zero-results directive). PURE module — no DB, no server fns, no process.env.
 *
 * Today `bids.location` is free text that conflates THREE concepts the owner
 * separated in the v3 directive (PR-B adds the `source_jurisdiction` /
 * `raw_location` / `normalized_state` columns; PR-A implements the EQUIVALENT
 * derivation rules here so the matcher works today, computed from EXISTING
 * fields only (location + agency + title/description). The stored PR-B columns
 * are NOT read by PR-A (owner v4: no cross-PR column dependencies, no runtime
 * schema detection); the follow-up PR switches to them after B ships).
 *
 * Rules (documented + reproducible — used by the matcher AND by the nationwide
 * audit so both count the same rows):
 *
 *  1. normalizeStateInput(input) — accept a 2-letter USPS code ("VA", "pa") or
 *     a full state name ("Virginia", "west virginia") and return the canonical
 *     USPS code; anything else → "" (fail-open, same as today's empty state).
 *
 *  2. resolveStateFromText(text) — scan a free-text string (location, agency,
 *     title, description) for the FIRST state mention: full names are matched
 *     before codes ("West Virginia" wins over "Virginia", "New Hampshire" wins
 *     over "NH"), codes match as standalone tokens only ("VA Medical Center"
 *     does NOT resolve to VA because the code must be set off by the string
 *     start, a comma, whitespace or a slash). Returns the code or null when no
 *     state is mentioned.
 *
 *  3. Location/agency precedence (owner acceptance #6): resolve the bid's
 *     geography from the PERFORMANCE location first (place of performance);
 *     when the location carries NO state mention, fall back to the BUYER/AGENCY
 *     field before treating the row as nationwide. A row with no resolvable
 *     state anywhere stays "nationwide/unknown" (kept for every state — the
 *     pre-existing semantics, never tightened).
 *
 *  4. Contradictory-location flagging (owner v3): a row is location-conflicted
 *     when its resolved location/agency state differs from a specific place
 *     signal in the title/description — a DIFFERENT state name/code, or a
 *     known major city in a different state (covers "USCG - JANITORIAL
 *     SERVICES - BASE NEW ORLEANS" with location "Virginia": the title's
 *     "NEW ORLEANS" is a specific LA place signal). Conflicted rows are
 *     FLAGGED (never silently trusted) and EXCLUDED from state inventory
 *     counts and state matching; raw values are preserved.
 *
 * The curated city map is intentionally small and only ever used to FLAG —
 * never to resolve a location TO a state (a city alone never proves the
 * location; a contradicting STATE NAME does, and a KNOWN other-state major
 * city raises the flag for audit).
 */

import { US_STATES } from "~/lib/states";

/** Full state name (case-insensitive at use) → USPS code. 50 states + DC. */
export const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

/** Full state names, longest-first so "West Virginia" beats "Virginia". */
export const STATE_FULL_NAMES: string[] = Object.keys(STATE_NAME_TO_CODE).sort(
  (a, b) => b.length - a.length,
);

/** Set of valid USPS codes (from the shared US_STATES constant). */
const STATE_CODES = new Set<string>(US_STATES);

/**
 * Normalize a user-entered state to a 2-letter USPS code. Accepts the code
 * itself ("VA", "pa") or a full state name ("Virginia", "west virginia").
 * Anything unrecognized → "" (fail-open; absent state keeps today's behavior).
 */
export function normalizeStateInput(input: string | null | undefined): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  const full = STATE_NAME_TO_CODE[raw.toLowerCase()];
  return full ?? "";
}

/**
 * Resolve the FIRST state mention in a free-text string. Full names are tried
 * before codes; a 2-letter code only counts as a standalone token (start of
 * string, or preceded by ",", " ", "/", "(", and followed by end/space/comma/
 * ")" /"."). Returns the USPS code or null.
 */
export function resolveStateFromText(text: string | null | undefined): string | null {
  const t = String(text ?? "");
  if (!t) return null;
  const lowered = t.toLowerCase();
  // Full names first (exact substring, case-insensitive).
  for (const name of STATE_FULL_NAMES) {
    const idx = lowered.indexOf(name);
    if (idx >= 0) return STATE_NAME_TO_CODE[name];
  }
  // Standalone code tokens.
  const re = /(?:^|[\s,/()])([A-Za-z]{2})(?=$|[\s,.)/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const code = m[1].toUpperCase();
    if (STATE_CODES.has(code)) return code;
  }
  return null;
}

/** USPS code → full state name (display + audit). */
export const STATE_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, nameToTitle(name)]),
);

function nameToTitle(name: string): string {
  return name
    .split(" ")
    .map((w) => (w === "of" ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Resolve a bid's geography: location first, then the buyer/agency field,
 * then null (nationwide/unknown). Returns the USPS code or null.
 */
export function resolveBidState(
  location: string | null | undefined,
  agency: string | null | undefined,
): string | null {
  // Resolve the bid's geography from the PERFORMANCE location first; when the
  // location carries NO state mention, fall back to the BUYER/AGENCY field
  // before treating the row as nationwide/unknown (owner acceptance #6).
  // PR-A computes this purely from EXISTING fields (location + agency) — the
  // later normalized_state column (PR-B) is intentionally NOT read here.
  const fromLocation = resolveStateFromText(location);
  if (fromLocation) return fromLocation;
  return resolveStateFromText(agency);
}

/** A row is geo-relevant to the selected state when it IS that state or
 * nationwide/unknown (no resolvable geography). Buyer/agency fallback applies
 * when the performance location carries no state. */
export function geoRelevant(
  location: string | null | undefined,
  agency: string | null | undefined,
  stateCode: string,
): boolean {
  if (!stateCode) return true;
  const bidState = resolveBidState(location, agency);
  if (!bidState) return true; // nationwide/unknown → kept (pre-existing semantics)
  return bidState === stateCode;
}

/**
 * Curated major-city → USPS code map used ONLY for contradiction flagging: a
 * title/description that names a known city in a DIFFERENT state than the
 * row's resolved geography raises the conflict flag. Cities that exactly match
 * the resolved state are NOT conflicts (e.g. "Norfolk, VA" titles on VA rows).
 */
export const KNOWN_CITY_STATE: Record<string, string> = {
  "new orleans": "LA",
  baltimore: "MD",
  detroit: "MI",
  denver: "CO",
  philadelphia: "PA",
  pittsburgh: "PA",
  seattle: "WA",
  miami: "FL",
  chicago: "IL",
  boston: "MA",
  atlanta: "GA",
  phoenix: "AZ",
  dallas: "TX",
  houston: "TX",
  austin: "TX",
  "san antonio": "TX",
  "san francisco": "CA",
  "san diego": "CA",
  "los angeles": "CA",
  sacramento: "CA",
  portland: "OR",
  cleveland: "OH",
  cincinnati: "OH",
  columbus: "OH",
  "kansas city": "MO",
  "st. louis": "MO",
  milwaukee: "WI",
  memphis: "TN",
  nashville: "TN",
  indianapolis: "IN",
  charlotte: "NC",
  tampa: "FL",
  orlando: "FL",
  minneapolis: "MN",
  "salt lake city": "UT",
  "las vegas": "NV",
  newark: "NJ",
  buffalo: "NY",
  trenton: "NJ",
  harrisburg: "PA",
  allentown: "PA",
  reading: "PA",
  erie: "PA",
  scranton: "PA",
  "wilkes-barre": "PA",
};

/**
 * Contradictory-location flag (owner v3). Returns true when the row's own
 * title/description carries a specific place signal — a state name/code, or a
 * known out-of-state major city — that CONTRADICTS the resolved geography
 * (performance location, then agency). Flagged rows are excluded from state
 * inventory counts and state matching by callers; raw values stay visible.
 *
 * A title that names ONLY the same state (or cities in the same state) is not
 * a conflict; a title with NO place signal is not a conflict.
 */
export function locationConflict(
  title: string | null | undefined,
  description: string | null | undefined,
  resolvedState: string | null,
): boolean {
  if (!resolvedState) return false; // no geography → nothing to contradict
  const text = `${String(title ?? "")} ${String(description ?? "")}`.toLowerCase();
  if (!text.trim()) return false;

  // 1) A DIFFERENT state FULL NAME mentioned in the title/description
  //    ("Naval Submarine Base New London, Groton, Connecticut" on a
  //    Virginia-stamped row). Full-name tokens are unambiguous place signals.
  for (const name of STATE_FULL_NAMES) {
    if (text.includes(name)) {
      const code = STATE_NAME_TO_CODE[name];
      if (code !== resolvedState) return true;
    }
  }
  // 2) A "CITY, XX" style code token in a DIFFERENT state. Codes are counted
  //    ONLY in the comma-preceded form ("VIRGINIA BEACH, VA"): a bare "VA" in
  //    "VA Medical Center" is a department designator (Veterans Affairs), not
  //    a Virginia place signal — never flag on it.
  const codeRe = /(?:,\s*)([A-Za-z]{2})(?=$|[\s,.)/])/g;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
    const code = m[1].toUpperCase();
    if (STATE_CODES.has(code) && code !== resolvedState) return true;
  }

  // 2) A known major city in a DIFFERENT state (covers "BASE NEW ORLEANS",
  //    "USS NEW ORLEANS" titled rows stamped with a generic state location).
  //    Word-boundary-containment is checked to avoid "Orlando" inside another
  //    word; the city must appear as a whole phrase.
  for (const [city, cityState] of Object.entries(KNOWN_CITY_STATE)) {
    if (cityState === resolvedState) continue;
    const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z])${esc}(?:$|[^a-z])`);
    if (re.test(text)) return true;
  }
  return false;
}

// ── v6.2: PLACE-OF-PERFORMANCE DISPLAY ──────────────────────────────────────
// Owner v6.2: every radar card must show the REAL place of performance — never
// "nationwide" as a location ("Anderson AFB → Guam"; NNSY "Charleston to VA" →
// its route). "nationalwide" is rendered as a separate ELIGIBILITY tag, and
// state-local cards show their verified state. PURE + display-only: these
// helpers NEVER affect matching/bucketing (resolveBidState stays the authority
// there); they only turn existing fields into an honest human location label.

/**
 * Curated real places for well-known installations that routinely appear in bid
 * TITLES while the stored `location` stays the generic "United States"
 * placeholder. Display-only — curated constants, never user input.
 */
const BASE_PLACE_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/anders(?:on|en)\s+afb/i, "Anderson AFB — Guam"],
  [/fort\s+hood/i, "Fort Hood — Texas"],
  [/norfolk\s+naval\s+shipyard|\bnnsy\b/i, "Norfolk Naval Shipyard — Portsmouth, VA"],
  [/dayton\s+va\s+medical\s+center/i, "Dayton VA Medical Center — Ohio"],
  [/virgin\s+islands/i, "U.S. Virgin Islands"],
  [/marianas/i, "Guam (Mariana Islands)"],
];

/** Placeholder location strings that carry no place-of-performance signal. */
const PLACEHOLDER_LOCATIONS = /^(united states|usa|us|u\.?s\.?|n\/a|multiple locations|various|various locations|tbd|to be determined|see solicitation|rc)$/i;

/**
 * Extract a "A to XX" route (e.g. "Charleston to VA") naming a real USPS
 * state/DC code — owner v6.2 NNSY case (a ship/tug movement is the actual
 * place of performance). Returns "Charleston to VA"-style or null.
 */
export function extractRouteFromText(
  text: string | null | undefined,
): string | null {
  const t = String(text ?? "");
  // A route is ONE capitalized place word + "to" + a real state code
  // ("Charleston to VA"). Single-word origin keeps the match from swallowing
  // whole sentence tails ("... Facilities Charleston to VA" → "Charleston to VA").
  const re = /\b([A-Z][A-Za-z.'-]+)\s+to\s+([A-Z]{2})(?=$|[\s,.)/])/g;
  let hit: { origin: string; code: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const code = m[2].toUpperCase();
    if (!STATE_CODES.has(code)) continue;
    const origin = m[1].trim();
    // Deny generic words that sentence-fill the pattern ("Services to VA" is
    // Veterans Affairs routing, not a place-of-performance route).
    if (/^(va|services|service|supplies|transport|transportation|delivery|support|equipment|vehicles)$/i.test(origin)) continue;
    hit = { origin, code }; // last candidate wins
  }
  return hit ? `${hit.origin} to ${hit.code}` : null;
}

/**
 * "City, XX" style place signal embedded in a title/location, where XX is a
 * real USPS code (e.g. "Janitorial Services, Wilmington DE" → "Wilmington, DE").
 * Display-only; never used for state matching.
 */
function extractCityState(
  text: string | null | undefined,
): string | null {
  const t = String(text ?? "");
  const bad = (city: string, code: string) =>
    !STATE_CODES.has(code) ||
    city.length < 2 ||
    /\d/.test(city) ||
    // "Services, VA" / "X VA Medical" are Veterans Affairs designators.
    /^(va|medical|services|facilities|center)$/i.test(city);
  // Space-form (dominant in procurement titles): "Janitorial Services,
  // Wilmington DE" = work scope, then "City CODE". The code must NOT be
  // followed by " medical" (a VA hospital, not a Virginia place).
  const spaceRe = /(?:^|[\s,])([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)\s+([A-Z]{2})(?!\s+medical)(?=$|[\s,.)/])/gi;
  let m: RegExpExecArray | null;
  while ((m = spaceRe.exec(t)) !== null) {
    const city = m[1].trim();
    const code = m[2].toUpperCase();
    if (!bad(city, code)) return `${city}, ${code}`;
  }
  // Comma-form: "Hardin County, OH" / "Norfolk, VA".
  const commaRe = /([A-Za-z][A-Za-z .'-]{1,40}?)\s*,\s*([A-Z]{2})(?=$|[\s,.)/])/gi;
  while ((m = commaRe.exec(t)) !== null) {
    const city = m[1].trim();
    const code = m[2].toUpperCase();
    if (!bad(city, code)) return `${city}, ${code}`;
  }
  return null;
}

/**
 * The card's place-of-performance line (owner v6.2). Resolution order:
 *  1. curated base signal in title/agency (Anderson AFB → Guam, NNSY → base);
 *     the NNSY route ("Charleston to VA") wins over the generic base label so
 *     the ACTUAL route is what the card shows (never an implied PA relevance).
 *  2. "A to XX" route naming a real state code (NNSY — Charleston to VA).
 *  3. "City, XX" place signal in title or location (Wilmington, DE).
 *  4. resolved geography (performance location, then agency) → state display name.
 *  5. non-placeholder stored location / agency text.
 *  6. null — caller renders the eligibility tag only ("place not specified").
 */
export function displayPlaceOfPerformance(
  title: string | null | undefined,
  location: string | null | undefined,
  agency: string | null | undefined,
): string | null {
  const titleText = String(title ?? "");
  const titleLower = titleText.toLowerCase();
  const agencyText = String(agency ?? "");
  const locationText = String(location ?? "").trim();

  // 1) NNSY: the ROUTE is the real place of performance when the solicitation
  //    names one ("NNSY - Transport 20 ... Charleston to VA"). The base label
  //    is the fallback when no route appears in the title/agency.
  const nnsyHit =
    /norfolk naval shipyard|\bnnsy\b/i.test(`${titleLower} ${agencyText.toLowerCase()}`);
  const route = extractRouteFromText(titleText) ?? extractRouteFromText(agencyText);
  if (nnsyHit) {
    return route
      ? `${route} — Norfolk Naval Shipyard (NNSY)`
      : "Norfolk Naval Shipyard — Portsmouth, VA";
  }
  // 1b) Other curated base signals.
  for (const [re, label] of BASE_PLACE_SIGNALS) {
    if (re.test(`${titleText} ${agencyText}`)) return label;
  }
  // 2) Route extraction (non-NNSY rows with a real "A to XX" route).
  if (route) return route;
  // 3) City, XX place signal.
  const cityState = extractCityState(titleText) ?? extractCityState(locationText);
  if (cityState) return cityState;
  // 4) Resolved geography → display state name.
  const resolved = resolveBidState(locationText, agencyText);
  if (resolved) return STATE_CODE_TO_NAME[resolved] ?? resolved;
  // 5) Meaningful stored location text only — the BUYER/agency is never shown
  //    as a place of performance (the card already prints the agency line; the
  //    curated signals above catch the agency-stamped bases like NNSY).
  if (locationText && !PLACEHOLDER_LOCATIONS.test(locationText)) return locationText;
  return null;
}
