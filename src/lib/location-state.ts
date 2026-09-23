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
  // FOREIGN PLACE OF PERFORMANCE GUARD (owner order 2026-09-23): when the
  // performance location itself proves the work is abroad, the buyer/agency
  // text must NOT stamp a US state on the row ("Busan, South Korea" plus a
  // contracting office whose string happens to carry a "CO"/"PA" token). The
  // row keeps the honest no-US-state value (null). Never invents a state.
  if (isForeignPlaceField(location)) return null;
  return resolveStateFromText(agency);
}

/** A row is geo-relevant to the selected state when it IS that state or
 * nationwide/unknown (no resolvable geography). Buyer/agency fallback applies
 * when the performance location carries no state.
 *
 * AGENCY-JURISDICTION RULE first (owner-ratified 2026-09-23): a row whose BUYER
 * is on the curated list is that state's LOCAL row — relevance is decided by the
 * rule BEFORE the national-scope short-circuit, which is the entire point of the
 * narrow discriminator. It can only fire for an agency on the explicit list, so
 * every other "United States"-located federal row keeps today's semantics: kept
 * (as nationwide) for every state. */
export function geoRelevant(
  location: string | null | undefined,
  agency: string | null | undefined,
  stateCode: string,
): boolean {
  if (!stateCode) return true;
  const rule = agencyJurisdictionState(agency);
  if (rule) return rule.state === stateCode; // another state's LOCAL row → not relevant
  if (isNationalScope(location)) return true; // national-scope row → never state-local
  const bidState = resolveBidState(location, agency);
  if (!bidState) return true; // nationwide/unknown → kept (pre-existing semantics)
  return bidState === stateCode;
}

/** NATIONAL-SCOPE LOCATIONS (owner 09-14 local-accuracy PR). A bid whose own
 *  `location` declares national scope ("United States", "RC", "Multiple
 *  locations", …) is a NATIONWIDE contract: its work is not tied to a single
 *  state, so it must NEVER be counted as a state-local match and MUST NEVER
 *  borrow a state from the BUYER/AGENCY field (a "United States"-located DLA
 *  row is not a Pennsylvania bid just because the buyer's address says
 *  "Philadelphia, PA"). Exact-match only — "National City, CA" is untouched.
 *  Absent location ("") is NOT national scope: the pre-existing buyer/agency
 *  fallback stays (owner acceptance #6 breadth for state portals whose rows
 *  carry no location text). */
const NATIONAL_SCOPE_LOCATIONS =
  /^(united states|u\.?s\.?(a)?|usa|national|nationwide|all states|multiple locations|various|various locations|n\/a|na|tbd|to be determined|see solicitation|rc|unknown)$/i;

