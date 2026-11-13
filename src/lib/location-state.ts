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

import { US_PLACES, US_TERRITORIES } from "~/lib/states";

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
  // US territories (owner 2026-10-28).
  "puerto rico": "PR",
  guam: "GU",
  "virgin islands": "VI",
  "american samoa": "AS",
  "northern mariana islands": "MP",
};

/** Full state names, longest-first so "West Virginia" beats "Virginia". */
export const STATE_FULL_NAMES: string[] = Object.keys(STATE_NAME_TO_CODE).sort(
  (a, b) => b.length - a.length,
);

/** Set of valid USPS codes: states, DC and territories (shared US_PLACES). */
const STATE_CODES = new Set<string>(US_PLACES);
/**
 * Territory codes double as common abbreviations ("PR" purchase request, EPA
 * "Region VI", "AS needed"), so in free text they only count in the
 * "City, XX" form; their full names always count.
 */
const TERRITORY_CODES = new Set<string>(US_TERRITORIES);

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
  // Owner 2026-11-06 (dashboard map lit up Washington State for "Washington, DC"):
  // a trailing ", XX" state code (optionally with a ZIP) is the strongest signal
  // and wins over a state name inside the place name — "Kansas City, MO",
  // "Indiana, PA", "Delaware, OH", "Washington Township, NJ".
  const tail = /,\s*([A-Za-z]{2})\.?(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(t);
  if (tail && STATE_CODES.has(tail[1].toUpperCase())) return tail[1].toUpperCase();
  if (/\bwashington,?\s+d\.?\s?c\b/i.test(t)) return "DC";
  // Full names next (exact substring, case-insensitive).
  for (const name of STATE_FULL_NAMES) {
    const idx = lowered.indexOf(name);
    if (idx >= 0) return STATE_NAME_TO_CODE[name];
  }
  // Standalone code tokens.
  const re = /(?:^|[\s,/()])([A-Za-z]{2})(?=$|[\s,.)/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const code = m[1].toUpperCase();
    if (!STATE_CODES.has(code)) continue;
    if (TERRITORY_CODES.has(code) && !/,\s*$/.test(t.slice(0, m.index + m[0].indexOf(m[1])))) continue;
    return code;
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
  const geo = resolveRowGeography({ location, agency });
  if (geo.agencyRule) return geo.agencyRule.state === stateCode; // another state's LOCAL row → not relevant
  if (geo.nationalScope) return true; // national-scope row → never state-local
  if (!geo.state) return true; // nationwide/unknown → kept (pre-existing semantics)
  return geo.state === stateCode;
}

/**
 * S3 GEOGRAPHY — THE ONE SHARED RESOLVER (owner-approved 2026-09-23, D9/D10).
 *
 * Read path AND write path decide a row's geography here; nothing else may
 * re-implement the order. The order, with provenance recorded at every step:
 *
 *   1. the row's OWN place of performance (`location` text) — the only evidence
 *      that can name a state outright;
 *   2. a foreign place of performance ⇒ NO US state from agency text (the owner
 *      order of 2026-09-23; live row 139639, "Busan, South Korea" + a
 *      contracting-office string that happens to carry a "CO" token);
 *   3. the curated state-body AGENCY rule (OH-ARNG — `agencyJurisdictionState`),
 *      which outranks the national-scope placeholder exactly as the read path
 *      always did;
 *   4. `isNationalScope(location)` ⇒ NO state, ever (a "United States"/"RC"/…
 *      row never borrows a state from its buyer). This is the step the WRITE
 *      path used to skip, which is what made the stored overview an optimistic
 *      shadow of Radar (D9);
 *   5. the buyer/agency TEXT fallback (unchanged pre-existing semantics for
 *      rows whose location carries no state at all);
 *   6. none of the above ⇒ NULL (honest "no US state"), never invented.
 *
 * PURE — no DB, no server fns. `provenance` is for the metric/readout, not for
 * product display. Deliberately does NOT read the stored columns (normalized_state
 * / source_jurisdiction), so a write followed by a read is idempotent.
 */
export type GeographyProvenance =
  | "place_of_performance"
  | "foreign_place_of_performance"
  | "agency_jurisdiction_rule"
  | "national_scope"
  | "agency_fallback"
  | "unprovable";

export interface RowGeography {
  /** The USPS state the row's own evidence proves, or NULL (nationwide/unknown). */
  state: string | null;
  provenance: GeographyProvenance;
  /** The location declared national scope ("United States", "RC", …). */
  nationalScope: boolean;
  /** Set when the buyer is on the curated state-body agency list. */
  agencyRule: { state: string; provenance: string } | null;
}

export function resolveRowGeography(args: {
  location?: string | null;
  agency?: string | null;
}): RowGeography {
  const location = args.location;
  const agency = args.agency;
  const nationalScope = isNationalScope(location);
  const fromLocation = resolveStateFromText(location);
  if (fromLocation) {
    return { state: fromLocation, provenance: "place_of_performance", nationalScope, agencyRule: null };
  }
  if (isForeignPlaceField(location)) {
    return {
      state: null,
      provenance: "foreign_place_of_performance",
      nationalScope,
      agencyRule: null,
    };
  }
  const rule = agencyJurisdictionState(agency);
  if (rule) {
    return { state: rule.state, provenance: "agency_jurisdiction_rule", nationalScope, agencyRule: rule };
  }
  if (nationalScope) {
    return { state: null, provenance: "national_scope", nationalScope: true, agencyRule: null };
  }
  const fromAgency = resolveStateFromText(agency);
  if (fromAgency) {
    return { state: fromAgency, provenance: "agency_fallback", nationalScope, agencyRule: null };
  }
  return { state: null, provenance: "unprovable", nationalScope, agencyRule: null };
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
  const geo = resolveRowGeography({ location, agency });
  if (geo.agencyRule) return geo.agencyRule.state === stateCode ? "local" : "nationwide";
  if (geo.nationalScope) return "nationwide";
  return geo.state === stateCode ? "local" : "nationwide";
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
  // The code must be written in capitals: matching ignores case for the city
  // words, so "Multiple Buildings in and around…" would otherwise read "in"
  // as Indiana (owner 2026-10-21, Richmond DGS custodial bid).
  const bad = (city: string, code: string) =>
    code !== code.toUpperCase() ||
    !STATE_CODES.has(code.toUpperCase()) ||
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
    const code = m[2];
    if (!bad(city, code)) return `${city}, ${code}`;
  }
  // Comma-form: "Hardin County, OH" / "Norfolk, VA".
  const commaRe = /([A-Za-z][A-Za-z .'-]{1,40}?)\s*,\s*([A-Z]{2})(?=$|[\s,.)/])/gi;
  while ((m = commaRe.exec(t)) !== null) {
    const city = m[1].trim();
    const code = m[2];
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
 *    va_eva        → eVA, Virginia's own procurement portal; every buyer on it
 *                    is a Virginia public body.
 *    tx_esbd       → Texas ESBD; every buyer on it is a Texas public body.
 *    fl_mfmp       → Florida MFMP Vendor Bid System; every buyer is a Florida
 *                    state entity.
 *    ca_eprocure   → California Cal eProcure; every buyer is a California state
 *                    department.
 *    pa_dgs_emarketplace → Pennsylvania eMarketplace; every buyer is a
 *                    Commonwealth of Pennsylvania entity.
 *    co_vss        → Colorado Vendor Self Service; every buyer is a Colorado
 *                    state entity.
 *    oh_odot       → Ohio Department of Transportation lettings; the buyer is
 *                    ODOT itself.
 *    ny_nyscr      → NYS Contract Reporter; every advertiser is a New York
 *                    state or local public body.
 *    mi_sigma      → Michigan SIGMA VSS; every buyer is a Michigan state or
 *                    local public body.
 *    ma_commbuys / nj_njstart / il_bidbuy / or_oregonbuys / nv_nevadaepro /
 *    ar_arbuy      → Periscope state marketplaces; every buyer is a public body
 *                    of that state.
 *    ga_gpr        → Georgia Procurement Registry; every buyer is a Georgia
 *                    state or local public body.
 *    wv_oasis      → West Virginia wvOASIS VSS; every buyer is a West Virginia
 *                    state agency.
 *    ky_vss        → Kentucky eProcurement VSS; every buyer is a Kentucky
 *                    Commonwealth agency.
 *    al_aldot      → Alabama Department of Transportation lettings; the buyer
 *                    is ALDOT itself.
 *    ak_dotpf      → Alaska DOT&PF construction bid calendar; the buyer is
 *                    DOT&PF itself.
 *    nc_evp        → North Carolina eVP; every buyer is a North Carolina
 *                    state agency, university, school or local government.
 *    dc_pass       → DC OCP PASS solicitations; every buyer is a District of
 *                    Columbia government agency.
 *    de_mmp        → Delaware Bid Solicitation Directory; every buyer is a
 *                    Delaware state agency, school district or college.
 *    sc_scbo       → South Carolina Business Opportunities; every advertiser
 *                    is a South Carolina state or local public body.
 *    ia_das        → Iowa Bid Opportunities; every buyer is an Iowa state or
 *                    local public body.
 *    la_lapac      → Louisiana LaPAC; every buyer is a Louisiana state agency,
 *                    university, college or local public body.
 *    in_idoa       → Indiana IDOA Current Business Opportunities; every buyer
 *                    is an Indiana state agency.
 *    mt_emacs      → Montana eMACS; every buyer is a Montana state agency or
 *                    university.
 *    vt_vbr        → Vermont Business Registry (state and municipal lists);
 *                    every author is a Vermont state or municipal body.
 *    tn_cpo        → Tennessee Central Procurement Office; every buyer is a
 *                    Tennessee state agency.
 *    ne_das        → Nebraska State Purchasing Bureau; every buyer is a
 *                    Nebraska state agency.
 *    mo_movers     → Missouri MissouriBUYS (MOVERS) bid board; every buyer is a
 *                    Missouri state agency.
 *    ct_webprocure → Connecticut CTsource Bid Board; every buyer is a
 *                    Connecticut state agency, town or city.
 *    az_app        → Arizona Procurement Portal; every buyer is an Arizona
 *                    state agency, city, town or tribal community in Arizona.
 *    wa_webs       → Washington WEBS bid calendar; every buyer is a Washington
 *                    state agency, college, city or district.
 *    ut_bonfire    → Utah U3P (Bonfire) portal; every buyer is a Utah state
 *                    agency, city, county, school or special district.
 *    ms_dfa        → Mississippi procurement search (DFA, with MPTAP legal
 *                    notices); every buyer is a Mississippi state agency,
 *                    university, county, city, school or utility district.
 *    mn_mndot      → MnDOT highway lettings; the buyer is MnDOT.
 *    mn_connex     → MnDOT State Aid eAdvert (ConneX), filtered to Minnesota;
 *                    every buyer is a Minnesota county or city.
 *    mn_questcdn   → Minnesota Dept of Administration QuestCDN postings;
 *                    every buyer is a Minnesota state department.
 *    ok_omes       → Oklahoma OMES PeopleSoft bidding events; every buyer is
 *                    an Oklahoma state agency.
 *    ks_sok        → Kansas PeopleSoft bidding events; every buyer is a
 *                    Kansas state agency.
 *    nm_epronm     → New Mexico State Purchasing (eProNM on JAGGAER); every
 *                    buyer is a New Mexico state agency.
 *    id_ipro       → Idaho IPRO open sourcing events; every buyer is an Idaho
 *                    state agency.
 *    id_itd        → Idaho Transportation Department highway lettings.
 *    ri_osp        → Rhode Island Ocean State Procures (state agencies, RIDOT).
 *    ri_external   → RI Division of Purchases external board (quasi-public,
 *                    cities and towns, URI/RIC/CCRI).
 *  Everything else derives the jurisdiction from the row's own text (or NULL
 *  where unprovable) — same conservative rule as normalized_state.
 *  Exported for the audit/regression pins (src/jobs/sources/oh-dayton.test.ts). */
export const SOURCE_HOME_JURISDICTIONS: Record<string, string> = {
  pennbid: "PA",
  va_evirginia: "VA",
  oh_worthington: "OH",
  tx_san_antonio: "TX",
  tx_houston_beacon: "TX",
  tn_nashville: "TN",
  tn_chattanooga: "TN",
  tn_knox_county: "TN",
  tn_tbr: "TN",
  tn_ut_capital: "TN",
  pa_philadelphia_phlcontracts: "PA",
  ca_san_bernardino_county: "CA",
  ca_contra_costa_county: "CA",
  ca_ebmud: "CA",
  oh_butler_county: "OH",
  pa_lackawanna_county: "PA",
  tn_smyrna: "TN",
  fl_fdot_central: "FL",
  fl_fdot_turnpike: "FL",
  fl_fdot_d1: "FL",
  fl_fdot_d2: "FL",
  fl_fdot_d3: "FL",
  fl_fdot_d5: "FL",
  fl_fdot_d7: "FL",
  fl_polk_county: "FL",
  fl_lee_county: "FL",
  fl_tampa_construction: "FL",
  pa_montgomery_county_bonfire: "PA",
  pa_pwsa_bonfire: "PA",
  pa_pit_airport_bonfire: "PA",
  pa_pha_bonfire: "PA",
  ar_jonesboro: "AR",
  ar_siloam_springs: "AR",
  ar_rogers: "AR",
  ar_bentonville: "AR",
  ar_russellville: "AR",
  ar_cabot: "AR",
  ar_maumelle: "AR",
  ar_west_memphis: "AR",
  ar_garland_county: "AR",
  ar_little_rock_bonfire: "AR",
  ar_fayetteville_ionwave: "AR",
  ar_ionwave_central: "AR",
  sc_columbia_ionwave: "SC",
  tx_plano_ionwave: "TX",
  tx_irving_ionwave: "TX",
  tx_georgetown_ionwave: "TX",
  oh_toledo_planetbids: "OH",
  ca_san_diego_planetbids: "CA",
  ca_san_diego_airport_planetbids: "CA",
  ca_port_of_san_diego_planetbids: "CA",
  ca_valley_water_planetbids: "CA",
  ca_sacrt_planetbids: "CA",
  oh_metroparks_toledo_planetbids: "OH",
  ca_bakersfield_planetbids: "CA",
  ca_culver_city_planetbids: "CA",
  ca_eastvale_planetbids: "CA",
  ca_ontario_planetbids: "CA",
  ca_vallejo_planetbids: "CA",
  ca_vernon_planetbids: "CA",
  ca_fillmore_planetbids: "CA",
  ca_beaumont_planetbids: "CA",
  ca_buena_park_planetbids: "CA",
  ca_south_coast_water_planetbids: "CA",
  ca_otay_water_planetbids: "CA",
  ca_cvwd_planetbids: "CA",
  ca_san_bernardino_planetbids: "CA",
  ca_lacc_planetbids: "CA",
  ca_duarte_planetbids: "CA",
  ca_compton_planetbids: "CA",
  ca_beverly_hills_planetbids: "CA",
  ca_lacoe_planetbids: "CA",
  ca_signal_hill_planetbids: "CA",
  ca_la_habra_planetbids: "CA",
  ca_santa_ana_planetbids: "CA",
  ca_fountain_valley_planetbids: "CA",
  ca_huntington_beach_planetbids: "CA",
  ca_riverside_planetbids: "CA",
  ca_ocfa_planetbids: "CA",
  ca_sb_county_housing_planetbids: "CA",
  ca_corona_planetbids: "CA",
  ca_rctc_planetbids: "CA",
  ca_peralta_cc_planetbids: "CA",
  ca_long_beach_usd_planetbids: "CA",
  ca_contra_costa_cc_planetbids: "CA",
  ca_san_diego_usd_planetbids: "CA",
  ca_moreno_valley_usd_planetbids: "CA",
  ca_rialto_usd_planetbids: "CA",
  tx_capmetro_planetbids: "TX",
  or_port_of_portland_planetbids: "OR",
  ca_central_san_planetbids: "CA",
  ca_fresno_planetbids: "CA",
  ca_smud_planetbids: "CA",
  va_vbcps_beacon: "VA",
  va_grtc_beacon: "VA",
  pa_pittsburgh_schools_beacon: "PA",
  tx_new_braunfels_beacon: "TX",
  ca_la_county: "CA",
  ca_port_of_oakland: "CA",
  ca_berkeley: "CA",
  ca_uc_berkeley: "CA",
  ca_ucla_capital: "CA",
  tn_memphis_beacon: "TN",
  tn_alcoa_beacon: "TN",
  tn_bradley_schools_beacon: "TN",
  tn_mount_pleasant_beacon: "TN",
  tn_sevierville: "TN",
  tn_lawrenceburg: "TN",
  tn_epb: "TN",
  tn_kingsport: "TN",
  tn_portland: "TN",
  tn_red_bank: "TN",
  oh_franklin_county: "OH", // Franklin County, OH Purchasing bid board (owner 2026-10-12)
  nj_harrison: "NJ", // Town of Harrison, NJ CivicEngage bid board (owner 2026-10-12)
  oh_dayton: "OH",
  wi_milwaukee_bonfire: "WI",
  wi_milwaukee_county_bonfire: "WI",
  ca_san_diego_county: "CA",
  ca_sacramento_library_bonfire: "CA", // Sacramento Public Library Authority Bonfire portal (owner 2026-10-09)
  il_chicago_dps: "IL", // City of Chicago DPS weekly Bid Opportunity List (owner 2026-10-09)
  il_cook_county_bonfire: "IL", // Cook County OCPO Bonfire portal (owner 2026-10-09)
  md_montgomery: "MD", // Montgomery County, MD open-data solicitations (owner 2026-10-11)
  il_cps_bonfire: "IL", // Chicago Public Schools Bonfire portal (owner 2026-10-09)
  il_cook_county_health_bonfire: "IL", // Cook County Health Bonfire portal (owner 2026-10-09)
  wi_mps_bonfire: "WI", // Milwaukee Public Schools' own Bonfire portal (owner 2026-10-07) // Milwaukee County's own Bonfire portal (owner 2026-10-07) // City of Milwaukee's own Bonfire portal (owner 2026-10-07)
  // Virginia locality CivicEngage boards (owner green-light 2026-10-08; dispatch A
  // — src/jobs/sources/va-loudoun.ts, va-suffolk.ts, va-lynchburg.ts,
  // va-charlottesville.ts): each is a Virginia locality's OWN board on
  // CivicPlus/CivicEngage, so every buyer publishing through it is that Virginia
  // locality — provable by construction, never text-derived from a row.
  va_colonial_heights: "VA",
  va_loudoun: "VA",
  va_suffolk: "VA",
  va_lynchburg: "VA",
  va_charlottesville: "VA",
  // Virginia locality Bonfire portals (owner green-light 2026-10-08, dispatch B —
  // src/jobs/sources/va-fairfax-bonfire.ts, va-alexandria-bonfire.ts): each is a
  // Virginia locality's OWN portal on Bonfire, so every buyer publishing through it
  // is that Virginia locality — provable by construction, never text-derived.
  va_virginia_beach_oracle: "VA",
  ky_louisville_bonfire: "KY",
  va_fairfax_bonfire: "VA",
  va_alexandria_bonfire: "VA",
  va_botetourt_bonfire: "VA",
  fl_broward_bonfire: "FL",
  fl_miami_dade: "FL",
  tx_harris_bonfire: "TX",
  fl_hillsborough_bonfire: "FL",
  ga_forsyth_bonfire: "GA",
  ga_columbia_bonfire: "GA",
  fl_monroe_bonfire: "FL",
  tn_montgomery_bonfire: "TN",
  tx_hood_bonfire: "TX",
  tx_parker_bonfire: "TX",
  ga_alpharetta_bonfire: "GA",
  tx_denton_bonfire: "TX",
  va_hopewell: "VA",
  va_danville: "VA",
  va_salem: "VA",
  va_pittsylvania: "VA",
  va_williamsburg: "VA",
  md_hagerstown: "MD",
  md_queen_annes: "MD",
  md_college_park: "MD",
  nc_high_point: "NC",
  nc_pitt_county: "NC",
  fl_bay_county: "FL",
  fl_titusville: "FL",
  ga_hall_county: "GA",
  ga_barrow_county: "GA",
  tx_league_city: "TX",
  tx_longview: "TX",
  tx_midland: "TX",
  tx_odessa: "TX",
  az_yuma_bonfire: "AZ",
  az_buckeye_bonfire: "AZ",
  az_mcccd_bonfire: "AZ",
  az_prescott_valley_bonfire: "AZ",
  az_peoria_bonfire: "AZ",
  az_scottsdale_bonfire: "AZ",
  az_goodyear_bonfire: "AZ",
  az_pinal_bonfire: "AZ",
  az_sedona_bonfire: "AZ",
  az_tempe_bonfire: "AZ",
  az_mesa_engineering: "AZ",
  az_maricopa_bidnet: "AZ",
  az_lake_havasu: "AZ",
  az_casa_grande: "AZ",
  az_douglas: "AZ",
  mo_kansas_city_bonfire: "MO",
  mo_st_louis_county_bonfire: "MO",
  mo_jackson_county_bonfire: "MO",
  mo_jefferson_city_bonfire: "MO",
  mo_slps_bonfire: "MO",
  mo_springfield: "MO",
  mo_st_charles_county: "MO",
  mo_st_charles: "MO",
  mo_liberty: "MO",
  mo_ozark: "MO",
  mo_ballwin: "MO",
  in_lafayette: "IN",
  in_zionsville: "IN",
  in_carmel: "IN",
  in_hamilton_county: "IN",
  in_tippecanoe_county: "IN",
  in_anderson: "IN",
  in_avon: "IN",
  in_brownsburg: "IN",
  nj_cherry_hill: "NJ",
  nj_trenton: "NJ",
  nj_cranford: "NJ",
  nj_fort_lee: "NJ",
  nj_west_orange: "NJ",
  nj_princeton: "NJ",
  nj_millville: "NJ",
  nj_livingston: "NJ",
  nj_mahwah: "NJ",
  nj_wall: "NJ",
  nj_ridgewood: "NJ",
  nj_westfield: "NJ",
  nj_montgomery: "NJ",
  nj_east_brunswick: "NJ",
  md_harford_bonfire: "MD",
  md_stadium_authority_bonfire: "MD",
  co_boulder_county_bonfire: "CO",
  oh_akron_bonfire: "OH",
  oh_cincinnati_bonfire: "OH",
  oh_westerville_bonfire: "OH",
  tx_galveston_county_bonfire: "TX",
  tx_lewisville_bonfire: "TX",
  tx_lubbock_county_bonfire: "TX",
  tx_reeves_county_bonfire: "TX",
  tx_hutchins_bonfire: "TX",
  id_meridian_bonfire: "ID",
  mi_muskegon_county_bonfire: "MI",
  ca_solano_county_bonfire: "CA",
  az_cochise_county_bonfire: "AZ",
  id_bannock_county_bonfire: "ID",
  nm_bernalillo_county_bonfire: "NM",
  nm_albuquerque_bonfire: "NM",
  nm_mckinley_county_bonfire: "NM",
  nm_rio_rancho: "NM",
  nm_roswell: "NM",
  nm_valencia_county: "NM",
  nm_clovis: "NM",
  nm_alamogordo: "NM",
  nm_gallup: "NM",
  nm_otero_county: "NM",
  nm_eddy_county: "NM",
  nm_mckinley_county: "NM",
  al_covington_county: "AL",
  ca_alpine_county: "CA",
  ca_nevada_county: "CA",
  ca_lassen_county: "CA",
  ca_lake_county: "CA",
  co_grand_county: "CO",
  co_gunnison_county: "CO",
  co_park_county: "CO",
  co_teller_county: "CO",
  co_san_miguel_county: "CO",
  ut_summit_county: "UT",
  ga_meriwether_county: "GA",
  ga_union_county: "GA",
  ga_white_county: "GA",
  il_rock_island_county: "IL",
  il_whiteside_county: "IL",
  ks_finney_county: "KS",
  ks_geary_county: "KS",
  ks_seward_county: "KS",
  mi_alpena_county: "MI",
  mi_cass_county: "MI",
  mn_nicollet_county: "MN",
  ms_desoto_county: "MS",
  mt_madison_county: "MT",
  mt_stillwater_county: "MT",
  nv_nye_county: "NV",
  nm_grant_county: "NM",
  ny_cortland_county: "NY",
  ny_columbia_county: "NY",
  ny_livingston_county: "NY",
  ny_schuyler_county: "NY",
  nc_beaufort_county: "NC",
  nc_yadkin_county: "NC",
  oh_ottawa_county: "OH",
  oh_shelby_county: "OH",
  oh_williams_county: "OH",
  ok_wagoner_county: "OK",
  or_clatsop_county: "OR",
  pa_bucks_county: "PA",
  pa_warren_county: "PA",
  sc_hampton_county: "SC",
  sd_brookings_county: "SD",
  sd_lincoln_county: "SD",
  wa_okanogan_county: "WA",
  wi_calumet_county: "WI",
  wy_converse_county: "WY",
  al_center_point: "AL",
  az_chino_valley: "AZ",
  az_eloy: "AZ",
  az_paradise_valley: "AZ",
  ar_jacksonville: "AR",
  ar_hot_springs: "AR",
  ca_arcata: "CA",
  mn_apple_valley: "MN",
  ca_capitola: "CA",
  ca_campbell: "CA",
  ca_danville: "CA",
  ca_delano: "CA",
  ca_el_cerrito: "CA",
  ca_eureka: "CA",
  ca_half_moon_bay: "CA",
  ca_healdsburg: "CA",
  ca_laguna_hills: "CA",
  ca_larkspur: "CA",
  ca_lodi: "CA",
  ca_marina: "CA",
  ca_manteca: "CA",
  ca_morro_bay: "CA",
  ca_orinda: "CA",
  ca_san_pablo: "CA",
  ca_temple_city: "CA",
  ca_yorba_linda: "CA",
  co_cortez: "CO",
  co_englewood: "CO",
  co_fort_morgan: "CO",
  ct_west_haven: "CT",
  fl_alachua: "FL",
  fl_crestview: "FL",
  fl_hallandale_beach: "FL",
  fl_indian_harbour_beach: "FL",
  fl_lake_wales: "FL",
  fl_mascotte: "FL",
  fl_opa_locka: "FL",
  fl_panama_city: "FL",
  fl_royal_palm_beach: "FL",
  fl_sebastian: "FL",
  fl_temple_terrace: "FL",
  fl_winter_springs: "FL",
  ga_waycross: "GA",
  id_post_falls: "ID",
  il_bensenville: "IL",
  il_la_grange: "IL",
  il_lincolnwood: "IL",
  il_montgomery: "IL",
  il_ofallon: "IL",
  il_wheeling: "IL",
  il_woodstock: "IL",
  in_greenfield: "IN",
  in_portage: "IN",
  ks_derby: "KS",
  ks_independence: "KS",
  ks_emporia: "KS",
  ks_liberal: "KS",
  ks_prairie_village: "KS",
  ks_ottawa: "KS",
  la_jennings: "LA",
  md_bel_air: "MD",
  md_greenbelt: "MD",
  md_westminster: "MD",
  ma_methuen: "MA",
  mi_center_line: "MI",
  mi_trenton: "MI",
  mn_faribault: "MN",
  mn_golden_valley: "MN",
  mn_little_canada: "MN",
  mn_hopkins: "MN",
  mn_northfield: "MN",
  mn_new_ulm: "MN",
  mo_des_peres: "MO",
  mo_festus: "MO",
  mo_manchester: "MO",
  mo_nevada: "MO",
  mo_overland: "MO",
  mo_st_ann: "MO",
  mo_perryville: "MO",
  mt_great_falls: "MT",
  ne_alliance: "NE",
  ne_fremont: "NE",
  ne_north_platte: "NE",
  ne_la_vista: "NE",
  nv_fernley: "NV",
  nh_concord: "NH",
  nh_berlin: "NH",
  nh_laconia: "NH",
  nj_clifton: "NJ",
  nj_edgewater: "NJ",
  nj_manville: "NJ",
  nj_lindenwold: "NJ",
  nj_roselle_park: "NJ",
  nj_tenafly: "NJ",
  nm_artesia: "NM",
  ny_albany: "NY",
  ny_auburn: "NY",
  ny_amityville: "NY",
  ny_freeport: "NY",
  ny_glens_falls: "NY",
  ny_hempstead: "NY",
  ny_ithaca: "NY",
  ny_ogdensburg: "NY",
  ny_port_chester: "NY",
  ny_sleepy_hollow: "NY",
  nc_carrboro: "NC",
  nc_kinston: "NC",
  nd_bismarck: "ND",
  nd_west_fargo: "ND",
  nd_minot: "ND",
  oh_defiance: "OH",
  oh_trenton: "OH",
  ok_miami: "OK",
  ok_midwest_city: "OK",
  or_cottage_grove: "OR",
  ri_warwick: "RI",
  sd_huron: "SD",
  sd_spearfish: "SD",
  sd_mitchell: "SD",
  tx_athens: "TX",
  tx_aubrey: "TX",
  tx_aransas_pass: "TX",
  tx_balch_springs: "TX",
  tx_galveston: "TX",
  tx_la_marque: "TX",
  tx_portland: "TX",
  ut_millcreek: "UT",
  vt_winooski: "VT",
  vt_south_burlington: "VT",
  vt_burlington: "VT",
  wa_fife: "WA",
  wa_moses_lake: "WA",
  wa_stanwood: "WA",
  wi_lake_geneva: "WI",
  wi_oregon: "WI",
  wi_waunakee: "WI",
  wy_cody: "WY",
  wy_evanston: "WY",
  wy_jackson: "WY",
  ny_rockland_county_bonfire: "NY",
  pa_allegheny_dhs_bonfire: "PA",
  ga_cobb_schools_bonfire: "GA",
  va_fairfax_eda_bonfire: "VA",
  sc_charleston_county_bonfire: "SC",
  mt_billings: "MT",
  mt_missoula: "MT",
  mt_butte_silver_bow: "MT",
  mt_kalispell: "MT",
  mt_cascade_county: "MT",
  mt_gallatin_county: "MT",
  sc_charleston: "SC",
  sc_spartanburg: "SC",
  sc_mount_pleasant: "SC",
  sc_summerville: "SC",
  sc_fort_mill: "SC",
  nc_wake_county_bonfire: "NC",
  nc_charlotte_bonfire: "NC",
  ga_chatham_county_bonfire: "GA",
  ga_floyd_county_bonfire: "GA",
  ga_roswell_bonfire: "GA",
  ga_paulding_schools_bonfire: "GA",
  wv_marshall_university_bonfire: "WV",
  nc_apex: "NC",
  nc_winston_salem: "NC",
  nc_brunswick_county: "NC",
  nc_new_hanover_county: "NC",
  nc_burlington: "NC",
  nc_iredell_county: "NC",
  nc_jacksonville: "NC",
  nc_rowan_county: "NC",
  nc_orange_county: "NC",
  nc_huntersville: "NC",
  nc_sanford: "NC",
  nc_fuquay_varina: "NC",
  nc_davidson_county: "NC",
  nc_lincoln_county: "NC",
  nc_moore_county: "NC",
  nc_nash_county: "NC",
  nc_craven_county: "NC",
  nc_carteret_county: "NC",
  nc_burke_county: "NC",
  nc_wilkes_county: "NC",
  nc_caldwell_county: "NC",
  nc_haywood_county: "NC",
  nc_jackson_county: "NC",
  nc_lumberton: "NC",
  nc_pender_county: "NC",
  nc_monroe: "NC",
  nc_boone: "NC",
  nc_clemmons: "NC",
  nc_indian_trail: "NC",
  nc_carolina_beach: "NC",
  nc_emerald_isle: "NC",
  nc_lincolnton: "NC",
  nc_ncsu_bonfire: "NC",
  nc_wcu_bonfire: "NC",
  fl_hialeah: "FL",
  fl_hollywood: "FL",
  fl_santa_rosa_county: "FL",
  fl_st_cloud: "FL",
  fl_ocoee: "FL",
  fl_bartow: "FL",
  fl_destin_beacon: "FL",
  fl_fort_walton_beach: "FL",
  fl_boynton_beach: "FL",
  fl_jupiter: "FL",
  fl_palm_beach_gardens: "FL",
  fl_margate: "FL",
  fl_deerfield_beach: "FL",
  fl_north_miami: "FL",
  fl_homestead: "FL",
  fl_aventura: "FL",
  oh_parma: "OH",
  oh_canton: "OH",
  oh_lorain: "OH",
  oh_lucas_county: "OH",
  oh_mahoning_county: "OH",
  oh_wood_county: "OH",
  oh_clark_county: "OH",
  oh_ashtabula_county: "OH",
  oh_grove_city: "OH",
  oh_upper_arlington: "OH",
  oh_reynoldsburg: "OH",
  oh_gahanna: "OH",
  oh_lancaster: "OH",
  oh_marysville: "OH",
  oh_fairfield: "OH",
  oh_beavercreek: "OH",
  oh_centerville: "OH",
  oh_piqua: "OH",
  oh_sidney: "OH",
  oh_lima: "OH",
  oh_north_canton: "OH",
  oh_barberton: "OH",
  oh_hudson: "OH",
  oh_shaker_heights: "OH",
  oh_solon: "OH",
  mi_sterling_heights: "MI",
  mi_westland: "MI",
  mi_taylor: "MI",
  mi_st_clair_shores: "MI",
  mi_royal_oak: "MI",
  mi_battle_creek: "MI",
  mi_saginaw: "MI",
  mi_east_lansing: "MI",
  mi_portage: "MI",
  mi_midland: "MI",
  mi_monroe_county: "MI",
  mi_jackson_county: "MI",
  mi_eaton_county: "MI",
  mi_lenawee_county: "MI",
  mi_holland: "MI",
  mi_jackson: "MI",
  mi_canton_township: "MI",
  mi_ypsilanti: "MI",
  mi_walker: "MI",
  mi_clinton_township: "MI",
  mi_chesterfield_township: "MI",
  mi_inkster: "MI",
  wa_mukilteo: "WA",
  wa_lake_stevens: "WA",
  wa_monroe: "WA",
  wa_arlington: "WA",
  wa_lynden: "WA",
  wa_port_angeles: "WA",
  wa_bainbridge_island: "WA",
  wa_gig_harbor: "WA",
  co_westminster: "CO",
  co_pueblo: "CO",
  co_broomfield: "CO",
  co_grand_junction: "CO",
  co_montrose_county: "CO",
  co_montrose: "CO",
  co_durango: "CO",
  co_lafayette: "CO",
  co_berthoud: "CO",
  co_firestone: "CO",
  co_frederick: "CO",
  co_aspen: "CO",
  co_steamboat_springs: "CO",
  co_greenwood_village: "CO",
  or_grants_pass: "OR",
  or_yamhill_county: "OR",
  or_crook_county: "OR",
  or_wilsonville: "OR",
  or_forest_grove: "OR",
  or_lebanon: "OR",
  or_la_grande: "OR",
  or_central_point: "OR",
  or_eagle_point: "OR",
  al_hoover: "AL",
  al_dothan: "AL",
  al_gadsden: "AL",
  al_alabaster: "AL",
  al_opelika: "AL",
  al_northport: "AL",
  al_shelby_county: "AL",
  al_st_clair_county: "AL",
  al_fairhope: "AL",
  al_orange_beach: "AL",
  al_hartselle: "AL",
  al_cullman: "AL",
  al_leeds: "AL",
  al_muscle_shoals: "AL",
  tn_clarksville: "TN",
  tn_bartlett: "TN",
  tn_hendersonville: "TN",
  tn_williamson_county: "TN",
  tn_blount_county: "TN",
  tn_madison_county: "TN",
  tn_millington: "TN",
  tn_lakeland: "TN",
  in_warsaw: "IN",
  ny_buffalo_schools_bonfire: "NY",
  ny_nfta_bonfire: "NY",
  oh_columbus_bonfire: "OH",
  mi_detroit_bonfire: "MI",
  ga_atlanta_schools_bonfire: "GA",
  or_portland_state_bonfire: "OR",
  ak_university_of_alaska_bonfire: "AK",
  fl_famu_bonfire: "FL",
  ny_stony_brook_bonfire: "NY",
  oh_toledo_schools_bonfire: "OH",
  oh_dayton_schools_bonfire: "OH",
  mi_grand_rapids_schools_bonfire: "MI",
  or_southern_oregon_university_bonfire: "OR",
  pa_abington_township: "PA",
  pa_lancaster_county: "PA",
  pa_york_county: "PA",
  pa_luzerne_county: "PA",
  pa_cumberland_county: "PA",
  pa_butler_county: "PA",
  pa_centre_county: "PA",
  il_rockford: "IL",
  il_decatur: "IL",
  il_normal: "IL",
  il_dekalb: "IL",
  il_edwardsville: "IL",
  il_kankakee_county: "IL",
  il_lasalle_county: "IL",
  ky_independence: "KY",
  mn_st_joseph: "MN",
  mo_wildwood: "MO",
  mo_hazelwood: "MO",
  mo_webster_groves: "MO",
  mo_republic: "MO",
  mo_branson: "MO",
  mo_clay_county: "MO",
  mo_cole_county: "MO",
  ky_henderson: "KY",
  ky_danville: "KY",
  ky_newport: "KY",
  oh_berea: "OH",
  ky_kenton_county: "KY",
  ky_hardin_county: "KY",
  ky_boyd_county: "KY",
  mn_maple_grove: "MN",
  mn_st_cloud: "MN",
  mn_blaine: "MN",
  mn_lakeville: "MN",
  mn_maplewood: "MN",
  mn_cottage_grove: "MN",
  mn_richfield: "MN",
  mn_andover: "MN",
  mn_oakdale: "MN",
  mn_chaska: "MN",
  mn_prior_lake: "MN",
  mn_elk_river: "MN",
  mn_red_wing: "MN",
  mn_brainerd: "MN",
  mn_anoka_county: "MN",
  mn_washington_county: "MN",
  mn_wright_county: "MN",
  mn_sherburne_county: "MN",
  wi_green_bay: "WI",
  wi_eau_claire: "WI",
  wi_brookfield: "WI",
  wi_greenfield: "WI",
  wi_oak_creek: "WI",
  wi_superior: "WI",
  wi_fitchburg: "WI",
  wi_germantown: "WI",
  wi_walworth_county: "WI",
  wi_ozaukee_county: "WI",
  wi_portage_county: "WI",
  wi_chippewa_county: "WI",
  ia_dubuque: "IA",
  ia_johnston: "IA",
  az_sahuarita: "AZ",
  az_cottonwood: "AZ",
  wy_douglas: "WY",
  ga_douglas: "GA",
  ok_edmond: "OK",
  ok_lawton: "OK",
  ok_stillwater: "OK",
  ok_owasso: "OK",
  ks_shawnee: "KS",
  ok_yukon: "OK",
  ok_bixby: "OK",
  ok_ponca_city: "OK",
  ok_duncan: "OK",
  ok_sand_springs: "OK",
  ok_el_reno: "OK",
  ok_tahlequah: "OK",
  ok_cleveland_county: "OK",
  ok_comanche_county: "OK",
  ok_rogers_county: "OK",
  ok_pottawatomie_county: "OK",
  sc_beaufort: "SC",
  sc_lancaster_county: "SC",
  ga_marietta: "GA",
  ga_stonecrest: "GA",
  ga_brookhaven: "GA",
  ga_peachtree_corners: "GA",
  ga_hinesville: "GA",
  ga_mcdonough: "GA",
  ga_dalton: "GA",
  ga_cartersville: "GA",
  ga_tifton: "GA",
  ga_columbia_county: "GA",
  ga_walton_county: "GA",
  ga_camden_county: "GA",
  ma_lowell: "MA",
  ma_lawrence: "MA",
  ma_framingham: "MA",
  ma_malden: "MA",
  ma_pittsfield: "MA",
  ma_salem: "MA",
  ma_westfield: "MA",
  ma_fitchburg: "MA",
  ma_beverly: "MA",
  al_chelsea: "AL",
  ma_braintree: "MA",
  ma_shrewsbury: "MA",
  ma_dartmouth: "MA",
  ma_chelmsford: "MA",
  ma_andover: "MA",
  ma_franklin: "MA",
  ma_needham: "MA",
  ma_wellesley: "MA",
  ma_milford: "MA",
  de_milford: "DE",
  ma_lexington: "MA",
  ma_westford: "MA",
  ma_dracut: "MA",
  ma_wakefield: "MA",
  ma_falmouth: "MA",
  ma_amherst: "MA",
  ma_northampton: "MA",
  ct_bloomfield: "CT",
  ct_branford: "CT",
  ct_bristol: "CT",
  ct_brooklyn: "CT",
  ct_burlington: "CT",
  ct_cheshire: "CT",
  ct_clinton: "CT",
  ct_cornwall: "CT",
  ct_coventry: "CT",
  ct_cromwell: "CT",
  ct_danbury: "CT",
  ct_darien: "CT",
  ct_east_haven: "CT",
  ct_enfield: "CT",
  ct_granby: "CT",
  ct_greenwich: "CT",
  ct_lisbon: "CT",
  ct_madison: "CT",
  ct_middlefield: "CT",
  ct_middletown: "CT",
  ct_newington: "CT",
  ct_north_branford: "CT",
  ct_north_stonington: "CT",
  ct_norwalk: "CT",
  ct_old_lyme: "CT",
  ct_old_saybrook: "CT",
  ct_orange: "CT",
  ct_plainville: "CT",
  ct_preston: "CT",
  ct_rocky_hill: "CT",
  ct_roxbury: "CT",
  ct_salem: "CT",
  ct_sharon: "CT",
  ct_simsbury: "CT",
  ct_south_windsor: "CT",
  ct_sterling: "CT",
  ct_torrington: "CT",
  ct_trumbull: "CT",
  ct_washington: "CT",
  ct_waterford: "CT",
  ct_wethersfield: "CT",
  ct_willington: "CT",
  ct_windham: "CT",
  ct_windsor: "CT",
  ct_wolcott: "CT",
  ct_woodbridge: "CT",
  pa_allegheny_county_bonfire: "PA",
  il_joliet_bonfire: "IL",
  ky_owensboro_bonfire: "KY",
  ky_lexington_bonfire: "KY",
  ky_covington_bonfire: "KY",
  tx_laredo_isd_bonfire: "TX",
  mn_rochester_schools_bonfire: "MN",
  fl_st_lucie_schools_bonfire: "FL",
  ga_fulton_schools_bonfire: "GA",
  md_wicomico_schools_bonfire: "MD",
  ks_wichita_bonfire: "KS",
  il_metra_bonfire: "IL",
  fl_psta_bonfire: "FL",
  ga_sandy_springs_bonfire: "GA",
  il_city_colleges_bonfire: "IL",
  sd_sioux_falls_bonfire: "SD",
  wi_waukesha_county_bonfire: "WI",
  tx_comal_isd_bonfire: "TX",
  id_nampa_bonfire: "ID",
  ut_granite_schools_bonfire: "UT",
  tx_mesquite_isd_bonfire: "TX",
  or_portland_cc_bonfire: "OR",
  ma_umass_bonfire: "MA",
  ga_peachtree_city: "GA",
  ga_lowndes_county: "GA",
  ga_lawrenceville: "GA",
  ga_newnan: "GA",
  ga_liberty_county: "GA",
  ga_savannah: "GA",
  ga_athens_clarke: "GA",
  ga_douglas_county: "GA",
  ga_coweta_county: "GA",
  ga_carroll_county: "GA",
  ga_effingham_county: "GA",
  ga_dawson_county: "GA",
  ga_jackson_county: "GA",
  ga_rome: "GA",
  wv_fairmont: "WV",
  wv_berkeley_county: "WV",
  wv_vienna: "WV",
  wv_weirton: "WV",
  wv_morgantown: "WV",
  tn_pigeon_forge: "TN",
  tn_la_vergne: "TN",
  tn_mt_juliet: "TN",
  tn_spring_hill: "TN",
  tn_cookeville: "TN",
  tn_oak_ridge: "TN",
  tn_lebanon: "TN",
  tn_gallatin: "TN",
  tn_cleveland: "TN",
  tn_goodlettsville: "TN",
  tn_white_house: "TN",
  tn_springfield: "TN",
  tn_wilson_county: "TN",
  tn_maury_county: "TN",
  tn_washington_county: "TN",
  tn_coffee_county: "TN",
  fl_pasco_county_bonfire: "FL",
  fl_indian_river_county_bonfire: "FL",
  fl_tallahassee_bonfire: "FL",
  fl_fau_bonfire: "FL",
  fl_ucf_bonfire: "FL",
  fl_lee_schools_bonfire: "FL",
  fl_sunrise_bonfire: "FL",
  fl_plantation_bonfire: "FL",
  fl_duval_schools_bonfire: "FL",
  fl_fgcu_bonfire: "FL",
  fl_jaxport_bonfire: "FL",
  fl_pensacola: "FL",
  fl_florida_city: "FL",
  fl_cocoa: "FL",
  fl_wellington: "FL",
  fl_miami_gardens: "FL",
  fl_casselberry: "FL",
  fl_new_smyrna_beach: "FL",
  fl_levy_county: "FL",
  in_indygo_bonfire: "IN",
  in_fort_wayne_schools_bonfire: "IN",
  in_crown_point: "IN",
  in_shelbyville: "IN",
  in_westfield: "IN",
  in_crawfordsville: "IN",
  tx_fort_worth_bonfire: "TX",
  tx_arlington_bonfire: "TX",
  tx_frisco_bonfire: "TX",
  tx_mckinney_bonfire: "TX",
  tx_richardson_bonfire: "TX",
  tx_round_rock_bonfire: "TX",
  tx_leander_bonfire: "TX",
  tx_temple_bonfire: "TX",
  tx_brownsville_bonfire: "TX",
  tx_amarillo_bonfire: "TX",
  tx_san_angelo_bonfire: "TX",
  tx_schertz_bonfire: "TX",
  tx_wylie_bonfire: "TX",
  tx_southlake_bonfire: "TX",
  tx_fort_bend_county_bonfire: "TX",
  tx_williamson_county_bonfire: "TX",
  tx_johnson_county_bonfire: "TX",
  tx_austin_isd_bonfire: "TX",
  tx_dallas_isd_bonfire: "TX",
  tx_northside_isd_bonfire: "TX",
  tx_san_antonio_isd_bonfire: "TX",
  tx_cypress_fairbanks_isd_bonfire: "TX",
  tx_fort_bend_isd_bonfire: "TX",
  tx_garland_isd_bonfire: "TX",
  tx_richardson_isd_bonfire: "TX",
  tx_klein_isd_bonfire: "TX",
  tx_hays_cisd_bonfire: "TX",
  tx_corpus_christi_isd_bonfire: "TX",
  tx_dfw_airport_bonfire: "TX",
  tx_lcra_bonfire: "TX",
  tx_san_antonio_river_authority_bonfire: "TX",
  tx_ntmwd_bonfire: "TX",
  tx_dart_bonfire: "TX",
  tx_ut_system_bonfire: "TX",
  tx_ut_austin_bonfire: "TX",
  tx_ut_dallas_bonfire: "TX",
  tx_utrgv_bonfire: "TX",
  tx_ut_health_san_antonio_bonfire: "TX",
  tx_tarrant_county_college_bonfire: "TX",
  tx_houston_city_college_bonfire: "TX",
  tx_del_mar_college_bonfire: "TX",
  tx_garland: "TX",
  tx_mesquite: "TX",
  tx_san_marcos: "TX",
  tx_killeen: "TX",
  tx_abilene: "TX",
  tx_missouri_city: "TX",
  tx_baytown: "TX",
  tx_pasadena: "TX",
  tx_friendswood: "TX",
  tx_texas_city: "TX",
  tx_lake_jackson: "TX",
  tx_victoria: "TX",
  tx_buda: "TX",
  tx_boerne: "TX",
  tx_universal_city: "TX",
  tx_kerrville: "TX",
  tx_fredericksburg: "TX",
  tx_mansfield: "TX",
  tx_cedar_hill: "TX",
  tx_desoto: "TX",
  tx_duncanville: "TX",
  tx_lancaster: "TX",
  tx_rowlett: "TX",
  tx_sachse: "TX",
  tx_murphy: "TX",
  tx_prosper: "TX",
  tx_little_elm: "TX",
  tx_the_colony: "TX",
  tx_flower_mound: "TX",
  tx_bedford: "TX",
  tx_haltom_city: "TX",
  tx_watauga: "TX",
  tx_azle: "TX",
  tx_weatherford: "TX",
  tx_granbury: "TX",
  tx_midlothian: "TX",
  tx_corsicana: "TX",
  tx_sherman: "TX",
  tx_denison: "TX",
  tx_texarkana: "TX",
  tx_marshall: "TX",
  tx_nacogdoches: "TX",
  tx_huntsville: "TX",
  tx_harker_heights: "TX",
  tx_copperas_cove: "TX",
  tx_taylor: "TX",
  tx_lakeway: "TX",
  tx_lockhart: "TX",
  tx_plainview: "TX",
  tx_borger: "TX",
  tx_port_arthur: "TX",
  tx_alvin: "TX",
  tx_angleton: "TX",
  tx_la_porte: "TX",
  tx_seabrook: "TX",
  tx_webster: "TX",
  tx_tomball: "TX",
  tx_bellaire: "TX",
  tx_rockport: "TX",
  tx_eagle_pass: "TX",
  tx_donna: "TX",
  tx_san_benito: "TX",
  tx_snyder: "TX",
  tx_brownwood: "TX",
  tx_stephenville: "TX",
  tx_mineral_wells: "TX",
  tx_jacksonville: "TX",
  tx_kilgore: "TX",
  tx_bexar_county: "TX",
  tx_smith_county: "TX",
  tx_hidalgo_county: "TX",
  tx_webb_county: "TX",
  tx_ellis_county: "TX",
  tx_kaufman_county: "TX",
  tx_rockwall_county: "TX",
  tx_randall_county: "TX",
  tx_midland_county: "TX",
  tx_ector_county: "TX",
  tx_chambers_county: "TX",
  tx_bowie_county: "TX",
  tx_henderson_county: "TX",
  tx_wise_county: "TX",
  tx_kendall_county: "TX",
  va_roanoke_county: "VA",
  va_spotsylvania_county: "VA",
  va_rockingham_county: "VA",
  va_warren_county: "VA",
  va_christiansburg: "VA",
  va_radford: "VA",
  va_campbell_county: "VA",
  va_amherst_county: "VA",
  va_franklin_county: "VA",
  va_henry_county: "VA",
  va_martinsville: "VA",
  va_bristol: "VA",
  va_wise_county: "VA",
  va_dinwiddie_county: "VA",
  va_falls_church: "VA",
  va_purcellville: "VA",
  va_warrenton: "VA",
  va_orange_county: "VA",
  va_caroline_county: "VA",
  va_norton: "VA",
  va_king_william_county: "VA",
  va_surry_county: "VA",
  va_mecklenburg_county: "VA",
  va_halifax_county: "VA",
  va_cumberland_county: "VA",
  va_appomattox_county: "VA",
  va_greene_county: "VA",
  va_madison_county: "VA",
  va_page_county: "VA",
  va_grayson_county: "VA",
  va_patrick_county: "VA",
  va_russell_county: "VA",
  va_dickenson_county: "VA",
  va_scott_county: "VA",
  va_ashland: "VA",
  va_wythe_county: "VA",
  va_bedford: "VA",
  va_woodstock: "VA",
  va_vinton: "VA",
  va_middleburg: "VA",
  va_fauquier_county_bonfire: "VA",
  va_fairfax_schools_bonfire: "VA",
  va_prince_william_schools_bonfire: "VA",
  va_cnu_bonfire: "VA",
  va_chesterfield_county_bonfire: "VA",
  va_loudoun_water_bonfire: "VA",
  va_arlington_schools_bonfire: "VA",
  ca_alhambra: "CA",
  ca_gilroy: "CA",
  ca_inglewood: "CA",
  ca_san_mateo: "CA",
  ca_moorpark: "CA",
  la_kenner: "LA",
  la_assumption_parish: "LA",
  la_bossier_city: "LA",
  la_lake_charles: "LA",
  la_baton_rouge: "LA",
  la_leesville: "LA",
  la_sulphur: "LA",
  la_st_james_parish: "LA",
  la_plaquemines_parish: "LA",
  la_st_bernard_parish: "LA",
  la_west_baton_rouge_parish: "LA",
  ca_lawa_bonfire: "CA",
  wa_marysville: "WA",
  wa_redmond: "WA",
  wa_bothell: "WA",
  wa_puyallup: "WA",
  wa_bremerton: "WA",
  wa_des_moines: "WA",
  wa_anacortes: "WA",
  wa_yakima_county: "WA",
  wa_franklin_county: "WA",
  wa_cowlitz_county: "WA",
  wa_grant_county: "WA",
  wa_clallam_county: "WA",
  wa_jefferson_county: "WA",
  id_idaho_falls: "ID",
  id_pocatello: "ID",
  id_kootenai_county: "ID",
  wa_spokane_valley: "WA",
  wa_pasco: "WA",
  wa_kennewick: "WA",
  wa_mount_vernon: "WA",
  wa_longview: "WA",
  wa_north_bend: "WA",
  wa_port_orchard: "WA",
  wa_burlington: "WA",
  wa_washougal: "WA",
  wa_ridgefield: "WA",
  wa_ellensburg: "WA",
  wa_west_richland: "WA",
  wa_cheney: "WA",
  wa_liberty_lake: "WA",
  wa_pierce_county: "WA",
  wa_snohomish_county: "WA",
  wa_island_county: "WA",
  wa_douglas_county: "WA",
  wa_adams_county: "WA",
  wa_asotin_county: "WA",
  id_twin_falls: "ID",
  id_lewiston: "ID",
  id_eagle: "ID",
  wy_laramie: "WY",
  wy_campbell_county: "WY",
  wy_albany_county: "WY",
  wy_green_river: "WY",
  wy_torrington: "WY",
  wy_carbon_county: "WY",
  wy_goshen_county: "WY",
  wa_vancouver_bonfire: "WA",
  id_ada_county_bonfire: "ID",
  wa_clark_county_bonfire: "WA",
  wa_renton_bonfire: "WA",
  wa_port_of_everett_bonfire: "WA",
  wa_tacoma_schools_bonfire: "WA",
  wa_lake_washington_schools_bonfire: "WA",
  wa_northshore_schools_bonfire: "WA",
  id_west_ada_schools_bonfire: "ID",
  nj_gloucester_county: "NJ",
  nj_passaic: "NJ",
  nj_freehold_township: "NJ",
  nj_orange: "NJ",
  nj_summit: "NJ",
  nj_jackson_township: "NJ",
  nj_asbury_park: "NJ",
  nj_willingboro: "NJ",
  nj_burlington_county: "NJ",
  nj_cape_may_county: "NJ",
  nj_hunterdon_county: "NJ",
  nj_elizabeth: "NJ",
  nj_woodbridge: "NJ",
  nj_toms_river: "NJ",
  nj_east_orange: "NJ",
  nj_north_brunswick: "NJ",
  nj_howell: "NJ",
  nj_randolph: "NJ",
  nj_roxbury: "NJ",
  nj_bloomfield: "NJ",
  nj_rahway: "NJ",
  nj_union_township: "NJ",
  nj_berkeley_township: "NJ",
  nj_long_branch: "NJ",
  nj_red_bank: "NJ",
  nj_paramus: "NJ",
  nj_moorestown: "NJ",
  nj_hmfa_bonfire: "NJ",
  nj_sussex_county_bonfire: "NJ",
  nj_ocean_county_college_bonfire: "NJ",
  nj_mcua_bonfire: "NJ",
  nj_raritan_valley_cc_bonfire: "NJ",
  nj_rcbc_bonfire: "NJ",
  md_howard_schools_bonfire: "MD",
  nv_clark_county_schools_bonfire: "NV",
  ca_ac_transit_bonfire: "CA",
  ca_sutter_county_bonfire: "CA",
  ca_ventura_county_bonfire: "CA",
  ca_elk_grove_schools_bonfire: "CA",
  ca_alameda_county_bonfire: "CA",
  ca_yolo_county_bonfire: "CA",
  ca_irvine_bonfire: "CA",
  ca_oakland_capital_bonfire: "CA",
  ca_westminster_bonfire: "CA",
  va_eva: "VA",
  tx_esbd: "TX",
  fl_mfmp: "FL",
  ca_eprocure: "CA",
  pa_dgs_emarketplace: "PA",
  co_vss: "CO",
  me_vss: "ME",
  oh_odot: "OH",
  va_vdot_cabb: "VA",
  la_dotd_lettings: "LA",
  nj_transit: "NJ",
  ny_nyscr: "NY",
  mi_sigma: "MI",
  ma_boston: "MA",
  ma_commbuys: "MA",
  nj_njstart: "NJ",
  pr_asg: "PR",
  il_bidbuy: "IL",
  or_oregonbuys: "OR",
  nv_nevadaepro: "NV",
  ar_arbuy: "AR",
  ga_gpr: "GA",
  wv_oasis: "WV",
  ky_vss: "KY",
  al_mobile: "AL",
  al_aldot: "AL",
  ak_dotpf: "AK",
  nc_evp: "NC",
  nc_gastonia: "NC", // City of Gastonia Bids & RFPs page (owner 2026-10-12)
  nc_wayne_county: "NC", // Wayne County official public board
  nc_gaston_county: "NC", // Gaston County CivicEngage board (owner 2026-10-12)
  dc_pass: "DC",
  al_birmingham_purchasing: "AL",
  de_mmp: "DE",
  sc_scbo: "SC",
  ia_das: "IA",
  la_lapac: "LA",
  in_idoa: "IN",
  mt_emacs: "MT",
  vt_vbr: "VT",
  tn_cpo: "TN",
  ne_das: "NE",
  ne_omaha_ionwave: "NE",
  mo_movers: "MO",
  ct_webprocure: "CT",
  az_app: "AZ",
  wa_webs: "WA",
  ut_bonfire: "UT",
  ms_dfa: "MS",
  mn_mndot: "MN",
  mn_connex: "MN",
  mn_questcdn: "MN",
  ok_omes: "OK",
  ks_sok: "KS",
  nm_epronm: "NM",
  id_ipro: "ID",
  id_itd: "ID",
  // Wisconsin DOA VendorNet Bids (src/jobs/sources/wi-vendornet.ts): the Wisconsin
  // Department of Administration's own statewide board, so every buyer publishing
  // through it is a Wisconsin public body — provable by construction, never
  // text-derived from the free-text buyer string (policy R7).
  wi_vendornet: "WI",
  // Texas Bonfire tenants (src/jobs/sources/tx-txdot-bonfire.ts /
  // tx-uttyler-bonfire.ts): each is a Texas public body's OWN portal on
  // bonfirehub.com, so every buyer publishing through it is a Texas public body
  // — provable by construction, never text-derived from the free-text department
  // label (policy R7; TxDOT's portal renders internal codes such as "SSD_CM").
  tx_txdot_bonfire: "TX",
  tx_uttyler_bonfire: "TX",
  tx_dallas_bonfire: "TX", // City of Dallas Bonfire portal (owner 2026-10-12)
  // Texas university JAGGAER tenants (src/jobs/sources/tx-uh-jaggaer.ts,
  // tx-tamu-jaggaer.ts, tx-texastech-jaggaer.ts, tx-utsa-jaggaer.ts): each is a
  // Texas public university's OWN portal on bids.sciquest.com, so every buyer
  // publishing through it is a Texas public body — provable by construction, never
  // text-derived from the free-text buyer name (policy R7; TAMU's portal carries
  // system-unit codes such as "TAMUG" and "AG-RSCH" in its event numbers).
  va_vt_jaggaer: "VA",
  va_gmu_bonfire: "VA",
  va_nsu_bonfire: "VA",
  tx_uh_jaggaer: "TX",
  tx_tamu_jaggaer: "TX",
  tx_texastech_jaggaer: "TX",
  tx_utsa_jaggaer: "TX",
  // Rhode Island (owner 2026-10-06): both boards are run by the RI Division of
  // Purchases and list only Rhode Island public buyers.
  ri_osp: "RI",
  ri_external: "RI",
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
 *   normalized_state    — `resolveRowGeography(location, agency).state` (the
 *       SHARED resolver the read path buckets with): performance location
 *       first, then the curated state-body agency rule, then buyer/agency text
 *       for a location that names no state; a NATIONAL-SCOPE location
 *       ("United States"/"RC"/…) never takes a state. NULL when nothing proves
 *       one.
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
  // S3 WRITE-PATH MIRROR (owner-approved 2026-09-23, Q2 = YES, D9/D10): the
  // stored geography now comes from the SAME shared resolver the read path's
  // bucket uses (`matchGeographyBucket` / `geoRelevant`), so the stored
  // snapshot can no longer diverge from Radar. Two concrete consequences:
  //   * a NATIONAL-SCOPE location ("United States", "RC", "Multiple locations",
  //     …) no longer borrows a state from the buyer/agency string — the write
  //     path refuses exactly what `isNationalScope` refuses on read. This is
  //     what removes the 45-to-59-cell stored-local-only divergence class;
  //   * the curated state-body agency rule (OH-ARNG) still resolves, and the
  //     curated SOURCE_HOME_JURISDICTIONS pins (pennbid PA / va_evirginia VA /
  //     oh_dayton OH) still override `source_jurisdiction` — both unchanged.
  // The foreign-POP guard stays as an OUTER, deliberately-stricter step (it can
  // only SUPPRESS a state the resolver would derive from the agency TEXT, never
  // from the row's own place of performance), so the write path can never store
  // a state the read path then refuses. NEW ROWS ONLY — no legacy relabel.
  const geo = resolveRowGeography({ location: args.location, agency: args.agency });
  const normalized_state = foreignPop ? resolveStateFromText(args.location) : geo.state;
  const curated = SOURCE_HOME_JURISDICTIONS[args.sourceName];
  const source_jurisdiction = curated ?? normalized_state;
  const location_conflict = normalized_state
    ? locationConflict(args.title, args.description, normalized_state)
    : null;
  return { source_jurisdiction, raw_location, normalized_state, location_conflict };
}
