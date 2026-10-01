/**
 * Pennsylvania eMarketplace — `pa_dgs_emarketplace`, the Commonwealth's public
 * solicitation board (www.emarketplace.state.pa.us, run by the Department of
 * General Services).
 *
 * WHY: Contrax's Pennsylvania feed was PennBid (local public bodies) only.
 * Commonwealth agencies (DGS, PennDOT, Corrections, DEP, Human Services, …)
 * and the COSTARS cooperative program advertise on eMarketplace.
 *
 * LABEL: older rows labelled `pa_emarketplace` exist from a retired import;
 * this connector uses a fresh label so those rows stay where they are.
 *
 * SOURCE (verified live 2026-10-01, no login): /Search.aspx is an ASP.NET
 * WebForms page whose grid shows 10 current solicitations per page. The
 * connector GETs the page, then posts it back with its own form state and the
 * "Rows" dropdown set to ALL (32767) — the same request the page's dropdown
 * makes — which returns every current solicitation in one grid (181 on
 * 2026-10-01). Each grid cell carries a `headers="ColumnHeader_<name>,
 * RowHeader_<solicitation #>"` attribute, which this parser keys on. If the
 * grid is missing, the run fails loudly (SourceUnreachableError).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = the title cell's `title` attribute (the source's original
 *                     casing; the visible text is re-cased by the site).
 *   - `description` = the solicitation type and number only. The grid's own
 *                     description is mostly Commonwealth boilerplate ("…Shipping
 *                     Or Delivery Costs…", "…Worker Protection…") that trade
 *                     matching would read as trucking/security work, so it is
 *                     not copied; the full text is on the linked page.
 *   - `agency`      = Agency column; `location` = "<County> County,
 *                     Pennsylvania", or "Pennsylvania" for Statewide/Multiple.
 *   - `due_date`    = Solicitation Due Date in Eastern time, as UTC. The
 *                     standing programs (COSTARS, …) show 12/31/2099 or
 *                     12/31/9999 (always open) → NULL.
 *   - `solicitation_number` = Solicitation #; `notice_type` = Types column.
 *   - `source_url`  = https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=<#>
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Statuses Open, Extended and Created (advertised, opening soon) are kept;
 * anything else, and rows whose due date has passed, are skipped with a
 * reason code.
 *
 * IDENTITY: `external_id = paemkt-<solicitation #>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const PAEMKT_SOURCE = "pa_dgs_emarketplace";
export const PAEMKT_ORIGIN = "https://www.emarketplace.state.pa.us";
export const PAEMKT_SEARCH_URL = `${PAEMKT_ORIGIN}/Search.aspx`;
/** The "ALL" option of the page's Rows dropdown. */
export const PAEMKT_ALL_ROWS = "32767";
export const PAEMKT_MAX_ROWS = 5000;
/** Standing programs (COSTARS, prequalification lists) show 12/31/2099 or
 *  12/31/9999 as their due date, meaning "always open": stored as NULL. */
export const PAEMKT_OPEN_ENDED_YEAR = 2099;

export const PAEMKT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

const KEPT_STATUSES = new Set(["open", "extended", "created"]);

export interface PaEmktRow {
  sid: string;
  type: string;
  title: string;
  agency: string;
  county: string;
  due: string;
  status: string;
}

export interface PaEmktParseResult {
  rows: RawBid[];
  parsed: PaEmktRow[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Raw inner HTML of the row's cell for one column, or "" if absent. */
function cellHtml(rowHtml: string, column: string): string {
  const m = rowHtml.match(new RegExp(`headers="ColumnHeader_${escapeRe(column)},RowHeader_[^"]*"[^>]*>([\\s\\S]*?)</td>`));
  return m ? m[1] : "";
}

/** US Eastern offset (hours) for a calendar date: EDT 2nd Sun Mar – 1st Sun Nov. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/**
 * "10/7/2026 3:00:00 PM" (Eastern) → UTC ISO. A date with no time becomes
 * 11:59 PM that day. The "always open" sentinels (year 2099 or 9999) and anything
 * unparseable → null.
 */
export function paEmktDueToIso(text: string | null | undefined): string | null {
  const t = decode(text);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])M)?$/i);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year >= PAEMKT_OPEN_ENDED_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hour = 23;
  let minute = 59;
  if (m[4]) {
    hour = (Number(m[4]) % 12) + (m[6].toUpperCase() === "P" ? 12 : 0);
    minute = Number(m[5]);
  }
  const offset = easternOffset(year, month, day);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 3_600_000).toISOString();
}

export function paEmktDetailUrl(sid: string): string {
  return `${PAEMKT_ORIGIN}/Solicitations.aspx?SID=${encodeURIComponent(sid)}`;
}

export function paEmktLocation(county: string): string {
  const c = county.trim();
  if (!c || /^(statewide|multiple)$/i.test(c)) return "Pennsylvania";
  return `${c} County, Pennsylvania`;
}

/** True when the HTML carries the eMarketplace results grid. */
export function isPaEmktSearchPage(html: string): boolean {
  return html.includes('id="ctl00_MainBody_grdResults"') && html.includes("ColumnHeader_Solicitation Due Date");
}

