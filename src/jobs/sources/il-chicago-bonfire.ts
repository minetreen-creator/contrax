/**
 * Chicago-area Bonfire portals (owner 2026-10-09: "what do we have for
 * Chicago?" — Contrax held only the City of Chicago's AWARD feed, no open local
 * bids). Three public buyers in Chicago post their solicitations on their own
 * Bonfire tenants:
 *
 *   - `il_cook_county_bonfire`  → cookcountyil.bonfirehub.com — Cook County's
 *     Office of the Chief Procurement Officer (all new County solicitations).
 *   - `il_cps_bonfire`          → cps.bonfirehub.com — Chicago Public Schools.
 *   - `il_cook_county_health_bonfire` → cookcountyhealth.bonfirehub.com — Cook
 *     County Health (the County's hospital system, its own procurement).
 *
 * WHY: Illinois's state feed (`il_bidbuy`) carries state agencies; county,
 * school-district and county-hospital purchasing lives on these portals.
 *
 * SOURCE: the same public, no-login open-opportunities endpoint every Bonfire
 * tenant serves (see bonfire-public.ts):
 *   GET https://<tenant>.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * The tenant hosts were identified from public search results on 2026-10-09
 * (Cook County's "Doing Business" guide and procurement pages name
 * cookcountyil.bonfirehub.com and cookcountyhealth.bonfirehub.com; CPS's
 * open-opportunities portal is cps.bonfirehub.com). The Contrax dev sandbox
 * could not reach bonfirehub.com, so the first scheduled sync is the first live
 * read. A failed read records an error run and stores nothing.
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * Bonfire tenant and documented in bonfire-public.ts.
 *
 * IDENTITY: `external_id = <idPrefix>-<ProjectID>` (prefixes below are distinct).
 */
import type { FetchResult } from "../runner";
import { bonfireAgencyName, fetchBonfireBids, type BonfireConfig } from "./bonfire-public";

export const IL_COOK_COUNTY_BONFIRE_SOURCE = "il_cook_county_bonfire";
export const IL_CPS_BONFIRE_SOURCE = "il_cps_bonfire";
export const IL_COOK_COUNTY_HEALTH_BONFIRE_SOURCE = "il_cook_county_health_bonfire";

export const IL_COOK_COUNTY_BONFIRE_CONFIG: BonfireConfig = {
  source: IL_COOK_COUNTY_BONFIRE_SOURCE,
  host: "https://cookcountyil.bonfirehub.com",
  idPrefix: "cookcountybonfire",
  stateName: "Illinois",
  locationName: "Cook County, IL",
  buyerName: "Cook County",
  portalName: "the Cook County Office of the Chief Procurement Officer portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Cook County"),
};

export const IL_CPS_BONFIRE_CONFIG: BonfireConfig = {
  source: IL_CPS_BONFIRE_SOURCE,
  host: "https://cps.bonfirehub.com",
  idPrefix: "cpsbonfire",
  stateName: "Illinois",
  locationName: "Chicago, IL",
  buyerName: "Chicago Public Schools",
  portalName: "the Chicago Public Schools procurement portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Chicago Public Schools"),
};

export const IL_COOK_COUNTY_HEALTH_BONFIRE_CONFIG: BonfireConfig = {
  source: IL_COOK_COUNTY_HEALTH_BONFIRE_SOURCE,
  host: "https://cookcountyhealth.bonfirehub.com",
  idPrefix: "cookhealthbonfire",
  stateName: "Illinois",
  locationName: "Cook County, IL",
  buyerName: "Cook County Health",
  portalName: "the Cook County Health procurement portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Cook County Health"),
};

/** Fetch Cook County's open-opportunity list and return ingest rows. */
export function fetchIlCookCountyBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(IL_COOK_COUNTY_BONFIRE_CONFIG, now);
}

/** Fetch Chicago Public Schools' open-opportunity list and return ingest rows. */
export function fetchIlCpsBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(IL_CPS_BONFIRE_CONFIG, now);
}

/** Fetch Cook County Health's open-opportunity list and return ingest rows. */
export function fetchIlCookCountyHealthBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(IL_COOK_COUNTY_HEALTH_BONFIRE_CONFIG, now);
}