export function isNationalScope(location: string | null | undefined): boolean {
  const loc = String(location ?? "").trim();
  if (!loc) return false; // absent → keep the buyer/agency fallback (breadth fix)
  return NATIONAL_SCOPE_LOCATIONS.test(loc);
}
// ── FOREIGN PLACE OF PERFORMANCE GUARD (owner order 2026-09-23) ─────────────
// THE LEAK THIS CLOSES: the agency-name→US-state fallback (the second half of
// resolveBidState) is a TEXT heuristic — it reads a US state out of the buyer /
// contracting-office string when the performance location proves nothing. On a
// notice whose work is performed ABROAD that heuristic is simply wrong. Live row
// 139639 (sam_gov) — "Trash Removal and Disposal for Busan Area, USAG-Daegu"
// (Republic of Korea), placeholder location "United States", contracting office
// "0906 AQ CO     DET A CONTRACTI" — was stored with normalized_state = 'CO': a
// US state read off the bare "CO" token of the office string for a South-Korea
// trash contract (evidence: shared/nationwide-coverage-matrix-2026-09-23/
// after-2026-09-23/divergence.md + probe2-moved-cells.txt).
//
// RULE (owner 2026-09-23): when the notice's own place-of-performance evidence
// resolves OUTSIDE the United States, the agency-name→US-state fallback MUST
// NOT apply. The row keeps an honest "no US state" (NULL / unknown) — never a
// different invented state (standing hard rule) and never a guess.
//
// DIRECTION OF ERROR IS SAFE BY CONSTRUCTION: these signals only ever SUPPRESS a
// derived state; they can never create one. An over-eager signal costs a state
// stamp (the row keeps the pre-existing nationwide/unknown semantics for rows
// with no resolvable geography); a missed signal can only leave the leak this
// rule exists to close. The lists below are therefore narrow and evidence-shaped
// (country names, non-colliding country codes, well-known foreign places where
// US federal work is actually performed) — never a "looks foreign" guess.
//
// DELIBERATELY OMITTED (a bare name that is ALSO a US place/surname cannot be
// disambiguated by a pure text rule; including it would silently strip stamps
// from genuine domestic rows, and the cost of omission is only the leak):
// georgia (a US state), panama (Panama City, FL — a federal contracting hub),
// lebanon (Lebanon, PA/KY/OH — "Lebanon VA Medical Center"), cuba (Cuba, NM;
// the real case "Guantanamo Bay" is listed as a place instead), peru (Peru, IN),
// mali + chad + jordan (common personal names), malta (Malta, MT — a BLM field
// office town; two live MT rows titled "MALTA FO UTV" proved the collision),
// naples (Naples, FL), london, rota, moron (US-town/word collisions). "mexico"
// IS matched — with a lookbehind that keeps "New Mexico" domestic. A Georgia
// (country) or Panama notice still resolves through its city / country-code
// signals (e.g. "Tbilisi, GE").
const FOREIGN_COUNTRY_NAMES: readonly string[] = [
  "afghanistan", "albania", "algeria", "angola", "argentina", "armenia",
  "australia", "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh",
  "barbados", "belarus", "belgium", "belize", "benin", "bermuda", "bhutan",
  "bolivia", "bosnia", "botswana", "brazil", "brunei", "bulgaria",
  "burkina faso", "burundi", "cambodia", "cameroon", "canada", "cape verde",
  "central african republic", "chile", "china", "colombia", "comoros", "congo",
  "costa rica", "croatia", "cyprus", "czech republic", "czechia", "denmark",
  "djibouti", "dominican republic", "ecuador", "egypt", "el salvador",
  "equatorial guinea", "eritrea", "estonia", "eswatini", "ethiopia", "fiji",
  "finland", "france", "gabon", "gambia", "germany", "ghana", "greece",
  "greenland", "guatemala", "guinea", "guyana", "haiti", "honduras", "hungary",
  "iceland", "india", "indonesia", "iraq", "ireland", "israel", "italy",
  "ivory coast", "jamaica", "japan", "kazakhstan", "kenya", "kiribati",
  "kosovo", "korea", "kuwait", "kyrgyzstan", "laos", "latvia", "lesotho", "liberia",
  "libya", "lithuania", "luxembourg", "madagascar", "malawi", "malaysia",
  "maldives", "marshall islands", "mauritania", "mauritius",
  "micronesia", "moldova", "mongolia", "montenegro", "morocco", "mozambique",
  "myanmar", "namibia", "nepal", "netherlands", "new zealand", "nicaragua",
  "niger", "nigeria", "north macedonia", "norway", "oman", "pakistan", "palau",
  "papua new guinea", "paraguay", "philippines", "poland", "portugal", "qatar",
  "romania", "russia", "rwanda", "saudi arabia", "senegal", "serbia",
  "seychelles", "sierra leone", "singapore", "slovakia", "slovenia",
  "solomon islands", "somalia", "south africa", "south sudan", "spain",
  "sri lanka", "sudan", "suriname", "sweden", "switzerland", "syria", "taiwan",
  "tajikistan", "tanzania", "thailand", "timor-leste", "togo", "tonga",
  "trinidad", "tunisia", "turkey", "turkiye", "turkmenistan", "uganda",
  "ukraine", "united arab emirates", "united kingdom", "uruguay", "uzbekistan",
  "vanuatu", "venezuela", "vietnam", "yemen", "zambia", "zimbabwe",
  // Regions / constituent countries / territories named on their own.
  "england", "scotland", "wales", "northern ireland", "great britain",
  "britain", "gibraltar", "diego garcia", "azores", "crete", "sicily",
  "sardinia", "okinawa", // (Okinawa is Japan — a prefecture, not a US state.)
];

