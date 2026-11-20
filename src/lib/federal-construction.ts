import { STATE_NAMES } from "~/lib/contract-map";

/**
 * Where federal construction dollars go, by state (owner 2026-11-19).
 * Source: USAspending.gov award search, pulled 2026-11-19. New contract awards
 * (types A-D) first signed in federal fiscal year 2025 (2024-10-01 to 2025-09-30),
 * construction (NAICS sector 23), $100,000 or more, grouped by the state where
 * the work is done. "Out of state" = the winner's registered address is in
 * another state. Amounts are each award's total as of the pull date.
 * Row: [state, awards, dollars, awards won out of state, dollars won out of state].
 */
export const FEDERAL_CONSTRUCTION_ROWS: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ["AK", 204, 1205914159, 25, 576178703],
  ["AL", 285, 715434363, 226, 392447102],
  ["AR", 94, 336022966, 63, 291081007],
  ["AZ", 239, 1733025912, 126, 1187499730],
  ["CA", 1246, 7736864200, 331, 4755955227],
  ["CO", 259, 423154823, 127, 245580876],
  ["CT", 62, 236419743, 47, 211699316],
  ["DC", 330, 500125393, 309, 467140015],
  ["DE", 28, 94431578, 23, 92432156],
  ["FL", 679, 1991610041, 274, 912053205],
  ["GA", 367, 1003246345, 235, 575532467],
  ["HI", 230, 1503352374, 77, 427013255],
  ["IA", 50, 145617397, 43, 113735488],
  ["ID", 81, 163558266, 32, 107329412],
  ["IL", 197, 328861678, 109, 151233146],
  ["IN", 131, 183050377, 59, 141170746],
  ["KS", 151, 287667488, 91, 175915411],
  ["KY", 180, 176132386, 102, 100936411],
  ["LA", 189, 834572982, 105, 408824399],
  ["MA", 158, 230354632, 91, 140831324],
  ["MD", 664, 1134409011, 357, 661494197],
  ["ME", 78, 282503178, 56, 154900740],
  ["MI", 126, 287779207, 39, 148486915],
  ["MN", 86, 103102438, 30, 67526097],
  ["MO", 228, 397162474, 63, 151728864],
  ["MS", 152, 443878231, 97, 377274668],
  ["MT", 123, 206638007, 57, 102271871],
  ["NC", 328, 932943234, 160, 650700050],
  ["ND", 80, 189337662, 38, 96472798],
  ["NE", 77, 103456151, 56, 70701890],
  ["NH", 33, 54460844, 24, 51125131],
  ["NJ", 219, 462671535, 64, 143472147],
  ["NM", 141, 428181368, 82, 209766867],
  ["NV", 115, 430419431, 76, 365807466],
  ["NY", 372, 820027976, 163, 396668411],
  ["OH", 223, 409714769, 88, 212309606],
  ["OK", 213, 1016752980, 98, 850560647],
  ["OR", 131, 248271282, 74, 135667125],
  ["PA", 291, 847290866, 161, 576422850],
  ["RI", 64, 69361496, 59, 67440729],
  ["SC", 215, 474303251, 168, 370069299],
  ["SD", 88, 304453978, 42, 226018940],
  ["TN", 147, 540565165, 114, 495311716],
  ["TX", 734, 4698921887, 389, 4283590945],
  ["UT", 215, 658479007, 53, 366908482],
  ["VA", 646, 1300000609, 249, 751425002],
  ["VT", 25, 26877200, 22, 25336359],
  ["WA", 398, 2462908239, 141, 925900599],
  ["WI", 127, 124605446, 58, 47489317],
  ["WV", 69, 104002568, 52, 82602321],
  ["WY", 78, 186528835, 64, 149918335],
];

export const FEDERAL_CONSTRUCTION_PATH = "/federal-construction-by-state";
export const FEDERAL_CONSTRUCTION_PERIOD = "federal fiscal year 2025 (October 2024 to September 2025)";
export const FEDERAL_CONSTRUCTION_PULLED = "November 19, 2026";

export type FederalConstructionState = {
  code: string;
  name: string;
  slug: string;
  awards: number;
  dollars: number;
  outAwards: number;
  outDollars: number;
  /** Share of dollars won by firms registered in another state, 0-100, rounded. */
  outShare: number;
  rank: number;
};

/** States ranked by out-of-state share of dollars, highest first. */
export function federalConstructionStates(): FederalConstructionState[] {
  const list = FEDERAL_CONSTRUCTION_ROWS.map(([code, awards, dollars, outAwards, outDollars]) => {
    const name = STATE_NAMES[code] ?? code;
    return {
      code,
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      awards,
      dollars,
      outAwards,
      outDollars,
      exact: dollars > 0 ? outDollars / dollars : 0,
    };
  });
  list.sort((a, b) => b.exact - a.exact || a.name.localeCompare(b.name));
  return list.map(({ exact, ...s }, i) => ({ ...s, outShare: Math.round(exact * 100), rank: i + 1 }));
}

export function federalConstructionTotals(): { awards: number; dollars: number; outAwards: number; outDollars: number; outShare: number; outAwardShare: number } {
  let awards = 0, dollars = 0, outAwards = 0, outDollars = 0;
  for (const [, a, d, oa, od] of FEDERAL_CONSTRUCTION_ROWS) {
    awards += a; dollars += d; outAwards += oa; outDollars += od;
  }
  return { awards, dollars, outAwards, outDollars, outShare: Math.round((outDollars / dollars) * 100), outAwardShare: Math.round((outAwards / awards) * 100) };
}

/** "$39.6 billion", "$932.9 million", "$26.9 million". */
export function bigDollars(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} billion`;
  return `$${(n / 1e6).toFixed(1)} million`;
}

export const FEDERAL_WINNERS_STATE_PATH = "/federal-construction-winners";

/** "/federal-construction-winners/north-carolina" */
export function federalWinnersStateHref(slug: string): string {
  return `${FEDERAL_WINNERS_STATE_PATH}/${slug}`;
}

/** The state for a page slug ("north-carolina"), or null when there is no such state. */
export function federalConstructionStateBySlug(slug: string): FederalConstructionState | null {
  const want = String(slug ?? "").toLowerCase();
  return federalConstructionStates().find((s) => s.slug === want) ?? null;
}
