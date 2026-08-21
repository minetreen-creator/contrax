/**
 * NAICS heuristic tagging for bids that arrive without an explicit NAICS code.
 *
 * `bids.naics_code` is authoritative only for SAM.gov-family sources. State
 * keyword, city, and open-data-portal sources store NULL. This module infers a
 * conservative, HIGH-PRECISION 6-digit NAICS code from a bid's title +
 * description so trade/code filters (e.g. "238220" for HVAC/plumbing) match
 * those rows too — WITHOUT ever fabricating a label.
 *
 * Honesty contract (non-negotiable):
 *   - Only a SINGLE unambiguous winner is returned. Ambiguous / multi-code /
 *     generic-only inputs return `null` (the row stays NULL).
 *   - No catch-all "Other" bucket. If we cannot be confident, we stay silent.
 *   - Returned code is a strict 6-digit string (or null). Never a delimited
 *     multi-code list (would break the SEO route's exact `=` match and the
 *     `keywordPred` substring semantics).
 *   - Ingest code only fills NULL (inference never overwrites an authoritative
 *     source-provided code — see runner.ts COALESCE guard).
 *
 * Signal strength: an explicit "NAICS <6-digit>" in the text is the strongest
 * and most honest signal (the bid literally names its own code). Otherwise a
 * title keyword hit is strong; ≥2 distinct description keyword hits or one
 * high-precision description hit qualify. A lone generic word
 * (construction/maintenance/services) never classifies on its own.
 */

import { NAICS_NAMES } from "~/lib/naics-names";

/** A NAICS code and the keywords that unmistakeably point at it. */
export interface NaicsEntry {
  title: string;
  keywords: string[];
}


/**
 * Curated high-precision synonyms for the highest-value verticals. Codes not
 * overridden here still get keywords derived from their official NAICS title
 * (see deriveKeywords), so every NAICS_NAMES code is representable.
 */