/** Raw patterns (NOT escaped) for names needing word-context rules. Kept tiny
 *  and explicit: "mexico" is a foreign country, but "New Mexico" is a state. */
const FOREIGN_PLACE_PATTERNS: readonly string[] = ["(?<!new )mexico"];

/**
 * Two-letter country codes that mark a FOREIGN place of performance, filtered
 * below so a code that is also a USPS state code (or a US territory / APO-FPO
 * code) can NEVER be treated as foreign — "PA", "CA", "DE", "IN", "MO"… stay
 * domestic no matter what. AE/AA/AP are the overseas military-mail codes
 * ("APO, AE"): they are not states, and a row carrying one is abroad.
 */
const FOREIGN_COUNTRY_CODES: readonly string[] = [
  "AF", "AE", "AL", "AM", "AO", "AR", "AT", "AU", "AW", "AZ", "BA", "BB", "BD",
  "BE", "BF", "BG", "BH", "BI", "BJ", "BM", "BN", "BO", "BR", "BS", "BT", "BW",
  "BY", "BZ", "CD", "CF", "CG", "CH", "CI", "CL", "CM", "CN", "CO", "CR", "CU",
  "CV", "CW", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG",
  "ER", "ES", "ET", "FI", "FJ", "FM", "FR", "GA", "GB", "GD", "GE", "GH", "GM",
  "GN", "GQ", "GR", "GT", "GW", "GY", "HK", "HN", "HR", "HT", "HU", "ID", "IE",
  "IL", "IN", "IQ", "IS", "IT", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM",
  "KN", "KR", "KW", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU",
  "LV", "LY", "MA", "MC", "MD", "ME", "MG", "MH", "MK", "ML", "MM", "MN", "MO",
  "MR", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NE", "NG", "NI", "NL",
  "NO", "NP", "NR", "NZ", "OM", "PA", "PE", "PG", "PH", "PK", "PL", "PS", "PT",
  "PW", "PY", "QA", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG",
  "SI", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SY", "SZ", "TD",
  "TG", "TH", "TJ", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA",
  "UG", "UK", "US", "UY", "UZ", "VA", "VC", "VE", "VN", "VU", "WS", "YE", "ZA",
  "ZM", "ZW", "AA", "AP",
];
/** US territory / freely-associated codes: US sovereign soil or US-affiliated,
 *  so never "foreign" by themselves (Guam, Puerto Rico, USVI…). */
const US_TERRITORY_CODES = ["PR", "GU", "VI", "AS", "MP", "UM", "US"];

/**
 * The codes that actually discriminate. Built from the raw list MINUS every
 * USPS state code and every US territory code, so a bare "CO"/"CA"/"DE"/"IN"
 * can never be read as foreign (that is what makes a bare-code check safe on a
 * domestic row). Exported for the regression test that re-proves it.
 */
export const FOREIGN_PLACE_CODES: readonly string[] = FOREIGN_COUNTRY_CODES.filter(
  (c) => !STATE_CODES.has(c) && !US_TERRITORY_CODES.includes(c),
);

/**
 * Well-known foreign cities / US installations abroad that appear as the real
 * place of performance in federal notices while `location` stays a placeholder.
 * Curated constants (never user input), same spirit as KNOWN_CITY_STATE — but
 * used ONLY to suppress a US-state stamp, never to derive one.
 */
const FOREIGN_PLACE_NAMES: readonly string[] = [
  // Republic of Korea (the live 139639 case) — cities + garrisons.
  "busan", "pusan", "daegu", "taegu", "seoul", "pyeongtaek", "pyongtaek",
  "osan", "kunsan", "gunsan", "yongsan", "chinhae", "jinhae", "uijeongbu",
  "dongducheon", "daejeon", "gimhae", "waegwan", "camp humphreys",
  "camp carroll", "camp bonifas", "camp casey", "rok",
  // Japan.
  "tokyo", "yokota", "yokosuka", "misawa", "sasebo", "iwakuni", "kadena",
  "naha", "atsugi", "sagamihara", "hiroshima",
  // Germany / Italy / UK / Spain (US garrisons).
  "ramstein", "grafenwoehr", "vilseck", "wiesbaden", "baumholder",
  "spangdahlem", "ansbach", "hohenfels", "kaiserslautern", "stuttgart",
  "aviano", "vicenza", "sigonella", "lakenheath", "mildenhall", "croughton",
  // Middle East / Africa / Caribbean / Pacific (US facilities abroad).
  "al udeid", "al udied", "al dhafra", "ali al salem", "camp arifjan",
  "camp lemonnier", "manama", "jebel ali", "guantanamo", "soto cano",
  "palmerola", "lajes", "thule", "souda bay",
];

