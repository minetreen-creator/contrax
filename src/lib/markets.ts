/**
 * Contractor Support Network markets (owner 2026-11-10: "replicate this model in other major
 * construction markets"). One template: open local bids (live), registered subs (live, SAM.gov), the
 * market's federal construction numbers (USAspending.gov, read 2026-11-10), and a partner slot that
 * stays empty until a real partner signs. Tampa is the first market.
 * Contrax contacts no one from these pages. PURE.
 */
import { TAMPA_BAY_CITIES, TAMPA_FACTS, TAMPA_PATH, TAMPA_PLACES, TAMPA_SUB_TRADES } from "~/lib/tampa";

export interface MarketFacts {
  /** What the federal numbers cover ("City of Tampa", "San Diego County"). */
  scope: string;
  asOf: string;
  federalConstruction: string;
  outOfStateShare: string;
  outOfStateFirms: number;
  endingSoonCount: number;
  endingSoonValue: string;
  topBuyers: string[];
  /** Static count where we measured it (Tampa); other markets show the live SAM.gov count. */
  registeredContractors?: number;
  source: string;
}

export interface HousingPartner {
  kind: "housing";
  name: string;
  url: string;
  tagline: string;
  pitch: string;
  phone: string;
  tel: string;
  spanish?: string;
  amenities: readonly string[];
  stats: readonly { value: string; label: string }[];
  proof?: string;
  ask: string;
  /** The partner's own savings claim, footnoted with priceNote. */
  saving?: string;
  priceNote?: string;
  /** The funnel event each click is counted under (Tampa keeps its original name). */
  clickEvent: string;
  /** When the partnership started, for the click report. */
  since: string;
}

export interface Market {
  slug: string;
  /** "Tampa", "Hampton Roads". */
  name: string;
  path: string;
  stateCode: string;
  stateName: string;
  /** "Hillsborough, Pinellas, Pasco and Hernando". */
  areaLabel: string;
  /** Place names matched in a bid's location or agency (lower-cased). */
  places: readonly string[];
  /** Proof the bid is in this state, so "Portsmouth, NH" or "Selma, AL" stay out. */
  stateHint: RegExp;
  /** Look-alikes inside the state or elsewhere that must not count. */
  notHere?: RegExp;
  /** City names as SAM.gov registrations spell them (lower-cased compare). */
  subCities: readonly string[];
  subTrades: string[];
  facts: MarketFacts;
  partner: HousingPartner | null;
}

const FED_SOURCE = "USAspending.gov federal awards (place of performance in the market, FY2026, construction NAICS 23)";

export const TAMPA_MARKET: Market = {
  slug: "tampa",
  name: "Tampa",
  path: TAMPA_PATH,
  stateCode: "FL",
  stateName: "Florida",
  areaLabel: "Hillsborough, Pinellas, Pasco and Hernando",
  places: TAMPA_PLACES,
  stateHint: /\bFL\b|florida|\btampa\b|macdill|pinellas/i,
  notHere: /key largo|miami|largo, md/i,
  subCities: TAMPA_BAY_CITIES,
  subTrades: TAMPA_SUB_TRADES,
  facts: {
    scope: "City of Tampa",
    asOf: TAMPA_FACTS.asOf,
    federalConstruction: TAMPA_FACTS.federalConstruction,
    outOfStateShare: TAMPA_FACTS.outOfStateShare,
    outOfStateFirms: TAMPA_FACTS.outOfStateFirms,
    endingSoonCount: TAMPA_FACTS.endingSoonCount,
    endingSoonValue: TAMPA_FACTS.endingSoonValue,
    topBuyers: ["Veterans Affairs ($45.0M)", "Army ($38.3M)"],
    registeredContractors: TAMPA_FACTS.registeredContractors,
    source: TAMPA_FACTS.source,
  },
  // Owner 2026-11-14: the Tampa housing partnership ended; no partner is shown.
  partner: null,
};

export const HAMPTON_ROADS_MARKET: Market = {
  slug: "hampton-roads",
  name: "Hampton Roads",
  path: "/markets/hampton-roads",
  stateCode: "VA",
  stateName: "Virginia",
  areaLabel: "Norfolk, Virginia Beach, Chesapeake, Portsmouth, Suffolk, Hampton and Newport News",
  places: ["norfolk", "virginia beach", "chesapeake", "portsmouth", "suffolk", "hampton", "newport news", "williamsburg", "james city", "york county", "yorktown", "poquoson", "fort eustis", "langley", "oceana", "little creek", "dam neck"],
  stateHint: /\bVA\b|virginia/i,
  notHere: /west virginia|new hampshire|\bNH\b|portsmouth, (?:oh|ri)|suffolk county/i,
  subCities: ["norfolk", "virginia beach", "chesapeake", "portsmouth", "suffolk", "hampton", "newport news", "williamsburg", "yorktown", "poquoson", "smithfield", "carrollton", "seaford", "grafton", "toano", "gloucester"],
  subTrades: ["construction", "hvac", "electrical"],
  facts: {
    scope: "Hampton Roads (Norfolk, Virginia Beach, Chesapeake, Portsmouth, Suffolk, Hampton, Newport News, Williamsburg, York and James City counties)",
    asOf: "FY2026 (Oct 2025 – Sep 2026)",
    federalConstruction: "$798.4M",
    outOfStateShare: "31%",
    outOfStateFirms: 121,
    endingSoonCount: 128,
    endingSoonValue: "$877.9M",
    topBuyers: ["Navy ($641.3M)", "Veterans Affairs ($60.3M)", "Air Force ($31.6M)"],
    source: FED_SOURCE,
  },
  partner: null,
};

