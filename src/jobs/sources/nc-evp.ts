/**
 * North Carolina electronic Vendor Portal (eVP) open solicitations — `nc_evp`.
 *
 * WHY: eVP is North Carolina's statewide bid board: state agencies, the UNC
 * system, community colleges, public schools and local governments (counties,
 * cities) all post there. Until 2026-10-11 Contrax held only a one-time
 * snapshot (scripts/import-nc-evp.ts, captured 2026-09-30), so NC bids went
 * stale; this connector reads the live list on every sync (owner 2026-10-11:
 * "Lets do NC").
 *
 * SOURCE (verified live 2026-10-11, no login, no CAPTCHA, no challenge): the
 * public page https://evp.nc.gov/solicitations/ is a Microsoft Power Pages
 * entity list. A browser loads its rows with three public requests, and this
 * reader makes the same three:
 *   1. GET  /solicitations/ — the page carries the list's `data-view-layouts`
 *      (base64 JSON; its `Base64SecureConfiguration` names the view) and its
 *      `data-get-url` (/_services/entity-grid-data.json/<id>).
 *   2. GET  /_layout/tokenhtml — the site's standard anti-forgery token (with
 *      the session cookies from 1).
 *   3. POST <data-get-url> with `metaFilter: "3=0"` — the page's own
 *      "Solicitation Status = Open" filter — and pageSize 500 (260 open on
 *      2026-10-11, one page). `MoreRecords` drives further pages.
 * The page's script tag for radcaptcha.js is Power Pages' generic form helper;
 * the list itself has no CAPTCHA.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = Project Title (`evp_name`), `description` = `evp_description`,
 *     `agency` = the posting department (`owningbusinessunit`), all verbatim.
 *   - `solicitation_number` = `evp_solicitationnbr`.
 *   - `due_date` = Opening Date (`evp_opendate`). eVP stores it as a
 *     zone-less wall time that its own detail page compares in
 *     America/New_York ("stored timezone independent"), and the list's
 *     FormattedValue shows that same wall time ("10/22/2026 1:00 PM" for
 *     /Date(1792674000000)/ = 13:00 on the wire) — so the wire value's UTC
 *     fields are read as Eastern time (EDT −4 / EST −5).
 *   - `location` = "North Carolina" (the department names the county or city
 *     for local buyers); `category` = mapCategory over title + description.
 *   - `source_url` = the public detail page, `/solicitations/details/?id=<guid>`.
 *   - `estimated_value` = "" and `naics_code` / `psc` / `set_aside` NULL — the
 *     list shows none of them.
 * Skips: a status other than Open (`not_open`), an opening time already past
 * (`closed`), a missing id / title / department / opening date.
 *
 * IDENTITY: `external_id = nc-evp:<evp_solicitationid>` — the same key the
 * 2026-09-30 snapshot import used, so those rows are refreshed, not duplicated.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const NC_EVP_SOURCE = "nc_evp";
export const NC_EVP_ORIGIN = "https://evp.nc.gov";
export const NC_EVP_PAGE_URL = `${NC_EVP_ORIGIN}/solicitations/`;
/** statuscode value of an Open solicitation. */
export const NC_EVP_STATUS_OPEN = 790550000;
/** The page's own "Solicitation Status = Open" filter (filter 3, condition 0). */
const OPEN_META_FILTER = "3=0";
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface NcEvpAttribute {
  Name: string;
  Value?: unknown;
  FormattedValue?: string | null;
}
export interface NcEvpRecord {
  Id?: string | null;
  Attributes?: NcEvpAttribute[] | null;
}
export interface NcEvpParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

function attr(rec: NcEvpRecord, name: string): NcEvpAttribute | undefined {
  return (rec.Attributes ?? []).find((a) => a?.Name === name);
}

/** Eastern offset (hours) for a wall-clock date: EDT −4 from the 2nd Sunday of March to the 1st Sunday of November, else EST −5. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "/Date(1792674000000)/" (an Eastern wall time on the wire) → "2026-10-22T17:00:00.000Z". Invalid → null. */
export function ncEvpWallTimeToIso(value: unknown): string | null {
  const m = typeof value === "string" ? value.match(/^\/Date\((-?\d+)\)\/$/) : null;
  if (!m) return null;
  const wall = new Date(Number(m[1]));
  if (!Number.isFinite(wall.getTime())) return null;
  const offset = easternOffset(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate());
  return new Date(wall.getTime() - offset * 3_600_000).toISOString();
}

export function ncEvpDetailUrl(id: string): string {
  return `${NC_EVP_ORIGIN}/solicitations/details/?id=${encodeURIComponent(id)}`;
}