/**
 * TIER 1 — unambiguous foreign PLACE names (cities + US installations abroad).
 * These are place words by construction, so they are evidence wherever they
 * appear (a title that says "Camp Humphreys" or "Osan AB" IS stating the work
 * site).
 */
const FOREIGN_PLACE_RE = new RegExp(
  `(?:^|[^a-z])(?:${FOREIGN_PLACE_NAMES.map(escapeRegex).join("|")})(?=$|[^a-z])`,
  "i",
);

/**
 * TIER 2 — country / region names. Evidence EVERYWHERE in a place field (the
 * performance-location column: "Korea, South", "Germany", "Qatar"), but in a
 * TITLE only where the title actually PLACES the name: start of the string, a
 * comma/semicolon/paren/slash boundary ("…Air Base, South Korea"), or a place
 * preposition ("Fuel services at Osan, Korea" / "…to Vietnam").
 *
 * WHY: the dry-run found a DLA row whose title reads "Sole Source to Raytheon |
 * Upgrades for the Qatar FMS (Foreign Military Sales) PATRIOT Program" — a
 * country named as the CUSTOMER, with the work performed in the US (stored AL,
 * correct). "for the Qatar FMS" is not a place statement; "…, Qatar" is.
 */
const PLACE_PREPOSITIONS =
  "at|in|near|for|to|of|on|from|across|within|outside|into";
const FOREIGN_COUNTRY_RE = new RegExp(
  `(?:^|[,;(/]\\s*|\\s+(?:${PLACE_PREPOSITIONS})\\s+)(?:${[
    ...FOREIGN_COUNTRY_NAMES.map(escapeRegex),
    ...FOREIGN_PLACE_PATTERNS,
  ].join("|")})(?=$|[^a-z])`,
  "i",
);

/**
 * The named signals (countries + places, not the codes), exported for the
 * regression test and for audit tooling that must show WHICH signal fired on a
 * row — the guard is only acceptable if a reviewer can see why a state was
 * dropped. Data only; never used to derive a state.
 */
export const FOREIGN_PLACE_SIGNAL_NAMES: readonly string[] = [
  ...FOREIGN_COUNTRY_NAMES,
  ...FOREIGN_PLACE_NAMES,
];
/** Standalone UPPERCASE 2-letter tokens; membership decides (below). Only ever
 *  used through `String.matchAll` (which iterates a clone, so the shared
 *  `lastIndex` can never leak between calls). */
const FOREIGN_CODE_TOKENS = new Set<string>(FOREIGN_PLACE_CODES);
const STANDALONE_CODE_RE = /(?:^|[^A-Za-z])([A-Z]{2})(?=$|[^A-Za-z])/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => "\\" + ch);
}

/** Standalone UPPERCASE country-code token present? (see the note below). */
function hasForeignCodeToken(text: string): boolean {
  for (const m of text.matchAll(STANDALONE_CODE_RE)) {
    if (FOREIGN_CODE_TOKENS.has(m[1])) return true;
  }
  return false;
}

/**
 * A PLACE FIELD (the `location` column — literally the place of performance):
 * country/region names anywhere, unambiguous foreign place names, and a
 * non-colliding country code as a standalone uppercase token ("Busan, KR",
 * "APO, AE", "KR"). Pure and evidence-only; it can never produce a state.
 *
 * Codes are matched case-SENSITIVELY and only here: procurement text writes ISO
 * codes in caps, while ordinary English words that collide with a country code
 * ("it", "is", "no", "me", "to") are lowercase — so no sentence can be mistaken
 * for a country. In a TITLE a bare 2-letter token is a PART/office code
 * ("…0735NZ" → NZ, "FY26 AE IDIQ" → AE): see isForeignPlaceOfPerformance.
 */
