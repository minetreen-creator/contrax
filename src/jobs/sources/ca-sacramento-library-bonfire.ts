/**
 * Sacramento Public Library Authority Bonfire — `ca_sacramento_library_bonfire`
 * (owner 2026-10-09: "we need Sacramento").
 *
 * WHY: of the Sacramento-area buyers, the City of Sacramento and SacRT post on
 * PlanetBids and Sacramento County on OpenGov Procurement — both behind bot
 * protection (an AWS WAF challenge and a Cloudflare challenge), which Contrax
 * does not get around. The Library Authority (the City and County's joint
 * library system) posts its bids and RFPs on its own Bonfire tenant, whose
 * public open-opportunities list needs no login. State of California work
 * headquartered in Sacramento is already covered by `ca_eprocure`.
 *
 * SOURCE: the same public, no-login open-opportunities endpoint every Bonfire
 * tenant serves (see bonfire-public.ts):
 *   GET https://saclibrary.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * The tenant host comes from the Library's own solicitations, which direct
 * proposals to saclibrary.bonfirehub.com. The Contrax dev sandbox could not
 * reach bonfirehub.com, so the first scheduled sync is the first live read; a
 * failed read records an error run and stores nothing.
 *
 * IDENTITY: `external_id = saclibrarybonfire-<ProjectID>`.
 */
import type { FetchResult } from "../runner";
import { bonfireAgencyName, fetchBonfireBids, type BonfireConfig } from "./bonfire-public";

export const CA_SACRAMENTO_LIBRARY_BONFIRE_SOURCE = "ca_sacramento_library_bonfire";

export const CA_SACRAMENTO_LIBRARY_BONFIRE_CONFIG: BonfireConfig = {
  source: CA_SACRAMENTO_LIBRARY_BONFIRE_SOURCE,
  host: "https://saclibrary.bonfirehub.com",
  idPrefix: "saclibrarybonfire",
  stateName: "California",
  locationName: "Sacramento, CA",
  buyerName: "Sacramento Public Library Authority",
  portalName: "the Sacramento Public Library procurement portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, "Sacramento Public Library Authority"),
};

/** Fetch the Sacramento Public Library's open-opportunity list and return ingest rows. */
export function fetchCaSacramentoLibraryBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(CA_SACRAMENTO_LIBRARY_BONFIRE_CONFIG, now);
}
