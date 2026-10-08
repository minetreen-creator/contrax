/**
 * Fairfax County, Virginia — its OWN Bonfire procurement portal
 * (`va_fairfax_bonfire`). Owner green-light 2026-10-08 (Virginia locality boards,
 * dispatch B — the twin of the City of Alexandria tenant in
 * `va-alexandria-bonfire.ts`; evidence: shared/virginia-delivery-courier-probe-2026-10-08/
 * and shared/va-bonfire-2026-10-08/).
 *
 * WHY: Virginia's state feed (`va_eva`) carries state agencies AND localities;
 * Virginia's localities also publish on their OWN boards, and locality-scale work
 * (a county's grounds, fleet, facilities and human-services contracts) is what a
 * local vendor can actually bid. The desk research + live probe (2026-10-08)
 * confirmed this tenant answers the reader family's existing request shape.
 *
 * SOURCE: the same public, no-login open-opportunities endpoint every Bonfire
 * tenant serves (see bonfire-public.ts):
 *   GET https://fairfaxcounty.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * The portal page itself is the client shell a person opens
 * (`/portal/?tab=openOpportunities`); it is never parsed. The tenant's own page
 * names its publisher — page title "Portal — Open Opportunities - **Fairfax
 * County**" (captured 2026-10-08, shared/va-bonfire-2026-10-08/raw/) — and that is
 * the only name this file uses.
 *
 * ═══ TWO THINGS THIS TENANT DOES DIFFERENTLY (measured, not assumed) ═══
 * 1. `payload.departments` is an EMPTY list while every project carries a
 *    `DepartmentID` (2034 / 1983 / 2014 / 2377 at capture) — i.e. this tenant
 *    publishes NO department names at all. So every row falls back to the
 *    config's own buyer name (`agency` = "Fairfax County"), and NO department code
 *    is ever invented, expanded or guessed. Asserted in the deterministic suite.
 * 2. The portal's own page sets `var timezone = "America/Toronto"` for DISPLAY
 *    only. The reader's rule is unchanged and applies here exactly as everywhere
 *    else: `DateClose` is Bonfire's UTC DB-date string, read as UTC; the tenant's
 *    display zone is never applied to it (bonfire-public.ts, settled 2026-10-06).
 *
 * OWNER-APPROVED SCOPE: this tenant only. Nothing else on fairfaxcounty.gov (or
 * any other Fairfax surface) is read here; there is no detail fetch beyond the
 * public list, and the only request is the one the portal page itself makes.
 *
 * IDENTITY: `external_id = fairfaxbonfire-<ProjectID>` — Bonfire ProjectIDs come
 * from ONE numeric space shared by every tenant, so the prefix is per-tenant on
 * purpose and can never collide with `alexandriabonfire-` or any other tenant.
 */
import type { FetchResult } from "../runner";
import {
  bonfireAgencyName,
  fetchBonfireBids,
  parseBonfire,
  type BonfireConfig,
  type BonfireParseResult,
  type BonfirePayload,
} from "./bonfire-public";

/** The stored `bids.source` label (runner TAIL_SOURCES / source-class / location-state). */
export const VA_FAIRFAX_BONFIRE_SOURCE = "va_fairfax_bonfire";
/** The tenant itself — the only host this source reads or cites. */
export const VA_FAIRFAX_BONFIRE_HOST = "https://fairfaxcounty.bonfirehub.com";
/** The publisher's own name, verbatim from its portal page title. */
export const VA_FAIRFAX_AGENCY = "Fairfax County";
/** County-level place, provable by construction (the County publishes this portal). */
export const VA_FAIRFAX_LOCATION = "Fairfax County, VA";
/** `external_id` prefix → `fairfaxbonfire-256205` (stable: upsert refreshes, never dupes). */
export const VA_FAIRFAX_ID_PREFIX = "fairfaxbonfire";
/**
 * Open projects the portal itself listed at capture time (two live fetches,
 * 2026-10-08 01:43Z — both byte-identical, sha256 in fixtures/va-fairfax-bonfire/
 * README.md). Quoted, never arithmetic: a portal churns, so this is evidence of
 * the capture, NOT a standing count.
 */
export const VA_FAIRFAX_CAPTURED_OPEN_ROWS_2026_10_08 = 7;

export const VA_FAIRFAX_BONFIRE_CONFIG: BonfireConfig = {
  source: VA_FAIRFAX_BONFIRE_SOURCE,
  host: VA_FAIRFAX_BONFIRE_HOST,
  idPrefix: VA_FAIRFAX_ID_PREFIX,
  stateName: "Virginia",
  locationName: VA_FAIRFAX_LOCATION,
  buyerName: VA_FAIRFAX_AGENCY,
  portalName: "the Fairfax County Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, VA_FAIRFAX_AGENCY),
};

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` / TX-Bonfire pattern).
 */
export const VA_FAIRFAX_BONFIRE_COPY = {
  publisherLine:
    "Open solicitations as published by Fairfax County on the County's own Bonfire procurement portal.",
  /** The badge comes from `source-class.ts` (LOCAL → the place's name); pinned here too. */
  badge: "Fairfax County",
  openSetDefinition:
    "Showing the opportunities the portal itself lists as open: status Open on the source, with a close date that has not passed. Amendment and extension requests and notices of intent to award without a competition are excluded by the source's own labels.",
  buyerMixNote:
    "This portal publishes NO department names for its postings (its department list is empty while its postings carry department ids), so every row is attributed to the County itself. No department code is expanded or guessed.",
  timeZoneNote:
    "Close dates are stored by Bonfire in UTC. The portal's own page sets a display zone for the organization (America/Toronto on this tenant, as captured); it is used for display only and is never applied to the stored instant, which is the date shown here.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every Fairfax County solicitation is listed. Always confirm details and deadlines at the official source.",
  /**
   * What the portal's own open list carried on 2026-10-08 — quoted from the live
   * capture, listed row by row so nothing is summarised away. NO coverage claim and
   * NO trade claim: the seven titles are what the source states, and the note says
   * plainly that none of them is a delivery, courier or freight solicitation.
   */
  captureNote:
    "On 2026-10-08 the portal's own open list carried 7 solicitations: " +
    "Chemicals & Sand for Ice and Snow Removal; Psychological Evaluation & Testing Services " +
    "(and its draft notice, listed separately by the portal); Snow and Ice Removal Services - " +
    "Zones 3 and 4; Electrical and Emergency Power Systems Installation and/or Replacement; " +
    "Automatic Gates; and CSA Open Application Period FY2027- Quarter 2. " +
    "None of the seven is a delivery, courier or freight solicitation. " +
    "Contrax makes no claim about which trades appear on this portal.",
} as const;

/** PURE parse of Fairfax County's open-opportunity list — no network, no DB; `now` is injected. */
export function parseVaFairfaxBonfire(payload: BonfirePayload, now: number = Date.now()): BonfireParseResult {
  return parseBonfire(VA_FAIRFAX_BONFIRE_CONFIG, payload, now);
}

/** Fetch Fairfax County's open-opportunity list and return ingest rows. */
export function fetchVaFairfaxBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(VA_FAIRFAX_BONFIRE_CONFIG, now);
}