export function isForeignPlaceField(text: string | null | undefined): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  if (FOREIGN_COUNTRY_RE.test(t)) return true;
  if (FOREIGN_PLACE_RE.test(t)) return true;
  return hasForeignCodeToken(t);
}

/**
 * FREE TEXT (a notice title): an unambiguous foreign PLACE name, or a country /
 * region name the text itself places (tier 2 above). Deliberately narrower than
 * isForeignPlaceField — no bare code tokens (part numbers), and no country name
 * used as a customer. Pure and evidence-only; it can never produce a state.
 */
export function isForeignPlaceOfPerformance(
  text: string | null | undefined,
): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return FOREIGN_PLACE_RE.test(t) || FOREIGN_COUNTRY_RE.test(t);
}

/**
 * The row-level guard: does the notice's OWN place-of-performance evidence
 * prove the work is outside the United States?
 *
 * FIELD POLICY — measurement-driven, and deliberately narrow:
 *   • `location` — literally the place-of-performance field (isForeignPlaceField).
 *   • `title`    — short and place-shaped ("… for Busan Area, USAG-Daegu"),
 *     matched with the narrower free-text rule above.
 *   • the AGENCY is NOT consulted: it names the BUYER, not the work site, and on
 *     the live 139639 row the buyer string is exactly the untrustworthy field
 *     that invented "CO".
 *   • the DESCRIPTION is NOT consulted: it is long free text in which a country
 *     is routinely mentioned only in passing (DLA part notices, USACE project
 *     narratives, treaty/border boilerplate). The SELECT-only dry-run over the
 *     17,557 rows that carry a stored state measured this: description evidence
 *     ALONE fired the guard on 3,130 rows and would have stripped the state off
 *     319 of them — overwhelmingly correct domestic stamps such as
 *     "DLA AVIATION AT PHILADELPHIA, PA" → PA or "LOWER COLORADO REGIONAL
 *     OFFICE" → CO. Title/location evidence keeps the guard on the work site.
 */
export function hasForeignPlaceOfPerformance(
  location: string | null | undefined,
  title: string | null | undefined,
): boolean {
  return (
    isForeignPlaceField(location) || isForeignPlaceOfPerformance(title)
  );
}

/**
 * AGENCY-JURISDICTION RULE — the owner-RATIFIED narrow discriminator (plan rev
 * 282/284/285, 2026-09-23) for the Ohio Army National Guard rows whose `location`
 * is the "United States" placeholder while their CONTRACTING OFFICE is a named
 * Ohio installation (live rows 134001 / 135456 / 133853; 134001 closed 09-22).
 *
 * WHY NOT THE STORED GEOGRAPHY COLUMNS: the SELECT-only probe
 * (shared/ohio-phase3-prep-2026-09-23/cjag-stored-geo-probe-2026-09-23.txt)
 * proved those columns do NOT discriminate — the FIX 2 rows carry PA/NY through
 * the very same agency-text fallback ("DLA AVIATION AT PHILADELPHIA, PA" →
 * 'PA'). A broad stored-geography read would therefore turn those NATIONWIDE
 * contracts into state-local matches and break FIX 2.
 *
 * WHY A LITERAL AGENCY LIST: it is narrow, auditable and exercisable as a pure
 * function; both regression pins (OH-ARNG → local, DLA-Philadelphia → nationwide)
 * sit side by side in radar-search.regression.test.ts. It deliberately does NOT
 * key on `source` — those rows are `sam_gov`, a FEDERAL label, so a source-keyed
 * map could never flip them — and it does NOT key on "a state code appears
 * somewhere in the agency text" (that is precisely the broad read that breaks
 * FIX 2). The matched phrase is a contracting-office code plus its own
 * jurisdiction ("W7NU USPFO ACTIVITY OH ARNG"), so containment cannot capture
 * an unrelated agency.
 *
 * NOT INCLUDED, deliberately: the 11 "MWR OHIO (64000)" rows. An agency whose
 * NAME mentions a state is not evidence the work is performed there; they stay
 * nationwide until a separate verification confirms Ohio relevance.
 *
 * PROVENANCE: the `bids` schema has NO geography_source column today, so nothing
 * is persisted by this rule — provenance is carried by
 * `AGENCY_JURISDICTION_PROVENANCE` ("agency_jurisdiction_rule") in the consumer's
 * return value, by this comment, by the test names and by the PR description.
 * Adding a column would need an owner-gated migration and is deliberately NOT
 * done here.
 */
