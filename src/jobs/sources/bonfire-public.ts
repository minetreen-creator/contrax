/**
 * Shared reader for **Bonfire** (bonfirehub.com) public procurement portals —
 * `<tenant>.bonfirehub.com/portal/?tab=openOpportunities`. States, cities and
 * universities publish their open opportunities on one of these tenants; each
 * portal is a thin config (see `ut-bonfire.ts`, `tx-txdot-bonfire.ts`,
 * `tx-uttyler-bonfire.ts`). The data endpoint path is identical on every tenant
 * (verified 2026-10-06 on utah / txdot / uttyler / texasoag tenants).
 *
 * SOURCE (verified live 2026-10-05 on Utah U3P, 2026-10-06 on the Texas tenants;
 * no login, no CAPTCHA, no cookie — the `Referer` header is optional): the portal
 * page loads its list from its own public JSON call
 *   GET <host>/PublicPortal/getOpenPublicOpportunitiesSectionData
 * which returns { payload: { projects: {id: {...}}, departments: {id: {...}} } }.
 * The connector reads only that list. Opportunity detail pages sit behind a
 * browser check and are never requested; links point at them because they open
 * normally in a person's browser.
 *
 * OPEN SET — three layers, all verified: (1) server-side, the section is literally
 * "open opportunities" and every row it returned carried `ProjectStatusID:"2"`
 * (37/37 on txdot, 2/2 on uttyler, 192/192 on utah); (2) this reader's status gate
 * (`"2"` only, else skip `not_open`); (3) this reader's close-date gate (a close
 * instant already past ⇒ skip `closed`) plus `not_competitive` (amendment /
 * extension requests and "notice of intent to award without …", which announce a
 * no-competition award). `missing_fields` and `bad_date` are the remaining skips.
 *
 * ═══ TIME ZONE RULE (settled 2026-10-06 from the platform's own bytes) ═══
 * `DateClose` is a ZONE-LESS `"YYYY-MM-DD HH:mm:ss"` string — Bonfire's own DB
 * date format (`BFConstants.DB_DATE_STRING = 'YYYY-MM-DD HH:mm:ss'`,
 * bonfireConstants.js) — and **that stored value is UTC**. The tenant page sets
 * `Bonfire.timezone` to the ORGANIZATION's own zone and renders every close date
 * by parsing the stored string AS UTC and converting for DISPLAY only:
 *
 *     BFUtil.createMomentFromUtcDateString = function (dateString, inputFormat) {
 *       var DB_DATE_STRING = 'YYYY-MM-DD HH:mm:ss';
 *       inputFormat = inputFormat || DB_DATE_STRING;
 *       return moment.tz(dateString, inputFormat, true, 'UTC').tz(Bonfire.timezone);
 *     };
 *
 * Primary evidence, three layers (all captured 2026-10-06, files in
 * /home/team/shared/tx-bonfire-3a-evidence/):
 *   · the helper above — `assets.bonfirehub.com/100646/js/bonfire/bonfireUtil.js`
 *     L414–421, served by the tenant's own portal; the tenant page's own
 *     `var timezone = "America/Chicago"` (txdot, L5288) / `"America/Denver"`
 *     (utah) / `"America/Chicago"` (uttyler) is the display zone, and the portal
 *     calls the helper as `BFUtil.createMomentFromUtcDateString(project.DateClose,
 *     BFConstants.DB_DATE_STRING)` (txdot portal HTML L40466).
 *   · the tenant's own rendered list: TxDOT `ProjectID 249305` has
 *     `DateClose "2026-10-06 17:00:00"` and the portal's Close Date cell says
 *     **"Oct 6th 2026, 12:00 PM CDT"** (17:00Z − 5 h). UT Tyler `256294` has
 *     `"2026-10-28 20:00:00"` → **"Oct 28th 2026, 3:00 PM CDT"** (20:00Z − 5 h).
 *   · the served list JSON itself carries no zone, so the conversion above is the
 *     only place a zone ever appears — and it is a DISPLAY conversion.
 * ⇒ READ THE WIRE VALUE AS UTC, for EVERY tenant, Texas included: the
 *   organization's zone is NEVER applied to it. `due_date = <DateClose>Z`; a value
 *   this module cannot read in that exact format is skipped and counted as
 *   `bad_date` (parse-or-NULL, never an invented instant, never a guessed zone).
 *   Corollary checked and NOT a defect: Utah's existing rows are not mis-shifted —
 *   utah.bonfirehub.com reports `America/Denver`, which is its display zone only.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = ProjectName; `solicitation_number` = ReferenceID.
 *   - `agency` = the posting department through the tenant's own `agencyName`
 *     rule. The portal's Department column shows the department name verbatim
 *     (TxDOT's own list renders "SSD_CM" / "PEPS" / "PRO_IT"; UT Tyler's renders
 *     "Procurement"), and no expansion of those codes is published anywhere on
 *     the source, so nothing is expanded or inferred here.
 *   - `due_date` = DateClose, read as UTC (see the time-zone rule above).
 *   - `location` = the config's `locationName` when the tenant's public buyer is
 *     narrower than the state (a county's or a city's OWN portal), else its state
 *     name; `category` = mapCategory over the title + description. The field is
 *     additive (see `locationName` below) and changes no pre-existing tenant.
 *   - `naics_code` / `psc` / `set_aside` / `notice_type` stay NULL — a Bonfire
 *     public list exposes none of them, and a missing federal set-aside is never
 *     read as a state/local small-business opportunity (owner ruling f).
 *
 * IDENTITY: `external_id = <idPrefix>-<ProjectID>` (Bonfire's own id). Bonfire
 * ProjectIDs live in ONE shared numeric space across tenants (measured 2026-10-06:
 * 0 overlap across txdot/utah/texasoag/uttyler, but that is luck of the draw), so
 * the prefix is per-tenant on purpose — two tenants can never collide.
 *
 * EVERYTHING in this file is PURE except `fetchBonfireBids`; `now` is injected.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Bonfire ProjectStatusID for an open project. */