function recordSkip(result: NcEvpParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of the grid's `Records` — no network, no DB; `now` is injected. */
export function parseNcEvp(records: readonly NcEvpRecord[], now: number = Date.now()): NcEvpParseResult {
  const result: NcEvpParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const [i, rec] of records.entries()) {
    const guid = clean(rec.Id) || clean(attr(rec, "evp_solicitationid")?.Value);
    const rowId = guid ? `nc-evp:${guid}` : `nc-evp:row-${i}`;
    if (!guid) {
      recordSkip(result, rowId, "missing_id");
      continue;
    }
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    const status = (attr(rec, "statuscode")?.Value as { Value?: unknown } | undefined)?.Value;
    if (status !== NC_EVP_STATUS_OPEN) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const title = clean(attr(rec, "evp_name")?.Value);
    const dept = clean((attr(rec, "owningbusinessunit")?.Value as { Name?: unknown } | undefined)?.Name);
    if (!title || !dept) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const due = ncEvpWallTimeToIso(attr(rec, "evp_opendate")?.Value);
    if (!due) {
      recordSkip(result, rowId, "missing_due");
      continue;
    }
    if (Date.parse(due) <= now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const description = clean(attr(rec, "evp_description")?.Value);
    const number = clean(attr(rec, "evp_solicitationnbr")?.Value);
    result.rows.push({
      external_id: rowId,
      title,
      agency: dept,
      description,
      location: "North Carolina",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "",
      source_url: ncEvpDetailUrl(guid),
      set_aside: null,
      notice_type: null,
      solicitation_number: number || null,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** The list's view config and data URL, read from the public page. PURE. */
export function readNcEvpListConfig(html: string): { secureConfig: string; sortExpression: string; dataPath: string } | null {
  const layouts = html.match(/data-view-layouts="([^"]+)"/);
  const getUrl = html.match(/data-get-url="(\/_services\/entity-grid-data\.json\/[0-9a-f-]+)"/i);
  if (!layouts || !getUrl) return null;
  try {
    const decoded = JSON.parse(Buffer.from(layouts[1]!.replace(/&#43;/g, "+").replace(/&#x2B;/gi, "+"), "base64").toString("utf8"));
    const first = Array.isArray(decoded) ? decoded[0] : null;
    const secureConfig = typeof first?.Base64SecureConfiguration === "string" ? first.Base64SecureConfiguration : "";
    if (!secureConfig) return null;
    return { secureConfig, sortExpression: String(first.SortExpression ?? ""), dataPath: getUrl[1]! };
  } catch {
    return null;
  }
}

/** Session cookies from a response, as one Cookie header value. */
function cookiesFrom(resp: Response, jar: Map<string, string>) {
  for (const c of resp.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const eq = pair!.indexOf("=");
    if (eq > 0) jar.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
  }
}
function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function fail(detail: string): never {
  console.error(`  ${NC_EVP_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(NC_EVP_SOURCE, [detail]);
}

/** Fetch eVP's open solicitations and return one bid per open listing. */
export async function fetchNcEvpBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const jar = new Map<string, string>();
  const records: NcEvpRecord[] = [];
  try {
    const page = await fetch(NC_EVP_PAGE_URL, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (page.status !== 200) fail(httpFailureDetail(page.status, NC_EVP_PAGE_URL));
    cookiesFrom(page, jar);
    const config = readNcEvpListConfig(await page.text());
    if (!config) fail("page shape changed: no solicitation list configuration on the page");

    const tokenUrl = `${NC_EVP_ORIGIN}/_layout/tokenhtml`;
    const tokenResp = await fetch(tokenUrl, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(jar), Referer: NC_EVP_PAGE_URL },
      signal: controller.signal,
    });
    if (tokenResp.status !== 200) fail(httpFailureDetail(tokenResp.status, tokenUrl));
    cookiesFrom(tokenResp, jar);
    const token = (await tokenResp.text()).match(/value="([^"]+)"/)?.[1];
    if (!token) fail("page shape changed: no request token");

    const dataUrl = `${NC_EVP_ORIGIN}${config!.dataPath}`;
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const resp = await fetch(dataUrl, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          __RequestVerificationToken: token!,
          Cookie: cookieHeader(jar),
          Referer: NC_EVP_PAGE_URL,
        },
        body: JSON.stringify({
          base64SecureConfiguration: config!.secureConfig,
          sortExpression: config!.sortExpression,
          search: "",
          page: pageNo,
          pageSize: PAGE_SIZE,
          pagingCookie: "",
          filter: "",
          metaFilter: OPEN_META_FILTER,
          timezoneOffset: 0,
          customParameters: [],
          entityName: "",
          entityId: "",
          nlSearch: "",
        }),
        signal: controller.signal,
      });
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, dataUrl));
      const body = (await resp.json()) as { Records?: unknown; MoreRecords?: unknown };
      if (!Array.isArray(body?.Records)) fail("page shape changed: no Records array in the list response");
      records.push(...(body.Records as NcEvpRecord[]));
      if (body.MoreRecords !== true) break;
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const r = parseNcEvp(records, now);
  console.log(
    `  ${NC_EVP_SOURCE}: ${r.rows.length} open solicitations accepted (read ${records.length}; skips: ${
      Object.entries(r.skipped)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows: r.rows, skipped: r.skipped, skippedRows: r.skippedRows };
}
