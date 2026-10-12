/**
 * Local buyer registry for the city/county and agency landing pages
 * (/bids-in/{state}/{place} and /agency/{slug}).
 *
 * Each entry is EITHER one local source we read directly from the buyer's own
 * board (every row under that source is that buyer's solicitation; the place and
 * state come from its SOURCE_CLASSES record), OR one buyer inside a state portal
 * whose buyer field is structured, matched on that exact buyer name (owner
 * 2026-10-12: Richmond, VA posts on eVA; its own OpenGov portal is behind a bot
 * check, which we never get around). Neither is ever guessed from row text. The
 * test pins every local source in SOURCE_CLASSES to an entry here.
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
  /** Exact `bids.agency` value, for a buyer inside a multi-buyer state portal. */
  agencyName?: string;
  /** Place and state for an `agencyName` entry (a portal's source record has none). */
  place?: string;
  stateCode?: string;
  /** Portal an `agencyName` buyer posts on, as shown to visitors. */
  via?: string;
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
  { source: "va_colonial_heights", slug: "city-of-colonial-heights", name: "City of Colonial Heights" },
  { source: "va_loudoun", slug: "loudoun-county", name: "Loudoun County" },
  { source: "tx_dallas_bonfire", slug: "city-of-dallas", name: "City of Dallas" },
  { source: "nc_gastonia", slug: "city-of-gastonia", name: "City of Gastonia" },
  { source: "nc_gaston_county", slug: "gaston-county", name: "Gaston County" },
  { source: "va_suffolk", slug: "city-of-suffolk", name: "City of Suffolk" },
  { source: "va_lynchburg", slug: "city-of-lynchburg", name: "City of Lynchburg" },
  { source: "va_charlottesville", slug: "city-of-charlottesville", name: "City of Charlottesville" },
  { source: "va_fairfax_bonfire", slug: "fairfax-county", name: "Fairfax County" },
  { source: "va_alexandria_bonfire", slug: "city-of-alexandria", name: "City of Alexandria" },
  { source: "oh_worthington", slug: "city-of-worthington", name: "City of Worthington" },
  { source: "oh_dayton", slug: "city-of-dayton", name: "City of Dayton" },
  // Richmond, VA buyers on eVA (va_eva `agencyname`, exact).
  { source: "va_eva", agencyName: "City of Richmond Government", slug: "city-of-richmond", name: "City of Richmond", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Richmond Schools", slug: "richmond-public-schools", name: "Richmond Public Schools", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Greater Richmond Transit Company", slug: "grtc-transit", name: "Greater Richmond Transit Company (GRTC)", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Richmond Redevelopment Housing Authority", slug: "richmond-redevelopment-housing-authority", name: "Richmond Redevelopment and Housing Authority", place: "Richmond", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  // More Virginia buyers on eVA (owner 2026-10-12), same exact-name match.
  { source: "va_eva", agencyName: "Henrico County Government", slug: "henrico-county", name: "Henrico County", place: "Henrico County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Norfolk", slug: "city-of-norfolk", name: "City of Norfolk", place: "Norfolk", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Norfolk Airport Authority", slug: "norfolk-airport-authority", name: "Norfolk Airport Authority", place: "Norfolk", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Norfolk Redevelopment Housing Authority", slug: "norfolk-redevelopment-housing-authority", name: "Norfolk Redevelopment and Housing Authority", place: "Norfolk", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Hampton", slug: "city-of-hampton", name: "City of Hampton", place: "Hampton", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Hampton City Schools", slug: "hampton-city-schools", name: "Hampton City Schools", place: "Hampton", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "Arlington County Government", slug: "arlington-county", name: "Arlington County", place: "Arlington County", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
  { source: "va_eva", agencyName: "City of Chesapeake", slug: "city-of-chesapeake", name: "City of Chesapeake", place: "Chesapeake", stateCode: "VA", via: "eVA, Virginia's procurement portal" },
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
  if (!rec) return null;
  let place: string | undefined;
  let stateCode: string | undefined;
  if (a.agencyName) {
    // A buyer inside a state portal: the portal must be that state's.
    if (rec.scopeState !== a.stateCode) return null;
    place = a.place;
    stateCode = a.stateCode;
  } else if (rec.class === "local") {
    place = rec.city;
    stateCode = rec.scopeState;
  }
  if (!place || !stateCode) return null;
  const stateName = STATE_NAMES[stateCode];
  if (!stateName) return null;
  return {
    ...a,
    place,
    placeSlug: slugify(place),
    stateCode,
    stateName,
    stateSlug: slugify(stateName),
  };
}

/** SQL scope for a set of agencies: whole sources, plus (source, exact agency) pairs. */
export function agencyScope(agencies: readonly LocalAgency[]): {
  sources: string[];
  pairSources: string[];
  pairAgencies: string[];
} {
  const sources = [...new Set(agencies.filter((a) => !a.agencyName).map((a) => a.source))];
  const named = agencies.filter((a) => a.agencyName);
  return {
    sources,
    pairSources: named.map((a) => a.source),
    pairAgencies: named.map((a) => a.agencyName!),
  };
}

/** Which agency a (source, agency) row belongs to, if any. */
export function agencyForRow(
  agencies: readonly LocalAgency[],
  source: string,
  agency: string | null,
): LocalAgency | undefined {
  return (
    agencies.find((a) => a.agencyName && a.source === source && a.agencyName === agency) ??
    agencies.find((a) => !a.agencyName && a.source === source)
  );
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
