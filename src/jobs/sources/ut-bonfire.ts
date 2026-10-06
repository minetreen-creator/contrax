/**
 * Utah U3P (Utah Public Procurement Place, on Bonfire) open opportunities —
 * `ut_bonfire`, the statewide bid portal used by the State of Utah Division of
 * Purchasing, DFCM, state agencies and many cities, counties, school districts
 * and special districts.
 *
 * WHY: Contrax had no Utah bid feed (owner 2026-10-05, after a Lehi, UT visitor
 * searched "security guard" in Utah and found nothing).
 *
 * SOURCE (verified live 2026-10-05, no login, no CAPTCHA: 186 open projects
 * from 44 organizations): the public portal page
 *   https://utah.bonfirehub.com/portal/?tab=openOpportunities
 * loads its list from its own public JSON call
 *   GET https://utah.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
 * which returns { payload: { projects: {id: {...}}, departments: {id: {...}} } }.
 * The connector reads only that list. Opportunity detail pages sit behind a
 * browser check and are never requested; links point at them because they
 * open normally in a person's browser.
 *
 * The reading, mapping, identity and time-zone rules are shared with every
 * Bonfire tenant and documented in bonfire-public.ts (verified live
 * 2026-10-06 on the TxDOT and UT Tyler tenants). This file is Utah's config.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = ProjectName; `solicitation_number` = ReferenceID.
 *   - `agency` = the posting department without its category prefix
 *     ("CITIES - City of Orem" → "City of Orem"; "Division of Purchasing" →
 *     "Utah Division of Purchasing").
 *   - `due_date` = DateClose, which Bonfire stores in UTC (bonfire-public.ts's
 *     time-zone rule: the portal parses it with createMomentFromUtcDateString,
 *     i.e. moment.tz(v, 'YYYY-MM-DD HH:mm:ss', true, 'UTC'), and converts to the
 *     org time zone for display only; the org time zone is America/Denver).
 *   - `location` = "Utah"; `naics_code` / `psc` / `set_aside` stay NULL.
 * Skipped: not open (`not_open`), close date passed (`closed`), and notices
 * that are not open competitions — contract amendment/extension requests and
 * notices of intent to award without a standard procurement
 * (`not_competitive`).
 *
 * IDENTITY: `external_id = utbonfire-<ProjectID>` — the `utbonfire` prefix is
 * tenant-scoped on purpose (Bonfire ProjectIDs share one numeric space across
 * tenants, so a bare `<ProjectID>` could collide with another tenant's row).
 */
import type { FetchResult } from "../runner";
import {
  bonfireCloseMs,
  bonfireDataUrl,
  bonfirePortalUrl,
  fetchBonfireBids,
  isNonCompetitiveBonfireNotice,
  parseBonfire,
  type BonfireConfig,
  type BonfireParseResult,
  type BonfirePayload,
} from "./bonfire-public";

/** "CITIES - City of Orem" → "City of Orem"; "Division of Purchasing" → "Utah Division of Purchasing". */
export function utAgencyName(dept: string | null | undefined): string {
  const raw = String(dept ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "State of Utah";
  if (/^division of purchasing$/i.test(raw)) return "Utah Division of Purchasing";
  const m = /^([A-Z][A-Z &-]+?) - (.+)$/.exec(raw);
  const name = (m ? m[2] : raw).trim();
  // "DFCM - Division of Facilities Construction and Management" → "Division of … (DFCM)".
  const abbr = /^([A-Z]{2,6}) - (.+)$/.exec(name);
  return abbr ? `${abbr[2]} (${abbr[1]})` : name;
}

/** Utah's tenant — the default Bonfire config (the reader is bonfire-public.ts). */
export const UT_BONFIRE_CONFIG: BonfireConfig = {
  source: "ut_bonfire",
  host: "https://utah.bonfirehub.com",
  idPrefix: "utbonfire",
  stateName: "Utah",
  buyerName: "State of Utah",
  portalName: "U3P (Bonfire)",
  agencyName: utAgencyName,
};

export const UT_BONFIRE_SOURCE = UT_BONFIRE_CONFIG.source;
export const UT_BONFIRE_HOST = UT_BONFIRE_CONFIG.host;
export const UT_BONFIRE_DATA_URL = bonfireDataUrl(UT_BONFIRE_CONFIG);
export const UT_BONFIRE_PORTAL_URL = bonfirePortalUrl(UT_BONFIRE_CONFIG);

/** Legacy Utah aliases — the shared rules live in bonfire-public.ts. */
export type UtProject = BonfirePayload["projects"][string];
export type UtPayload = BonfirePayload;
export type UtParseResult = BonfireParseResult;
/** "2026-10-19 21:00:00" (UTC) → epoch ms, or NaN. */
export const utCloseMs = bonfireCloseMs;
/** Change notices and sole-source intents are not open competitions. */
export const isNonCompetitiveUtNotice = isNonCompetitiveBonfireNotice;

/** PURE parse of Utah's open-opportunity list — no network, no DB; `now` is injected. */
export function parseUtBonfire(payload: UtPayload, now: number = Date.now()): UtParseResult {
  return parseBonfire(UT_BONFIRE_CONFIG, payload, now);
}

/** Fetch Utah's open-opportunity list and return ingest rows. */
export function fetchUtBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  return fetchBonfireBids(UT_BONFIRE_CONFIG, now);
}