const KEYWORD_OVERRIDES: Record<string, string[]> = {
  // ── Construction & specialty trades ──────────────────────────────────────
  "236118": ["remodel", "remodeling", "residential remodel"],
  "236210": ["industrial construction"],
  "236220": ["commercial construction", "new commercial"],
  "237110": ["water main", "sewer line", "sewer", "water line", "waterline", "storm drain", "utility line construction"],
  "237130": ["power line", "communication line", "utility line construction", "electric utility"],
  "237310": ["highway", "bridge", "roadway", "asphalt", "paving", "road construction", "pavement", "street construction"],
  "237990": ["heavy civil", "civil construction", "marine construction", "dredging"],
  "238110": ["poured concrete", "concrete", "concrete work", "structural concrete"],
  "238120": ["structural steel", "steel erection", "ironwork", "structural steel fabrication", "erection"],
  "238140": ["masonry", "brickwork", "brick", "block work", "stone masonry"],
  "238150": ["glass", "glazing", "glazier"],
  "238160": ["roofing", "roof", "roof replacement", "shingle", "roofer"],
  "238210": ["electrical", "electrician", "electrical wiring", "wiring", "electrical systems"],
  "238220": ["plumbing", "plumber", "hvac", "hvacr", "heating", "ventilation", "air conditioning", "air-conditioning", "mechanical", "boiler", "chiller", "duct", "mechanical contractor"],
  "238290": ["elevator", "elevator installation", "escalator"],
  "238310": ["drywall", "drywall installation", "sheetrock"],
  "238320": ["painting", "painter", "paint", "coatings"],
  "238330": ["flooring", "floor covering", "floor installation", "terrazzo"],
  "238340": ["tile", "tile installation", "ceramic tile"],
  "238350": ["finish carpentry", "carpentry", "woodwork", "trim carpentry"],
  "238390": ["finishing", "fireproofing", "insulation contractor"],
  "238910": ["excavation", "excavating", "earthwork", "site preparation", "site prep", "grading", "demolition", "land clearing"],
  "238990": ["specialty contractor", "utility contractor", "welding contractor"],
  // ── Professional, scientific, technical ─────────────────────────────────
  "541310": ["architecture", "architect", "architectural"],
  "541330": ["engineering", "engineer", "engineering services", "civil engineering"],
  "541360": ["geophysical", "surveying"],
  "541370": ["mapping", "surveying", "land survey", "geospatial", "aerial survey"],
  "541380": ["testing laboratory", "laboratory testing", "materials testing", "testing services"],
  "541430": ["graphic design", "graphic", "design services"],
  "541511": ["custom software", "software development", "programming", "software engineering", "custom programming"],
  "541512": ["computer systems", "systems design", "it consulting", "information technology", "it services", "network design"],
  "541513": ["computer facilities", "it infrastructure", "data center", "facilities management"],
  "541519": ["computer services", "it support", "it services", "technology services"],
  "541611": ["management consulting", "business consulting", "administrative consulting"],
  "541612": ["human resources", "hr consulting", "recruiting consulting"],
  "541613": ["marketing consulting", "marketing services", "branding"],
  "541618": ["business consulting", "strategy consulting"],
  "541620": ["environmental consulting", "environmental services", "environmental assessment"],
  "541690": ["scientific consulting", "technical consulting", "research services"],
  "541720": ["social science", "research", "survey research", "policy research"],
  "541810": ["advertising agency", "advertising"],
  "541850": ["display advertising", "digital advertising"],
  "541930": ["translation", "interpretation", "interpreter", "translation services"],
  // ── Administrative, support, facilities ────────────────────────────────
  "561110": ["office administrative", "administrative services", "office services", "administrative support"],
  "561210": ["facilities support", "facilities management", "building maintenance", "janitorial management", "integrated facilities"],
  "561312": ["executive search", "recruiting", "recruitment"],
  "561320": ["temporary help", "temporary staffing", "temp agency"],
  "561410": ["document preparation", "document services", "copy"],
  "561440": ["collection agency", "debt collection", "collections"],
  "561510": ["travel agency", "travel services"],
  "561590": ["travel arrangement", "event planning", "meeting planning"],
  "561612": ["security guard", "guards", "patrol", "security personnel", "armed guard"],
  "561621": ["security system", "security systems", "access control", "cctv", "surveillance", "alarm system", "video surveillance"],
  "561710": ["pest control", "exterminat", "termite", "rodent control", "pest management"],
  "561720": ["janitorial", "custodial", "cleaning", "janitor", "housekeeping", "floor cleaning", "office cleaning"],
  "561730": ["landscaping", "lawn", "grounds maintenance", "grounds keeping", "snow removal", "landscape", "landscaper"],
  "561740": ["carpet cleaning", "upholstery", "upholstery cleaning"],
  "561790": ["building maintenance", "exterior cleaning", "power washing", "window cleaning", "pressure washing"],
  "561910": ["packaging", "labeling", "packaging services"],
  "561920": ["trade show", "convention", "exhibit"],
  // ── Waste ────────────────────────────────────────────────────────────────
  "562111": ["solid waste", "waste collection", "trash", "garbage", "refuse", "rubbish", "waste hauling"],
  "562212": ["landfill"],
  "562219": ["nonhazardous waste", "non-hazardous waste", "waste disposal"],
  "562910": ["remediation", "environmental remediation", "asbestos abatement", "contaminated soil", "hazmat cleanup", "site remediation"],
  "562920": ["recycling", "materials recovery", "recyclable"],
  // ── Education, health, social ────────────────────────────────────────────
  "611310": ["college", "university", "higher education"],
  "611430": ["training", "professional development", "workforce training", "vocational training"],
  "611710": ["educational support", "tutoring", "education services", "after school"],
  "621111": ["physician", "medical practice", "doctor", "primary care", "family medicine"],
  "621210": ["dentist", "dental", "dentistry"],
  "621330": ["mental health", "counseling", "therapy", "behavioral health"],
  "621498": ["outpatient", "clinic", "medical clinic"],
  "621511": ["medical laboratory", "lab testing", "clinical laboratory", "diagnostic laboratory"],
  "621610": ["home health", "home care", "home healthcare", "home health care"],
  "621999": ["ambulatory", "health care services", "medical services"],
  "622110": ["hospital", "medical center", "surgical hospital"],
  "622310": ["psychiatric", "substance abuse", "rehabilitation hospital"],
  "623110": ["nursing care", "nursing home", "skilled nursing"],
  "623220": ["residential mental health", "substance abuse facility"],
  "624120": ["elderly", "aging services", "disabilities", "home delivered meals", "senior services"],
  "624190": ["family services", "social services", "case management", "community services"],
  "624230": ["emergency relief", "disaster relief", "emergency services"],
  "624310": ["vocational rehabilitation", "job training", "rehabilitation services"],
  // ── Transportation, warehousing, utilities ──────────────────────────────
  "484121": ["truckload", "freight", "trucking", "long haul"],
  "484122": ["less than truckload", "ltl", "freight shipping"],
  "488119": ["airport operations", "airport"],
  "493110": ["warehousing", "warehouse", "storage", "distribution center"],
  "517111": ["wired telecommunications", "telecom", "telecommunications", "fiber"],
  "517312": ["wireless", "telecommunications", "cellular", "mobile network"],
  "517919": ["telecommunications", "network services", "voip"],
  "518210": ["data processing", "hosting", "cloud", "data center", "it hosting"],
  // ── Repair & maintenance ─────────────────────────────────────────────────
  "811210": ["electronics repair", "electronic repair", "refurbishment", "electronics"],
  "811310": ["machinery repair", "equipment repair", "machine repair", "tool repair", "equipment maintenance"],
  // ── Public administration / protection ──────────────────────────────────
  "922160": ["fire protection", "fire suppression", "sprinkler", "fire alarm", "firefighting", "fire services"],
  "928110": ["national security", "defense", "military"],
};

