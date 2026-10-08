/**
 * City of Alexandria, Virginia — its OWN Bonfire procurement portal
 * (`va_alexandria_bonfire`). Owner green-light 2026-10-08 (Virginia locality
 * boards, dispatch B — the twin of the Fairfax County tenant in
 * `va-fairfax-bonfire.ts`; evidence:
 * shared/virginia-delivery-courier-probe-2026-10-08/ and
 * shared/va-bonfire-2026-10-08/).
 *
 * WHY: Virginia's state feed (`va_eva`) carries state agencies AND localities;
 * Alexandria also publishes on its OWN portal, and this board carries the one
 * Virginia locality posting the probe found for a delivery/courier-scale vendor —
 * "Transportation Services for the DOT Paratransit Program and City Programs"
 * (close 2026-10-15 20:00). The copy states that as the source states it and
 * claims nothing about coverage.
 *
 * SOURCE: the same public, no-login open-opportunities endpoint every Bonfire
 * tenant serves (see bonfire-public.ts):
 *   GET https://alexandriava.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * The portal page itself is the client shell a person opens
 * (`/portal/?tab=openOpportunities`); it is never parsed. The tenant's own page
 * names its publisher — page title "Portal — Open Opportunities - **City of
 * Alexandria, VA**" (captured 2026-10-08,
 * shared/va-bonfire-2026-10-08/raw/) — and that is the only name this file uses.
 *
 * Unlike the Fairfax tenant, THIS portal does publish department names ("34 -
 * General Services", "41 - Transportation and Environmental Services (TES/DPI)",
 * "46 - Transit Services (DASH)" at capture) and they are kept VERBATIM as the
 * row's `agency` — never expanded, never replaced by a guess; the config's buyer
 * name is only the fallback for a posting whose department names none.
 *
 * TIME ZONE: the portal's own page sets `var timezone = "America/New_York"` for
 * DISPLAY only. The reader's rule is unchanged: `DateClose` is Bonfire's UTC
 * DB-date string, read as UTC (bonfire-public.ts, settled 2026-10-06); the
 * organization's zone is never applied to it.
 *
 * OWNER-APPROVED SCOPE: this tenant only — nothing else on alexandriava.gov (or
 * any other Alexandria surface) is read, and there is no detail fetch beyond the
 * public list the portal page itself loads.
 *
 * IDENTITY: `external_id = alexandriabonfire-<ProjectID>` — per-tenant, so it can
 * never collide with `fairfaxbonfire-` or any other Bonfire tenant on Bonfire's
 * shared numeric ProjectID space.
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
export const VA_ALEXANDRIA_BONFIRE_SOURCE = "va_alexandria_bonfire";
/** The tenant itself — the only host this source reads or cites. */
export const VA_ALEXANDRIA_BONFIRE_HOST = "https://alexandriava.bonfirehub.com";
/** The publisher's own name, verbatim from its portal page title. */
export const VA_ALEXANDRIA_AGENCY = "City of Alexandria, VA";
/** City-level place, provable by construction (the City publishes this portal). */
export const VA_ALEXANDRIA_LOCATION = "City of Alexandria, VA";
/** `external_id` prefix → `alexandriabonfire-251367` (stable: upsert refreshes, never dupes). */
export const VA_ALEXANDRIA_ID_PREFIX = "alexandriabonfire";
/**
 * Open projects the portal itself listed at capture time (two live fetches,
 * 2026-10-08 01:43Z — both byte-identical, sha256 in
 * fixtures/va-alexandria-bonfire/README.md). Quoted, never arithmetic: a portal
 * churns, so this is evidence of the capture, NOT a standing count.
 */
export const VA_ALEXANDRIA_CAPTURED_OPEN_ROWS_2026_10_08 = 3;

export const VA_ALEXANDRIA_BONFIRE_CONFIG: BonfireConfig = {
  source: VA_ALEXANDRIA_BONFIRE_SOURCE,
  host: VA_ALEXANDRIA_BONFIRE_HOST,
  idPrefix: VA_ALEXANDRIA_ID_PREFIX,
  stateName: "Virginia",
  locationName: VA_ALEXANDRIA_LOCATION,
  buyerName: VA_ALEXANDRIA_AGENCY,
  portalName: "the City of Alexandria Procurement Portal (Bonfire)",
  agencyName: (dept) => bonfireAgencyName(dept, VA_ALEXANDRIA_AGENCY),
};

/**
 * THE COPY. Exported so a surface, an alert or a run record quotes the same
 * sentences instead of inventing its own (the `wi_vendornet` / TX-Bonfire pattern).
 */
export const VA_ALEXANDRIA_BONFIRE_COPY = {
  publisherLine:
    "Open solicitations as published by the City of Alexandria on the City's own Bonfire procurement portal.",
  /** The badge comes from `source-class.ts` (LOCAL → the place's name); pinned here too. */
  badge: "Alexandria",
  openSetDefinition:
    "Showing the opportunities the portal itself lists as open: status Open on the source, with a close date that has not passed. Amendment and extension requests and notices of intent to award without a competition are excluded by the source's own labels.",
  buyerMixNote:
    "The City posts as its own departments and the portal's department labels are kept verbatim (e.g. \"41 - Transportation and Environmental Services (TES/DPI)\"); nothing is expanded or shortened.",
  timeZoneNote:
    "Close dates are stored by Bonfire in UTC. The portal's own page sets a display zone for the organization (America/New_York on this tenant, as captured); it is used for display only and is never applied to the stored instant, which is the date shown here.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every City of Alexandria solicitation is listed. Always confirm details and deadlines at the official source.",
  /**
   * What the portal's own open list carried on 2026-10-08 — quoted from the live
   * capture, listed row by row. NO coverage claim: the three titles are what the
   * source states, and no claim is made about trades beyond that.
   */
  captureNote:
    "On 2026-10-08 the portal's own open list carried 3 solicitations: " +
    "Transportation Services for the DOT Paratransit Program and City Programs; " +
    "Computer-Aided Dispatch / Automatic Vehicle Location (CAD/AVL) System Replacement; " +
    "and Durant Roof Replacement. " +
    "Contrax makes no claim about which trades appear on this portal.",
} as const;

/** PURE parse of the City of Alexandria's open-opportunity list — no network, no DB; `now` is injected. */
export function parseVaAlexandriaBonfire(payload: BonfirePayload, now: number = Date.now()): BonfireParseResult {
  return parseBonfire(VA_ALEXANDRIA_BONFIRE_CONFIG, payload, now);
}

/** Fetch the City of Alexandria's open-opportunity list and return ingest rows. */
export function fetchVaAlexandriaBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(VA_ALEXANDRIA_BONFIRE_CONFIG, now);
}