export const BONFIRE_STATUS_OPEN = "2";

export interface BonfireConfig {
  /** The stored `bids.source` label, e.g. "ut_bonfire". */
  source: string;
  /** Tenant origin, e.g. "https://utah.bonfirehub.com" — the only structural difference between tenants. */
  host: string;
  /** external_id prefix, e.g. "utbonfire" — tenant-scoped, so two tenants can never collide. */
  idPrefix: string;
  /** Bid location, e.g. "Utah". */
  stateName: string;
  /**
   * The row's `location`, when the tenant's own place is NARROWER than its state —
   * a county's or a city's own portal, e.g. "Fairfax County, VA" / "City of
   * Alexandria, VA" (owner green-light 2026-10-08: a locality board's rows carry
   * the locality, not "Virginia"). ADDITIVE and OPTIONAL: when a config omits it
   * the row's location is `stateName` — the shape every pre-existing tenant
   * (utah / txdot / uttyler / the three Milwaukee tenants) already relies on, so
   * their rows are unchanged to the byte. It is a CONFIG literal, exactly like
   * `stateName`: never derived from a row's text.
   */
  locationName?: string;
  /** Agency fallback for a row whose department names none, e.g. "State of Utah". */
  buyerName: string;
  /** Portal name used in the description, e.g. "U3P (Bonfire)". */
  portalName: string;
  /** The tenant's own department → agency rule (verbatim unless the tenant publishes a mapping). */
  agencyName: (dept: string | null | undefined) => string;
}

/** The tenant's public list call — the same path on every Bonfire tenant. */
export const bonfireDataUrl = (cfg: BonfireConfig): string =>
  `${cfg.host}/PublicPortal/getOpenPublicOpportunitiesSectionData`;
