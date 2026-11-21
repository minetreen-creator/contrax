/**
 * A place typed into the trade box (owner 2026-11-21: a Florida visitor searched
 * "Jacksonville concrete", got "0 matches", and only found the 129 Florida bids after
 * retyping). The box treated the whole text as one trade name. This takes the place off
 * the front or the end, keeps the trade, and gives back the state the place is in. PURE.
 *
 * Nothing changes unless what is left over is a trade the registry knows, so "mobile
 * home" or a company name is searched exactly as typed.
 */
import { STATE_NAMES } from "./contract-map";
import { normalizeStateInput } from "./location-state";
import { isKnownTrade } from "./trade-input";

/**
 * Large cities whose name points at one state. Names shared by big cities in two states
 * (Springfield, Arlington, Kansas City, Charleston, Columbia, Aurora, Glendale, Wilmington,
 * Rochester, Portland ME/OR is settled for Oregon by size) are left out unless one is
 * clearly the larger. Names that are also everyday words (Mobile, Reading, Orange) are out.
 */
const CITY_STATE: Record<string, string> = {
  "new york city": "NY", nyc: "NY", brooklyn: "NY", buffalo: "NY", albany: "NY", syracuse: "NY", yonkers: "NY",
  "los angeles": "CA", "san diego": "CA", "san jose": "CA", "san francisco": "CA", fresno: "CA", sacramento: "CA",
  "long beach": "CA", oakland: "CA", bakersfield: "CA", anaheim: "CA", stockton: "CA", irvine: "CA", "santa ana": "CA",
  chicago: "IL", naperville: "IL", joliet: "IL",
  houston: "TX", "san antonio": "TX", dallas: "TX", austin: "TX", "fort worth": "TX", "el paso": "TX", "corpus christi": "TX",
  plano: "TX", lubbock: "TX", laredo: "TX", amarillo: "TX", waco: "TX", mcallen: "TX",
  phoenix: "AZ", tucson: "AZ", mesa: "AZ", chandler: "AZ", scottsdale: "AZ", tempe: "AZ",
  philadelphia: "PA", pittsburgh: "PA", allentown: "PA", harrisburg: "PA", erie: "PA",
  jacksonville: "FL", miami: "FL", tampa: "FL", orlando: "FL", "st petersburg": "FL", "st. petersburg": "FL",
  hialeah: "FL", tallahassee: "FL", "fort lauderdale": "FL", "cape coral": "FL", "port st lucie": "FL", "port st. lucie": "FL",
  pensacola: "FL", gainesville: "FL", sarasota: "FL", "fort myers": "FL", "west palm beach": "FL", daytona: "FL", "daytona beach": "FL",
  columbus: "OH", cleveland: "OH", cincinnati: "OH", toledo: "OH", akron: "OH", dayton: "OH",
  charlotte: "NC", raleigh: "NC", greensboro: "NC", durham: "NC", "winston-salem": "NC", "winston salem": "NC", asheville: "NC",
  indianapolis: "IN", "fort wayne": "IN", evansville: "IN", "south bend": "IN",
  seattle: "WA", spokane: "WA", tacoma: "WA",
  denver: "CO", "colorado springs": "CO", "fort collins": "CO",
  "washington dc": "DC", "washington d.c.": "DC",
  boston: "MA", worcester: "MA",
  nashville: "TN", memphis: "TN", knoxville: "TN", chattanooga: "TN", clarksville: "TN", murfreesboro: "TN",
  detroit: "MI", "grand rapids": "MI", lansing: "MI", "ann arbor": "MI", flint: "MI",
  "oklahoma city": "OK", tulsa: "OK",
  portland: "OR", eugene: "OR",
  "las vegas": "NV", reno: "NV", henderson: "NV",
  louisville: "KY",
  baltimore: "MD", annapolis: "MD",
  milwaukee: "WI", "green bay": "WI",
  albuquerque: "NM", "santa fe": "NM", "las cruces": "NM",
  atlanta: "GA", savannah: "GA", macon: "GA",
  omaha: "NE",
  minneapolis: "MN", "st paul": "MN", "st. paul": "MN", "saint paul": "MN", duluth: "MN",
  "new orleans": "LA", "baton rouge": "LA", shreveport: "LA", lafayette: "LA",
  "st louis": "MO", "st. louis": "MO", "saint louis": "MO",
  wichita: "KS", topeka: "KS",
  honolulu: "HI",
  anchorage: "AK", fairbanks: "AK",
  newark: "NJ", "jersey city": "NJ", trenton: "NJ", paterson: "NJ",
  "virginia beach": "VA", richmond: "VA", norfolk: "VA", chesapeake: "VA", "newport news": "VA", roanoke: "VA",
  birmingham: "AL", montgomery: "AL", huntsville: "AL",
  "salt lake city": "UT", provo: "UT",
  boise: "ID",
  "des moines": "IA", "cedar rapids": "IA",
  "little rock": "AR",
  providence: "RI",
  hartford: "CT", "new haven": "CT", bridgeport: "CT",
  "sioux falls": "SD",
  fargo: "ND", bismarck: "ND",
  billings: "MT", missoula: "MT",
  cheyenne: "WY",
  "myrtle beach": "SC",
  "biloxi": "MS", gulfport: "MS",
};