export const AGENCY_JURISDICTION_PROVENANCE = "agency_jurisdiction_rule";
interface AgencyJurisdictionRule {
  state: string;
  match: RegExp;
}
const AGENCY_JURISDICTION_RULES: readonly AgencyJurisdictionRule[] = [
  // Ohio Army National Guard — USPFO ACTIVITY OH ARNG (Wright-Patterson AFB /
  // Springfield ANGB contracting office). Whitespace-tolerant + case-insensitive
  // so an extra space in the source text cannot silently drop the rule.
  { state: "OH", match: /W7NU\s+USPFO\s+ACTIVITY\s+OH\s+ARNG/i },
];
/**
 * Resolve a row's jurisdiction from its AGENCY (contracting office) alone, via
 * the curated narrow rules above. PURE. Returns null for every agency not on the
 * list — i.e. every federal "United States"-located row (DLA, USACE districts,
 * MWR offices, …) keeps today's nationwide semantics.
 */
export function agencyJurisdictionState(
  agency: string | null | undefined,
): { state: string; provenance: string } | null {
  const a = String(agency ?? "").replace(/\s+/g, " ").trim();
  if (!a) return null;
  for (const rule of AGENCY_JURISDICTION_RULES) {
    if (rule.match.test(a)) {
      return { state: rule.state, provenance: AGENCY_JURISDICTION_PROVENANCE };
    }
  }
  return null;
}

/** Radar bucket for one scanned match (owner 09-14). "local" ONLY when the
 *  requested state is set, the row is NOT national-scope, and its resolved
 *  geography (performance location, then buyer/agency) equals the requested
 *  state. Everything else — no state requested ("Any state (nationwide)"),
 *  national scope, or a different state — is "nationwide". Single source of
 *  truth for the handler's three-way bucketing and the regression tests.
 *
 *  AGENCY-JURISDICTION RULE (owner-ratified narrow rule, 2026-09-23) is consulted
 *  FIRST: an agency on the curated list is bucketed by the rule's state, so the
 *  Ohio-ARNG rows bucket LOCAL for Ohio even though their location is the
 *  "United States" placeholder. Every agency NOT on the list reaches the
 *  unchanged national-scope branch below, which is what keeps the FIX 2 pin
 *  (DLA Philadelphia → nationwide) exactly as it was. */
export function matchGeographyBucket(
  stateCode: string,
  location: string | null | undefined,
  agency: string | null | undefined,
): "local" | "nationwide" {
  if (!stateCode) return "nationwide";
  const rule = agencyJurisdictionState(agency);
  if (rule) return rule.state === stateCode ? "local" : "nationwide";
  if (isNationalScope(location)) return "nationwide";
  return resolveBidState(location, agency) === stateCode ? "local" : "nationwide";
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
  // 4) Resolved geography → display state name. A NATIONAL-SCOPE location
  //    ("United States", "RC"…) never borrows the buyer/agency state as the
  //    place of performance (owner 09-14) — those cards show the eligibility
  //    tag only, exactly like other no-place rows.
  const resolved = isNationalScope(locationText)
    ? null
    : resolveBidState(locationText, agencyText);
  if (resolved) return STATE_CODE_TO_NAME[resolved] ?? resolved;
  // 5) Meaningful stored location text only — the BUYER/agency is never shown
  //    as a place of performance (the card already prints the agency line; the
  //    curated signals above catch the agency-stamped bases like NNSY).
  if (locationText && !PLACEHOLDER_LOCATIONS.test(locationText)) return locationText;
  return null;
}