/**
 * Keyword derivation from raw NAICS titles is deliberately DISABLED (returns
 * nothing). Verbose manufacturing/administration titles decompose into generic,
 * low-precision words ("search", "system", "equipment", "monitoring",
 * "manufacturing") that produced widespread false positives when used as
 * classifiers. Only the curated high-precision override lists classify — a code
 * present in the map with no curated synonyms simply never tags (stays NULL),
 * which is the correct conservative behavior. The full title list still lives
 * here so a future curator can add precise synonyms for more codes.
 */
function deriveKeywords(_title: string): string[] {
  return [];
}

/**
 * The full inference keyword map: every NAICS_NAMES code represented, with
 * curated synonyms for the high-value verticals.
 */
export const NAICS_INFER_MAP: Record<string, NaicsEntry> = Object.fromEntries(
  Object.entries(NAICS_NAMES).map(([code, title]) => [
    code,
    {
      title,
      keywords: KEYWORD_OVERRIDES[code] ?? deriveKeywords(title),
    },
  ]),
);

/** Compiled-regex cache — keywordIn is called O(codes × keywords × rows) on
 * backfill, so compiling each keyword once (instead of per call) matters a lot
 * for the 17k-row scan. */
const REGEX_CACHE = new Map<string, RegExp>();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word/phrase-boundary, case-insensitive match. Requires a non-alphanumeric
 * boundary on each side so "air conditioning" matches a phrase and "painting"
 * does not match inside "repainting". */
function keywordIn(text: string, keyword: string): boolean {
  let re = REGEX_CACHE.get(keyword);
  if (!re) {
    re = new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`,
      "i",
    );
    REGEX_CACHE.set(keyword, re);
  }
  return re.test(text);
}

/** Explicit "NAICS <6-digit>" mention — the strongest, literal signal. Returns
 * the code only when exactly ONE unique 6-digit code is named (multiple or
 * conflicting → ambiguous → null). */
function explicitNaics(text: string): string | null {
  const codes = new Set<string>();
  let m: RegExpExecArray | null;
  const re = /naics[^0-9]{0,20}(\d{6})/gi;
  while ((m = re.exec(text)) !== null) {
    codes.add(m[1]);
  }
  if (codes.size !== 1) return null;
  const [code] = codes;
  return /^\d{6}$/.test(code) ? code : null;
}

/**
 * Infer a single authoritative-looking 6-digit NAICS code for a bid, or return
 * null when no confident, unambiguous classification exists.
 *
 * @param title       title text (strong-signal surface)
 * @param description description text (weaker-signal surface)
 */
export function inferNaics(
  title: string | null | undefined,
  description: string | null | undefined,
): string | null {
  const titleTxt = (title ?? "").toLowerCase();
  const descTxt = (description ?? "").toLowerCase();

  // 1. Explicit "NAICS <code>" beats everything and cannot fabricate.
  const explicit = explicitNaics(`${titleTxt} ${descTxt}`);
  if (explicit) return explicit;

  // 2. Keyword scoring across all representable codes.
  const scored = new Map<string, number>();
  for (const [code, entry] of Object.entries(NAICS_INFER_MAP)) {
    let titleHits = 0;
    let descHits = 0;
    for (const kw of entry.keywords) {
      if (kw.length < 2) continue;
      const hitTitle = keywordIn(titleTxt, kw);
      const hitDesc = keywordIn(descTxt, kw);
      if (hitTitle) titleHits++;
      if (hitDesc) descHits++;
    }
    const distinct = titleHits + descHits;
    // Strict qualification bar:
    //   - a title hit (the title is a strong, substantive signal), OR
    //   - ≥2 DISTINCT keyword hits across title+description (corroborated).
    // A SINGLE description-only keyword hit NEVER qualifies on its own — even a
    // nominally "specific" word (hospital, defense, research, training) more
    // often turns up in agency names / boilerplate than as the actual service,
    // and empirical dry-runs confirmed it produced false positives (a lighting
    // job at a VA hospital labeled "hospitals", a bathroom renovation labeled
    // "national security"). Corroboration is the honest floor.
    const qualifies = titleHits >= 1 || distinct >= 2;
    if (!qualifies) continue;
    scored.set(code, 2 * titleHits + descHits);
  }

  if (scored.size === 0) return null;

  // 3. Single unambiguous winner: unique max score, clearly above all others.
  let winner: string | null = null;
  let maxScore = -1;
  let tied = false;
  for (const [code, score] of scored) {
    if (score > maxScore) {
      maxScore = score;
      winner = code;
      tied = false;
    } else if (score === maxScore) {
      tied = true;
    }
  }
  if (tied || winner === null) return null;

  // Strict-bar safety: the winner must clear the qualification threshold as a
  // bare minimum (defensive — qualification already guarantees this).
  if (maxScore < 1) return null;

  return winner;
}