function recordSkip(result: PaEmktParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** Read the grid rows (no filtering). */
export function readPaEmktGrid(html: string): PaEmktRow[] {
  const out: PaEmktRow[] = [];
  const re = /<tr class="Grid(?:Alt)?Item">([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < PAEMKT_MAX_ROWS) {
    const row = m[1];
    const sidCell = cellHtml(row, "Solicitation #");
    const titleCell = cellHtml(row, "Solicitation Title");
    const titleAttr = titleCell.match(/<span[^>]*\btitle="([^"]*)"/);
    out.push({
      sid: decode(sidCell),
      type: decode(cellHtml(row, "Types")),
      title: decode(titleAttr ? titleAttr[1] : titleCell),
      agency: decode(cellHtml(row, "Agency")),
      county: decode(cellHtml(row, "County")),
      due: decode(cellHtml(row, "Solicitation Due Date")),
      status: decode(cellHtml(row, "Status")),
    });
  }
  return out;
}

/** PURE parse of the results grid — no network, no DB; `now` is injected. */
export function parsePaEmktSearch(html: string, now: number = Date.now()): PaEmktParseResult {
  const result: PaEmktParseResult = { rows: [], parsed: readPaEmktGrid(html), skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const [i, row] of result.parsed.entries()) {
    if (!row.sid) {
      recordSkip(result, `paemkt-row-${i}`, "missing_id");
      continue;
    }
    const rowId = `paemkt-${row.sid}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    if (!KEPT_STATUSES.has(row.status.toLowerCase())) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (!row.title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const due = paEmktDueToIso(row.due);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    // Neither the buyer nor the grid's boilerplate description is repeated
    // here: trade matching reads this text (see the header).
    const description =
      `${row.type ? `${row.type} ` : ""}${row.sid} advertised on PA eMarketplace, the Commonwealth of Pennsylvania's solicitation board. ` +
      "Full details and documents are on the eMarketplace solicitation page (see source link).";
    result.rows.push({
      external_id: rowId,
      title: row.title,
      agency: row.agency || "Commonwealth of Pennsylvania",
      description,
      location: paEmktLocation(row.county),
      category: mapCategory("", row.title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: paEmktDetailUrl(row.sid),
      set_aside: null,
      notice_type: row.type || null,
      solicitation_number: row.sid,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** Hidden ASP.NET form fields (__VIEWSTATE, __EVENTVALIDATION, …) of a page. */
export function paEmktHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /<input type="hidden" name="([^"]*)" id="[^"]*" value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) fields[m[1]] = decode(m[2]);
  return fields;
}

/** The postback body that switches the grid to ALL rows (current records). */
export function paEmktAllRowsBody(hidden: Record<string, string>): URLSearchParams {
  return new URLSearchParams({
    ...hidden,
    __EVENTTARGET: "ctl00$MainBody$ddlRows",
    __EVENTARGUMENT: "",
    ctl00$MainBody$txtBidNo: "",
    ctl00$MainBody$txtBidTitle: "",
    ctl00$MainBody$ddlAgency: "0",
    ctl00$MainBody$ddlCounty: "0",
    ctl00$MainBody$ddlTypes: "",
    ctl00$MainBody$rdolAdTypes: "11", // All
    ctl00$MainBody$txtbOpenDate: "",
    ctl00$MainBody$txtDatePre: "",
    ctl00$MainBody$ddlRows: PAEMKT_ALL_ROWS,
    ctl00$MainBody$rdoArch: "0", // current records
  });
}

function cookiesFrom(resp: Response): string {
  const setCookies =
    typeof (resp.headers as any).getSetCookie === "function"
      ? ((resp.headers as any).getSetCookie() as string[])
      : (resp.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_.-]+=)/);
  return setCookies
    .map((c) => (c.split(";")[0] ?? "").trim())
    .filter((p) => p.includes("="))
    .join("; ");
}

function fail(detail: string): never {
  console.error(`  ${PAEMKT_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(PAEMKT_SOURCE, [detail]);
}

/** Fetch every current eMarketplace solicitation and return ingest rows. */
export async function fetchPaEmarketplaceBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let html: string;
  try {
    const first = await fetch(PAEMKT_SEARCH_URL, { headers: PAEMKT_HEADERS, signal: controller.signal });
    if (first.status !== 200) fail(httpFailureDetail(first.status, PAEMKT_SEARCH_URL));
    const firstHtml = await first.text();
    if (!isPaEmktSearchPage(firstHtml)) fail(`page shape changed: no results grid (${firstHtml.length} bytes)`);
    const hidden = paEmktHiddenFields(firstHtml);
    if (!hidden.__VIEWSTATE) fail("page shape changed: no __VIEWSTATE");
    const cookie = cookiesFrom(first);
    const all = await fetch(PAEMKT_SEARCH_URL, {
      method: "POST",
      headers: {
        ...PAEMKT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: PAEMKT_SEARCH_URL,
        Origin: PAEMKT_ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: paEmktAllRowsBody(hidden).toString(),
      signal: controller.signal,
    });
    if (all.status !== 200) fail(httpFailureDetail(all.status, PAEMKT_SEARCH_URL));
    html = await all.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!isPaEmktSearchPage(html)) fail(`page shape changed: no results grid after postback (${html.length} bytes)`);
  const { rows, parsed, skipped, skippedRows } = parsePaEmktSearch(html, now);
  if (parsed.length === 0) fail("results grid was empty");
  console.log(
    `  ${PAEMKT_SOURCE}: ${rows.length} current solicitations accepted (grid rows: ${parsed.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