// ── INSERT-TIME LOCATION COLUMNS (PR-B.2) ───────────────────────────────────
// Owner PR-C prerequisite: every row INSERTED from now on carries the four
// additive columns (source_jurisdiction / raw_location / normalized_state /
// location_conflict) populated — the 21:07Z sync proved 039's backfill cannot
// fix future rows. This derivation is the SINGLE source of truth for the write
// path, and it reuses the EXACT read-path authority above (resolveBidState /
// locationConflict) so stored columns and the radar's query-time derivation can
// never drift. No guessing: a state is written only when provable from the
// row's own location/agency text; unprovable rows stay NULL (never guessed).
// The radar read path and what users see are untouched — this only feeds new
// INSERTs (and the conflict-refresh of mutable fields).

/** Collectors whose HOME JURISDICTION is provable by construction — the portal
 *  itself is a state program, so the code is never a guess:
 *    pennbid       → Pennsylvania local-government solicitation portal.
 *    va_evirginia  → eVA Virginia; keeps only VA place-of-performance items.
 *    oh_dayton     → the City of Dayton's OWN bid board (Ohio Phase 3). The city
 *                    names its own state; the entry makes source_jurisdiction
 *                    provable-by-construction instead of text-derived.
 *  Everything else derives the jurisdiction from the row's own text (or NULL
 *  where unprovable) — same conservative rule as normalized_state.
 *  Exported for the audit/regression pins (src/jobs/sources/oh-dayton.test.ts). */
export const SOURCE_HOME_JURISDICTIONS: Record<string, string> = {
  pennbid: "PA",
  va_evirginia: "VA",
  oh_dayton: "OH",
};

export interface InsertLocationColumns {
  source_jurisdiction: string | null;
  raw_location: string | null;
  normalized_state: string | null;
  location_conflict: boolean | null;
}

/**
 * Derive the four additive location columns for a row ABOUT to be inserted
 * (runner's insertBidsBatch / insertBid). PURE — no DB, no server fns.
 *
 *   source_jurisdiction — the collector's home jurisdiction USPS code when the
 *       SOURCE proves it (curated map above); otherwise the row's own
 *       geography derived exactly like normalized_state; NULL when unprovable.
 *   raw_location        — the verbatim pre-normalization location value (the
 *       value stored in bids.location; mirrors the 039 backfill's
 *       `raw_location = b.location`).
 *   normalized_state    — resolveBidState(location, agency): performance
 *       location first, then buyer/agency; NULL when neither proves one.
 *   location_conflict   — true only when the row's OWN title/description names
 *       a DIFFERENT state than the derived one (read-path locationConflict);
 *       false when a state is derived and nothing contradicts it; NULL when no
 *       state is derived (nothing to contradict — mirrors the backfill's
 *       NULL-for-unprovable convention).
 */
export function deriveInsertLocationColumns(args: {
  location: string | null | undefined;
  agency: string | null | undefined;
  title: string | null | undefined;
  description: string | null | undefined;
  sourceName: string;
}): InsertLocationColumns {
  const raw = String(args.location ?? "");
  const raw_location = raw ? raw : null;
  // FOREIGN PLACE OF PERFORMANCE GUARD (owner order 2026-09-23). The
  // agency-name→US-state fallback is not available to a row whose own
  // place-of-performance evidence proves the work is abroad: the only state
  // that may survive is one the PERFORMANCE LOCATION itself names. Live row
  // 139639 (sam_gov) — location "United States", title "Trash Removal and
  // Disposal for Busan Area, USAG-Daegu", agency "0906 AQ CO     DET A
  // CONTRACTI" — stored normalized_state NULL (was 'CO'): the bare "CO" token
  // of the contracting-office string must never stamp a South-Korea contract
  // Colorado. Never invents a state — an honest "no US state" instead.
  const foreignPop = hasForeignPlaceOfPerformance(
    args.location,
    args.title,
  );
  const normalized_state = foreignPop
    ? resolveStateFromText(args.location)
    : resolveBidState(args.location, args.agency);
  const curated = SOURCE_HOME_JURISDICTIONS[args.sourceName];
  const source_jurisdiction = curated ?? normalized_state;
  const location_conflict = normalized_state
    ? locationConflict(args.title, args.description, normalized_state)
    : null;
  return { source_jurisdiction, raw_location, normalized_state, location_conflict };
}
