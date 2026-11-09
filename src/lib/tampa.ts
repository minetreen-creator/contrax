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
