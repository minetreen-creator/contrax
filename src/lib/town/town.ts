/**
 * "What's Your Town Buying?" (owner 2026-10-23: "something new to bring people
 * in, something catchy"). Type a ZIP code, see the open government bids from
 * the towns around it, and share the page.
 *
 * Bids are not geocoded, so "near" means: bids whose buyer or location names
 * a town within RADIUS_MILES of the ZIP (City of Norfolk, Norfolk Public
 * Schools, "Chesterfield, VA"…), in that town's state. Statewide bids are
 * counted separately and never presented as local.
 *
 * PURE: ZIP data comes in as an argument (public/data/town-zips.json, from the
 * BSD-licensed `zipcodes` package; see public/data/town-zips-LICENSE.txt).
 */

/** zip → [town, state, lat, lon] */
export type ZipTable = Record<string, [string, string, number, number]>;

export const RADIUS_MILES = 25;
/** Town names used in the match (nearest first). */
export const MAX_TOWNS = 60;

export interface TownPlace {
  zip: string;
  town: string;
  state: string;
}

export interface NearbyTown {
  town: string;
  state: string;
  miles: number;
}

export function normalizeZip(input: string | null | undefined): string | null {
  const m = (input ?? "").trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? m[1]! : null;
}

export function lookupZip(zips: ZipTable, zip: string): TownPlace | null {
  const z = zips[zip];
  return z ? { zip, town: z[0], state: z[1] } : null;
}

export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distinct towns within `radius` miles of the ZIP, nearest first, the ZIP's own town first. */
export function nearbyTowns(zips: ZipTable, zip: string, radius = RADIUS_MILES, max = MAX_TOWNS): NearbyTown[] {
  const home = zips[zip];
  if (!home) return [];
  const [, , lat, lon] = home;
  const best = new Map<string, NearbyTown>();
  for (const [town, state, la, lo] of Object.values(zips)) {
    if (Math.abs(la - lat) > radius / 50 || Math.abs(lo - lon) > radius / 35) continue;
    const miles = milesBetween(lat, lon, la, lo);
    if (miles > radius) continue;
    const key = `${town.toLowerCase()}|${state}`;
    const prev = best.get(key);
    if (!prev || miles < prev.miles) best.set(key, { town, state, miles: Math.round(miles * 10) / 10 });
  }
  const homeKey = `${home[0].toLowerCase()}|${home[1]}`;
  return [...best.entries()]
    .sort(([ka, a], [kb, b]) => Number(kb === homeKey) - Number(ka === homeKey) || a.miles - b.miles)
    .slice(0, max)
    .map(([, t]) => t);
}

/** Town names too generic to match on their own in a buyer name. */
const GENERIC = new Set(["center", "central", "city", "county", "university", "college", "fort", "north", "south", "east", "west", "union", "commerce", "industry", "lake", "park", "springs", "beach", "harbor", "heights", "hills", "village"]);

/**
 * A Postgres case-insensitive regex (`~*`) matching any of the towns as whole
 * words, e.g. `\m(colonial heights|petersburg|hopewell)\M`. Null when no
 * usable name remains.
 */
export function townRegex(towns: readonly NearbyTown[]): string | null {
  const names = [...new Set(towns.map((t) => t.town.toLowerCase().trim()))].filter((n) => n.length >= 4 && !GENERIC.has(n));
  if (!names.length) return null;
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `\\m(${esc.join("|")})\\M`;
}

/** Category label → emoji for the "what they're buying" chips. */
export function categoryEmoji(category: string | null | undefined): string {
  const c = (category ?? "").toLowerCase();
  if (/janitor|clean|custod/.test(c)) return "🧹";
  if (/landscap|grounds|lawn|tree/.test(c)) return "🌳";
  if (/hvac|mechanical|heating|plumb/.test(c)) return "❄️";
  if (/construct|roof|paint|build|renovat/.test(c)) return "🔨";
  if (/transport|truck|haul|moving/.test(c)) return "🚚";
  if (/secur|guard/.test(c)) return "🛡️";
  if (/it|technolog|software|network|computer/.test(c)) return "💻";
  if (/electric/.test(c)) return "⚡";
  if (/food|cater/.test(c)) return "🍽️";
  if (/medical|health/.test(c)) return "🩺";
  if (/consult|professional|engineer/.test(c)) return "📐";
  return "📋";
}

export function townPagePath(zip: string): string {
  return `/town/${zip}`;
}

export function shareText(town: string, state: string, count: number): string {
  return count > 0
    ? `${town}, ${state} is buying ${count} thing${count === 1 ? "" : "s"} from local businesses right now 👀 See what's open:`
    : `See what ${town}, ${state} and the towns around it are buying from local businesses:`;
}