/** Two-letter state codes that are also everyday words: only counted when typed in capitals. */
const WORD_CODES = new Set(["in", "or", "me", "ok", "hi", "oh", "pa", "ma", "la", "al", "de", "id", "co", "mo", "as", "ms", "md"]);

const JOINERS = new Set(["in", "near", "around", "for", "at"]);

export type TradePlace = {
  /** The trade to search, with the place taken off. */
  trade: string;
  /** Two-letter state to search in ("" for nationwide). */
  state: string;
  /** The place as we understood it ("Jacksonville, FL", "Texas"), or null when nothing was taken off. */
  place: string | null;
};

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** The state a run of words names, with how to show it; null when it is not a place we know. */
function placeOf(words: string[], rawWords: string[], atEnd: boolean): { state: string; label: string; isCity: boolean } | null {
  const text = words.join(" ");
  const city = CITY_STATE[text];
  if (city) return { state: city, label: city === "DC" ? "Washington, DC" : `${titleCase(text)}, ${city}`, isCity: true };
  if (words.length === 1 && text.length === 2) {
    // A bare code only counts after the trade ("hvac TX"), and a code that is also a word
    // ("in", "or", "me") only when it was typed in capitals.
    if (!atEnd) return null;
    if (WORD_CODES.has(text) && rawWords[0] !== rawWords[0].toUpperCase()) return null;
  }
  const st = normalizeStateInput(text);
  if (!st || !STATE_NAMES[st]) return null;
  return { state: st, label: STATE_NAMES[st], isCity: false };
}

/**
 * Split "Jacksonville concrete", "concrete in Florida", "hvac TX" or "Houston, TX plumbing"
 * into a trade and a state. `chosenState` is what the state box already holds: a typed state
 * replaces it, a typed city only fills it when it is empty (Jacksonville is also a Texas town).
 */
export function splitTradeAndPlace(input: string | null | undefined, chosenState?: string | null): TradePlace {
  const original = String(input ?? "").trim();
  const chosen = normalizeStateInput(String(chosenState ?? "").trim());
  const unchanged: TradePlace = { trade: original, state: chosen, place: null };
  if (!original || original.length > 80) return unchanged;
  const rawWords = original.split(/[\s,]+/).filter(Boolean);
  if (rawWords.length < 2 || rawWords.length > 8) return unchanged;
  const words = rawWords.map((w) => w.toLowerCase());

  type Hit = { rest: string[]; state: string; label: string; isCity: boolean };
  const tryEnd = (from: number): Hit | null => {
    let end = words.length;
    if (words[end - 1] === "area" && end - from > 1) end -= 1;
    const p = placeOf(words.slice(from, end), rawWords.slice(from, end), true);
    if (!p) return null;
    let cut = from;
    if (cut > 1 && JOINERS.has(words[cut - 1])) cut -= 1;
    return { rest: rawWords.slice(0, cut), ...p };
  };
  const tryStart = (to: number): Hit | null => {
    const p = placeOf(words.slice(0, to), rawWords.slice(0, to), false);
    if (!p) return null;
    return { rest: rawWords.slice(to), ...p };
  };

  /** "Houston TX plumbing" / "plumbing Houston, TX": the other half of the same place comes off too. */
  const withoutOwnState = (h: Hit): string[] => {
    if (h.rest.length < 2) return h.rest;
    if (!h.isCity) {
      // The state came off the end; a city of that state may still sit in front of it.
      for (let n = Math.min(3, h.rest.length - 1); n >= 1; n--) {
        if (CITY_STATE[h.rest.slice(-n).join(" ").toLowerCase()] === h.state) return h.rest.slice(0, -n);
      }
      return h.rest;
    }
    if (normalizeStateInput(h.rest[h.rest.length - 1]) === h.state) return h.rest.slice(0, -1);
    if (normalizeStateInput(h.rest[0]) === h.state) return h.rest.slice(1);
    return h.rest;
  };

  let hit: Hit | null = null;
  // Longest place first, so "new york city" is not read as "new york" plus "city".
  for (let n = Math.min(4, words.length - 1); n >= 1 && !hit; n--) {
    for (const h of [tryEnd(words.length - n), tryStart(n)]) {
      if (!h || h.rest.length === 0) continue;
      const rest = isKnownTrade(h.rest.join(" ")) ? h.rest : withoutOwnState(h);
      if (isKnownTrade(rest.join(" "))) {
        hit = { ...h, rest };
        break;
      }
    }
  }
  if (!hit) return unchanged;
  const rest = hit.rest;

  const state = hit.isCity && chosen ? chosen : hit.state;
  return { trade: rest.join(" "), state, place: hit.label };
}
