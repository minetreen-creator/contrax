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
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = ProjectName; `solicitation_number` = ReferenceID.
 *   - `agency` = the posting department without its category prefix
 *     ("CITIES - City of Orem" → "City of Orem"; "Division of Purchasing" →
 *     "Utah Division of Purchasing").
 *   - `due_date` = DateClose, which Bonfire stores in UTC (the portal parses it
 *     with createMomentFromUtcDateString; the org time zone is America/Denver).
 *   - `location` = "Utah"; `naics_code` / `psc` / `set_aside` stay NULL.
 * Skipped: not open (`not_open`), close date passed (`closed`), and notices
 * that are not open competitions — contract amendment/extension requests and
 * notices of intent to award without a standard procurement
 * (`not_competitive`).
 *
 * IDENTITY: `external_id = utbonfire-<ProjectID>` (Bonfire's own id).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const UT_BONFIRE_SOURCE = "ut_bonfire";
export const UT_BONFIRE_HOST = "https://utah.bonfirehub.com";
export const UT_BONFIRE_DATA_URL = `${UT_BONFIRE_HOST}/PublicPortal/getOpenPublicOpportunitiesSectionData`;
export const UT_BONFIRE_PORTAL_URL = `${UT_BONFIRE_HOST}/portal/?tab=openOpportunities`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Bonfire ProjectStatusID for an open project. */
const STATUS_OPEN = "2";

export interface UtProject {
  ProjectID: string;
  ReferenceID: string | null;
  ProjectStatusID: string | null;
  ProjectName: string | null;
  DateClose: string | null;
  DepartmentID: string | null;
}

export interface UtPayload {
  projects: Record<string, UtProject>;
  departments: Record<string, { DepartmentName: string }>;
}

export interface UtParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

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

/** "2026-10-19 21:00:00" (UTC) → epoch ms, or NaN. */
export function utCloseMs(s: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Change notices and sole-source intents are not open competitions. */
export function isNonCompetitiveUtNotice(title: string): boolean {
  return (
    /^contract\s+\d+\s+(amendment|extension)\b/i.test(title) ||
    /notice of intent to award without/i.test(title)
  );
}

function recordSkip(result: UtParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseUtBonfire(payload: UtPayload, now: number = Date.now()): UtParseResult {
  const result: UtParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const departments = payload.departments ?? {};
  for (const p of Object.values(payload.projects ?? {})) {
    const rowId = `utbonfire-${p.ProjectID}`;
    const title = String(p.ProjectName ?? "").replace(/\s+/g, " ").trim();
    if (!p.ProjectID || !title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (String(p.ProjectStatusID ?? "") !== STATUS_OPEN) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (isNonCompetitiveUtNotice(title)) {
      recordSkip(result, rowId, "not_competitive");
      continue;
    }
    const closeMs = utCloseMs(p.DateClose);
    if (!Number.isFinite(closeMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (closeMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = utAgencyName(departments[String(p.DepartmentID ?? "")]?.DepartmentName);
    const ref = String(p.ReferenceID ?? "").trim() || null;
    const description = [
      `Utah public procurement opportunity${ref ? ` ${ref}` : ""} posted by ${agency} on U3P (Bonfire).`,
      "Documents and responses through the Bonfire portal (free vendor account; see source link).",
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Utah",
      category: mapCategory("", title, description),
      due_date: new Date(closeMs).toISOString(),
      estimated_value: "Not specified",
      source_url: `${UT_BONFIRE_HOST}/opportunities/${p.ProjectID}`,
      set_aside: null,
      notice_type: null,
      solicitation_number: ref,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${UT_BONFIRE_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(UT_BONFIRE_SOURCE, [detail]);
}

/** Fetch the portal's open-opportunity list and return ingest rows. */
export async function fetchUtBonfireBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: any;
  try {
    const resp = await fetch(`${UT_BONFIRE_DATA_URL}?_=${now}`, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: UT_BONFIRE_PORTAL_URL },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, UT_BONFIRE_DATA_URL));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const payload = body?.payload;
  if (!body?.success || !payload || typeof payload.projects !== "object") fail("response shape changed: no payload.projects");
  const listed = Object.keys(payload.projects).length;
  const { rows, skipped, skippedRows } = parseUtBonfire(payload as UtPayload, now);
  console.log(
    `  ${UT_BONFIRE_SOURCE}: ${rows.length} open opportunities accepted (listed: ${listed}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
