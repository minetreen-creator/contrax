/**
 * Tampa Contractor Support Network (owner 2026-11-09): Tampa Bay = Hillsborough, Pinellas, Pasco
 * and Hernando counties. Housing referral partner: Casa Blue Collar (90-day trial, owner-arranged).
 * Contrax shows the partner to contractors who visit; it contacts no one. PURE.
 */

/** Places whose bids count as Tampa Bay (matched in a bid's location or agency, lower-cased). */
export const TAMPA_PLACES = [
  "tampa", "st. petersburg", "st petersburg", "saint petersburg", "clearwater", "largo", "brandon", "plant city", "temple terrace",
  "pinellas", "hillsborough", "pasco", "hernando", "macdill", "new port richey", "dade city", "brooksville", "tarpon springs",
  "dunedin", "oldsmar", "wesley chapel", "zephyrhills", "riverview", "ruskin", "apollo beach", "port richey",
] as const;

/** Only "Florida"/"FL" (or names found nowhere else) prove Florida: Clearwater, Brandon, Pasco and Hillsborough exist in other states. */
const FLORIDA_HINT = /\bFL\b|florida|\btampa\b|macdill|pinellas/i;
/** Florida places that contain a Tampa Bay name but are elsewhere in the state. */
const NOT_TAMPA = /key largo|miami|largo, md/i;

/** Whether a bid is in Tampa Bay (a Tampa Bay place and proof of Florida, so "Brandon, MS" stays out). PURE. */
export function isTampaBay(location: string | null, agency: string | null): boolean {
  const text = `${location ?? ""} ${agency ?? ""}`;
  const lower = text.toLowerCase();
  return TAMPA_PLACES.some((p) => lower.includes(p)) && FLORIDA_HINT.test(text) && !NOT_TAMPA.test(text);
}

const BUILD_WORK = /construct|renovat|hvac|mechanical|electric|plumb|roof|paving|resurfac|building|repair|maintenance|chiller|boiler|demolition|concrete|drainage|water main|sewer|facilit/i;

/** Whether a bid title is construction, trade or facility work (what traveling crews do). PURE. */
export const isBuildWork = (title: string) => BUILD_WORK.test(title);

export const CASA = {
  name: "Casa Blue Collar",
  /** UTM tags let Casa count the bookings Contrax sends. */
  url: "https://casabluecollar.com/?utm_source=contrax&utm_medium=referral&utm_campaign=tampa_contractors",
} as const;

export const TAMPA_PATH = "/tampa-contractors";

/**
 * City of Tampa facts (read 2026-11-09). Federal: USAspending.gov contract awards with place of
 * performance in Tampa, FY2026 (Oct 2025 - Sep 2026), NAICS 23; "out of state" = the company's
 * registered address is outside Florida. Registered: SAM.gov public extract, Tampa addresses.
 */
export const TAMPA_FACTS = {
  asOf: "FY2026 (Oct 2025 – Sep 2026)",
  federalConstruction: "$94.5M",
  outOfStateShare: "83%",
  outOfStateFirms: 26,
  endingSoonCount: 38,
  endingSoonValue: "$133.4M",
  registeredContractors: 369,
  source: "USAspending.gov federal awards and SAM.gov registrations",
} as const;

/** Tampa Bay cities as SAM.gov registrations spell them (lower-cased compare). */
export const TAMPA_BAY_CITIES = [
  "tampa", "st petersburg", "st. petersburg", "saint petersburg", "clearwater", "largo", "brandon", "plant city", "temple terrace",
  "riverview", "ruskin", "apollo beach", "valrico", "seffner", "lutz", "land o lakes", "land o' lakes", "wesley chapel", "zephyrhills",
  "new port richey", "port richey", "holiday", "hudson", "spring hill", "brooksville", "dade city", "tarpon springs", "palm harbor",
  "dunedin", "oldsmar", "safety harbor", "seminole", "pinellas park", "odessa", "gibsonton", "thonotosassa", "dover", "lithia", "wimauma", "sun city center",
] as const;

/** The trades a Tampa construction job needs subs for. */
export const TAMPA_SUB_TRADES = ["construction", "hvac", "electrical"];