/** The tenant's public portal page (the only URL a row's `source_url` never points at). */
export const bonfirePortalUrl = (cfg: BonfireConfig): string => `${cfg.host}/portal/?tab=openOpportunities`;
/** A project's public detail page on the tenant's own host. */
export const bonfireProjectUrl = (cfg: BonfireConfig, projectId: string): string =>
  `${cfg.host}/opportunities/${projectId}`;

export interface BonfireProject {
  ProjectID: string;
  ReferenceID: string | null;
  ProjectStatusID: string | null;
  ProjectName: string | null;
  DateClose: string | null;
  DepartmentID: string | null;
}

export interface BonfirePayload {
  projects: Record<string, BonfireProject>;
  departments: Record<string, { DepartmentName: string }>;
}

export interface BonfireParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/**
 * The verbatim department label, whitespace-collapsed; the tenant's buyer name when
 * the department names none. No code expansion (the source publishes no mapping).
 */
export function bonfireAgencyName(dept: string | null | undefined, fallback: string): string {
  const raw = String(dept ?? "").replace(/\s+/g, " ").trim();
  return raw || fallback;
}

/** "2026-10-19 21:00:00" (Bonfire's UTC DB-date string) → epoch ms, or NaN. */
export function bonfireCloseMs(s: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Change notices and sole-source intents are not open competitions. */
export function isNonCompetitiveBonfireNotice(title: string): boolean {
  return (
    /^contract\s+\d+\s+(amendment|extension)\b/i.test(title) ||
    /notice of intent to award without/i.test(title)
  );
}

function recordSkip(result: BonfireParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseBonfire(
  cfg: BonfireConfig,
  payload: BonfirePayload,
  now: number = Date.now(),
): BonfireParseResult {
  const result: BonfireParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const departments = payload.departments ?? {};
  for (const p of Object.values(payload.projects ?? {})) {
    const rowId = `${cfg.idPrefix}-${p.ProjectID}`;
    const title = String(p.ProjectName ?? "").replace(/\s+/g, " ").trim();
    if (!p.ProjectID || !title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (String(p.ProjectStatusID ?? "") !== BONFIRE_STATUS_OPEN) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (isNonCompetitiveBonfireNotice(title)) {
      recordSkip(result, rowId, "not_competitive");
      continue;
    }
    const closeMs = bonfireCloseMs(p.DateClose);
    if (!Number.isFinite(closeMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (closeMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = cfg.agencyName(departments[String(p.DepartmentID ?? "")]?.DepartmentName);
    const ref = String(p.ReferenceID ?? "").trim() || null;
    const description = [
      `${cfg.stateName} public procurement opportunity${ref ? ` ${ref}` : ""} posted by ${agency} on ${cfg.portalName}.`,
      "Documents and responses through the Bonfire portal (free vendor account; see source link).",
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: cfg.locationName ?? cfg.stateName,
      category: mapCategory("", title, description),
      due_date: new Date(closeMs).toISOString(),
      estimated_value: "Not specified",
      source_url: bonfireProjectUrl(cfg, p.ProjectID),
      set_aside: null,
      notice_type: null,
      solicitation_number: ref,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** Fetch one tenant's open-opportunity list and return ingest rows. */
export async function fetchBonfireBids(cfg: BonfireConfig, now: number = Date.now()): Promise<FetchResult> {
  const url = bonfireDataUrl(cfg);
  const fail = (detail: string): never => {
    console.error(`  ${cfg.source}: ${detail}`);
    throw new SourceUnreachableError(cfg.source, [detail]);
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: any;
  try {
    const resp = await fetch(`${url}?_=${now}`, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: bonfirePortalUrl(cfg) },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const payload = body?.payload;
  if (!body?.success || !payload || typeof payload.projects !== "object") {
    fail("response shape changed: no payload.projects");
  }
  const listed = Object.keys(payload.projects).length;
  const { rows, skipped, skippedRows } = parseBonfire(cfg, payload as BonfirePayload, now);
  console.log(
    `  ${cfg.source}: ${rows.length} open opportunities accepted (listed: ${listed}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