export const SAN_DIEGO_MARKET: Market = {
  slug: "san-diego",
  name: "San Diego",
  path: "/markets/san-diego",
  stateCode: "CA",
  stateName: "California",
  areaLabel: "San Diego County",
  places: ["san diego", "chula vista", "oceanside", "escondido", "carlsbad", "el cajon", "san marcos", "encinitas", "national city", "la mesa", "santee", "poway", "coronado", "imperial beach", "lemon grove", "solana beach", "camp pendleton", "miramar", "point loma", "otay"],
  stateHint: /\bCA\b|california|san diego/i,
  notHere: /san marcos, tx|texas/i,
  subCities: ["san diego", "chula vista", "oceanside", "escondido", "carlsbad", "el cajon", "vista", "san marcos", "encinitas", "national city", "la mesa", "santee", "poway", "coronado", "imperial beach", "lemon grove", "del mar", "solana beach", "ramona", "spring valley", "lakeside", "fallbrook", "alpine", "bonita", "la jolla"],
  subTrades: ["construction", "hvac", "electrical"],
  facts: {
    scope: "San Diego County",
    asOf: "FY2026 (Oct 2025 – Sep 2026)",
    federalConstruction: "$2.65B",
    outOfStateShare: "85%",
    outOfStateFirms: 70,
    endingSoonCount: 148,
    endingSoonValue: "$1.04B",
    topBuyers: ["Customs and Border Protection ($1.50B)", "Navy ($524.5M)", "International Boundary and Water Commission ($492.3M)"],
    source: FED_SOURCE,
  },
  partner: null,
};

export const SAN_ANTONIO_MARKET: Market = {
  slug: "san-antonio",
  name: "San Antonio",
  path: "/markets/san-antonio",
  stateCode: "TX",
  stateName: "Texas",
  areaLabel: "Bexar County",
  places: ["san antonio", "bexar", "lackland", "randolph", "fort sam houston", "converse", "live oak", "universal city", "schertz", "helotes", "leon valley", "kirby", "windcrest", "alamo heights", "castle hills", "balcones heights"],
  stateHint: /\bTX\b|texas|san antonio|bexar/i,
  notHere: /randolph county|randolph, (?:ma|nj|vt)/i,
  subCities: ["san antonio", "converse", "live oak", "universal city", "schertz", "helotes", "leon valley", "selma", "kirby", "windcrest", "alamo heights", "castle hills", "balcones heights", "cibolo", "von ormy", "adkins", "elmendorf", "china grove", "somerset"],
  subTrades: ["construction", "hvac", "electrical"],
  facts: {
    scope: "Bexar County (San Antonio)",
    asOf: "FY2026 (Oct 2025 – Sep 2026)",
    federalConstruction: "$250.6M",
    outOfStateShare: "76%",
    outOfStateFirms: 79,
    endingSoonCount: 62,
    endingSoonValue: "$400.2M",
    topBuyers: ["Air Force ($109.3M)", "Army ($107.7M)", "Veterans Affairs ($23.1M)"],
    source: FED_SOURCE,
  },
  partner: null,
};

export const MARKETS: readonly Market[] = [TAMPA_MARKET, HAMPTON_ROADS_MARKET, SAN_DIEGO_MARKET, SAN_ANTONIO_MARKET];

export const marketBySlug = (slug: string): Market | undefined => MARKETS.find((m) => m.slug === slug);

/** Whether a bid is in the market: a market place name, proof of the state, and no look-alike. PURE. */
export function inMarket(m: Pick<Market, "places" | "stateHint" | "notHere">, location: string | null, agency: string | null): boolean {
  const text = `${location ?? ""} ${agency ?? ""}`;
  const lower = text.toLowerCase();
  return m.places.some((p) => lower.includes(p)) && m.stateHint.test(text) && !(m.notHere?.test(text) ?? false);
}

/** "Network" name shown on the page ("Tampa Contractor Support Network"). PURE. */
export const networkName = (m: Pick<Market, "name">) => `${m.name} Contractor Support Network`;

export const marketPitchPath = (m: Pick<Market, "slug">) => `/markets/${m.slug}/partners`;

export const PARTNER_CONTACT = "contrax.companyllc@gmail.com";

/**
 * Partner terms (owner 2026-11-11: "yes do that"). A trial at no cost, then a flat monthly fee per
 * market, month to month. Flat, not per booking: Contrax can count the clicks and calls it sends, but
 * bookings happen between the partner and the contractor. Said the same way on the pitch page and in
 * the owner's emails.
 */
export const PARTNER_TRIAL_DAYS = 60;
export const PARTNER_MONTHLY_FEE = 99;
export const PARTNER_TERMS = `A ${PARTNER_TRIAL_DAYS}-day trial at no cost. After that it is $${PARTNER_MONTHLY_FEE} a month for each market, month to month, and only if it is working for you. No long contract.`;

/**
 * The pitch page shows the Tampa result only once this many different people have reached the Tampa
 * partner (owner 2026-11-11: "hide it", when it read "5 times (2 different people)" beside a $99 ask).
 * It comes back on its own when the number is worth showing. PURE.
 */
export const PARTNER_PROOF_MIN_PEOPLE = 25;
export const showPartnerProof = (visitors: number) => visitors >= PARTNER_PROOF_MIN_PEOPLE;
