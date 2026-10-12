/**
 * Local buyer registry for the city/county and agency landing pages
 * (/bids-in/{state}/{place} and /agency/{slug}).
 *
 * Each entry is ONE local source we read directly from the buyer's own board,
 * so every row under that source is that buyer's solicitation — provable by
 * construction, never guessed from row text. The place and state come from the
 * source's SOURCE_CLASSES record (src/lib/source-class.ts); the test pins the two
 * together so a new local source must be added here too.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { SOURCE_CLASSES } from "~/lib/source-class";

export interface LocalAgency {
  /** `bids.source` label. */
  source: string;
  /** URL slug for /agency/{slug}. */
  slug: string;
  /** Buyer name as people search for it. */
  name: string;
}

export const LOCAL_AGENCIES: LocalAgency[] = [
  { source: "ma_boston", slug: "city-of-boston", name: "City of Boston" },
  { source: "va_virginia_beach_oracle", slug: "city-of-virginia-beach", name: "City of Virginia Beach" },
  { source: "ky_louisville_bonfire", slug: "louisville-metro-government", name: "Louisville Metro Government" },
  { source: "al_mobile", slug: "city-of-mobile", name: "City of Mobile" },
  { source: "al_birmingham_purchasing", slug: "city-of-birmingham", name: "City of Birmingham" },
  { source: "ne_omaha_ionwave", slug: "city-of-omaha", name: "City of Omaha" },
  { source: "nyc_open_data", slug: "city-of-new-york", name: "City of New York" },
  { source: "la_open_data", slug: "city-of-los-angeles", name: "City of Los Angeles" },
  { source: "wi_milwaukee_bonfire", slug: "city-of-milwaukee", name: "City of Milwaukee" },
  { source: "wi_milwaukee_county_bonfire", slug: "milwaukee-county", name: "Milwaukee County" },
  { source: "wi_mps_bonfire", slug: "milwaukee-public-schools", name: "Milwaukee Public Schools" },
  { source: "ca_sacramento_library_bonfire", slug: "sacramento-public-library", name: "Sacramento Public Library" },
  { source: "il_chicago_dps", slug: "city-of-chicago", name: "City of Chicago" },
  { source: "il_cook_county_bonfire", slug: "cook-county", name: "Cook County" },
  { source: "il_cps_bonfire", slug: "chicago-public-schools", name: "Chicago Public Schools" },
  { source: "il_cook_county_health_bonfire", slug: "cook-county-health", name: "Cook County Health" },
  { source: "md_montgomery", slug: "montgomery-county-md", name: "Montgomery County, Maryland" },
  { source: "va_loudoun", slug: "loudoun-county", name: "Loudoun County" },
  { source: "tx_dallas_bonfire", slug: "city-of-dallas", name: "City of Dallas" },
  { source: "nc_gastonia", slug: "city-of-gastonia", name: "City of Gastonia" },
  { source: "nc_gaston_county", slug: "gaston-county", name: "Gaston County" },
  { source: "va_suffolk", slug: "city-of-suffolk", name: "City of Suffolk" },
  { source: "va_lynchburg", slug: "city-of-lynchburg", name: "City of Lynchburg" },
  { source: "va_charlottesville", slug: "city-of-charlottesville", name: "City of Charlottesville" },
  { source: "va_fairfax_bonfire", slug: "fairfax-county", name: "Fairfax County" },
  { source: "va_alexandria_bonfire", slug: "city-of-alexandria", name: "City of Alexandria" },
  { source: "oh_dayton", slug: "city-of-dayton", name: "City of Dayton" },
];

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface ResolvedAgency extends LocalAgency {
  place: string;
  placeSlug: string;
  stateCode: string;
  stateName: string;
  stateSlug: string;
}

export interface LocalPlace {
  name: string;
  slug: string;
  stateCode: string;
  stateName: string;
  stateSlug: string;
  agencies: ResolvedAgency[];
}

function resolve(a: LocalAgency): ResolvedAgency | null {
  const rec = SOURCE_CLASSES[a.source];
  if (!rec || rec.class !== "local" || !rec.city || !rec.scopeState) return null;
  const stateName = STATE_NAMES[rec.scopeState];
  if (!stateName) return null;
  return {
    ...a,
    place: rec.city,
    placeSlug: slugify(rec.city),
    stateCode: rec.scopeState,
    stateName,
    stateSlug: slugify(stateName),
  };
}

export const RESOLVED_AGENCIES: ResolvedAgency[] = LOCAL_AGENCIES.map(resolve).filter(
  (a): a is ResolvedAgency => a !== null,
);

export const AGENCY_BY_SLUG: Record<string, ResolvedAgency> = Object.fromEntries(
  RESOLVED_AGENCIES.map((a) => [a.slug, a]),
);

/** Places (cities and counties), each with the agencies we read there. Sorted by state, then name. */
export const LOCAL_PLACES: LocalPlace[] = (() => {
  const byKey = new Map<string, LocalPlace>();
  for (const a of RESOLVED_AGENCIES) {
    const key = `${a.stateSlug}/${a.placeSlug}`;
    let p = byKey.get(key);
    if (!p) {
      p = { name: a.place, slug: a.placeSlug, stateCode: a.stateCode, stateName: a.stateName, stateSlug: a.stateSlug, agencies: [] };
      byKey.set(key, p);
    }
    p.agencies.push(a);
  }
  return [...byKey.values()].sort(
    (x, y) => x.stateName.localeCompare(y.stateName) || x.name.localeCompare(y.name),
  );
})();

export function findPlace(stateSlug: string, placeSlug: string): LocalPlace | null {
  return LOCAL_PLACES.find((p) => p.stateSlug === stateSlug && p.slug === placeSlug) ?? null;
}

export function placesInState(stateCode: string): LocalPlace[] {
  return LOCAL_PLACES.filter((p) => p.stateCode === stateCode);
}

export function placeHref(p: { stateSlug: string; slug: string }): string {
  return `/bids-in/${p.stateSlug}/${p.slug}`;
}

export function agencyHref(a: { slug: string }): string {
  return `/agency/${a.slug}`;
}
