/**
 * Washington's Electronic Business Solution (WEBS) bid calendar — `wa_webs`,
 * the State of Washington's statewide bid board run by the Department of
 * Enterprise Services (pr-webs-vendor.des.wa.gov).
 *
 * SOURCE (verified live 2026-10-04, no login, no CAPTCHA): the public list
 *   https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx
 * ("See all bid opportunities" on the WEBS front page) is a classic ASP.NET
 * page listing every open solicitation, 25 per page. The connector does what
 * the page's own controls do:
 *   1. GET the page (keeps the session cookies).
 *   2. POST the grid's pager links (DataGrid1$_ctlN$_ctlM) until the last page.
 *      Each postback answers 302 to the same page and the result is the GET
 *      that follows (post/redirect/get; the state is in the session cookie).
 *   3. The rows carry no buyer name, so for each name in the page's
 *      "Filter by Government Organization" list it POSTs that filter with the
 *      Search button and pages it the same way. A bid's agency is the
 *      organization whose filtered list contains it.
 * Detail pages (Search_BidDetails.aspx) redirect to the WEBS login; this
 * connector never requests them. Links still point at them, because that is
 * where the board itself sends vendors (free WEBS vendor account).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `external_id` = "wa-webs:<WEBS ID>" (the ID in the detail link).
 *   - `solicitation_number` = the "Ref#"; `title` = the link text.
 *   - `agency` = the filter organization(s) listing it; if none does,
 *     "Washington public agency (WEBS)" rather than a guessed name.
 *   - `description` = the listed summary plus the pre-bid conference,
 *     question deadline and latest amendment date when shown.
 *   - `location` = "Washington"; `due_date` = the close date. WEBS lists a date
 *     only (MM/DD/YY), so it is stored as 11:59 PM Pacific that day; the real
 *     cut-off time is in the solicitation documents and the description says so.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Skipped: "Selective" solicitations (only invited vendors may respond —
 * `selective`), close date passed (`closed`), unreadable close date
 * (`bad_date`), missing ID/title/Ref# (`missing_fields`).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const WA_WEBS_SOURCE = "wa_webs";
export const WA_WEBS_HOST = "https://pr-webs-vendor.des.wa.gov";
export const WA_WEBS_LIST_URL = `${WA_WEBS_HOST}/BidCalendar.aspx`;
export const WA_WEBS_FALLBACK_AGENCY = "Washington public agency (WEBS)";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAX_PAGES = 40;
const MAX_ORGS = 200;
const PAGE_DELAY_MS = 500;

export interface WaParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function text(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** US Pacific offset (hours) for a calendar date: PDT 2nd Sun Mar – 1st Sun Nov. */
function pacificOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -7 : -8;
}

/** "10/05/26" → 11:59 PM Pacific that day, as epoch ms; anything else → NaN. */
export function parseWaCloseDate(s: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  const [month, day, year] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return NaN;
  return Date.UTC(year, month - 1, day, 23, 59) - pacificOffset(year, month, day) * 3_600_000;
}

/** The DataGrid1 rows of one page, as raw HTML chunks (each holds a nested table). */
export function waRowChunks(html: string): string[] {
  const start = html.indexOf('id="DataGrid1"');
  if (start < 0) return [];
  let end = html.indexOf('<tr align="right">', start);
  if (end < 0) end = html.indexOf("javascript:history.go(-1)", start);
  const grid = html.slice(start, end < 0 ? undefined : end);
  return grid.split(/<tr class="grid_item(?:_alt)?">/).slice(1);
}

/** WEBS IDs on a page, in order. */
export function waRowIds(html: string): string[] {
  return waRowChunks(html)
    .map((c) => /Search_BidDetails\.aspx\?ID=(\d+)/.exec(c)?.[1])
    .filter((x): x is string => !!x);
}

/** The pager's postback target for the page after the current one, or null on the last page. */
export function waNextPageTarget(html: string): string | null {
  const m = /<tr align="right">\s*<td colspan="3">(.*?)<\/td>/s.exec(html);
  if (!m) return null;
  const after = m[1].split(/<span>\d+<\/span>/)[1];
  if (after === undefined) return null;
  const link = /__doPostBack\(&#39;(DataGrid1\$_ctl\d+\$_ctl\d+)&#39;/.exec(after);
  return link ? link[1] : null;
}

/** The "Filter by Government Organization" options (value, name), without "<All>". */
export function waOrganizations(html: string): [string, string][] {
  const select = /<select name="ddlOrgNames"[^>]*>(.*?)<\/select>/s.exec(html);
  if (!select) return [];
  return [...select[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/g)]
    .filter((m) => m[1] !== "0")
    .map((m) => [m[1], text(m[2])]);
}

/** The form's hidden fields as a browser would post them. */
export function waFormFields(html: string): [string, string][] {
  const fields: [string, string][] = [];
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"[^>]*value="([^"]*)"/g)) {
    if (m[1] === "__EVENTTARGET" || m[1] === "__EVENTARGUMENT") continue;
    fields.push([m[1], decodeHtml(m[2])]);
  }
  return fields;
}

function recordSkip(result: WaParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

function span(chunk: string, suffix: string): string {
  const m = new RegExp(`<span id="DataGrid1__ctl\\d+_${suffix}"[^>]*>(.*?)</span>`, "s").exec(chunk);
  return m ? text(m[1]) : "";
}

/**
 * PURE parse of the list pages — no network, no DB; `now` is injected.
 * `agencies` maps WEBS ID → organization names (from the filtered passes).
 */
export function parseWaPages(pages: string[], agencies: Map<string, string[]>, now: number = Date.now()): WaParseResult {
  const result: WaParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  pages.forEach((page, p) => {
    waRowChunks(page).forEach((chunk, i) => {
      const link = /<a id="DataGrid1__ctl\d+_DetailsHyperlink" href="Search_BidDetails\.aspx\?ID=(\d+)">(.*?)<\/a>/s.exec(chunk);
      const webId = link?.[1];
      const rowId = webId ? `wa-webs:${webId}` : `wa-webs:page${p}-row${i}`;
      if (seen.has(rowId)) {
        recordSkip(result, rowId, "duplicate");
        return;
      }
      seen.add(rowId);
      const title = link ? text(link[2]) : "";
      const body = link ? chunk.slice(link.index + link[0].length).split(/<div id="DataGrid1__ctl\d+_SolicitationsUpdatePanel">/)[0] : "";
      const ref = /Ref#:(.*?)<br\s*\/?>/s.exec(body);
      const refNo = ref ? text(ref[1]) : "";
      if (!webId || !title || !refNo) {
        recordSkip(result, rowId, "missing_fields");
        return;
      }
      if (/selective/i.test(span(chunk, "lblSelective"))) {
        recordSkip(result, rowId, "selective");
        return;
      }
      const close = /<div class="grid_item_td"[^>]*>\s*([^<]*?)\s*<br/.exec(chunk)?.[1] ?? "";
      const dueMs = parseWaCloseDate(close);
      if (!Number.isFinite(dueMs)) {
        recordSkip(result, rowId, "bad_date");
        return;
      }
      if (dueMs < now) {
        recordSkip(result, rowId, "closed");
        return;
      }
      const summary = ref ? text(body.slice(ref.index + ref[0].length)) : "";
      const preBid = span(chunk, "PreBidConferenceLabel");
      const questions = span(chunk, "QAPeriodLabel");
      const amended = span(chunk, "lblAmendmentDate");
      const description = [
        summary,
        preBid ? `Pre-bid conference: ${preBid}.` : "",
        questions ? `Deadline for questions: ${questions}.` : "",
        amended ? `Last amended ${amended}.` : "",
        `WEBS solicitation ${refNo}, closes ${close} (time of day is in the solicitation documents).`,
        "Respond through Washington's Electronic Business Solution (WEBS; see source link).",
      ]
        .filter(Boolean)
        .join(" ");
      const names = agencies.get(webId) ?? [];
      result.rows.push({
        external_id: rowId,
        title,
        agency: [...new Set(names)].join("; ") || WA_WEBS_FALLBACK_AGENCY,
        description,
        location: "Washington",
        category: mapCategory("", title, summary || description),
        due_date: new Date(dueMs).toISOString(),
        estimated_value: "Not specified",
        source_url: `${WA_WEBS_HOST}/Search_BidDetails.aspx?ID=${webId}`,
        set_aside: null,
        notice_type: null,
        solicitation_number: refNo,
        naics_code: null,
        psc: null,
      });
    });
  });
  return result;
}

function fail(detail: string): never {
  console.error(`  ${WA_WEBS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(WA_WEBS_SOURCE, [detail]);
}

/** Fetch every open WEBS solicitation and return ingest rows. */
export async function fetchWaWebsBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const request = async (body?: URLSearchParams): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const headers: Record<string, string> = { "User-Agent": UA, Accept: "text/html" };
      if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      if (body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers.Referer = WA_WEBS_LIST_URL;
      }
      const resp = await fetch(WA_WEBS_LIST_URL, {
        method: body ? "POST" : "GET",
        headers,
        body: body?.toString(),
        redirect: "manual",
        signal: controller.signal,
      });
      const setCookies: string[] =
        typeof (resp.headers as any).getSetCookie === "function" ? (resp.headers as any).getSetCookie() : [];
      for (const c of setCookies) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      // Every postback answers 302 back to the same page (post/redirect/get);
      // the new page state lives in the session, so follow it with a GET.
      // A redirect anywhere else (e.g. the login page) is a failure.
      if (body && resp.status === 302 && /^(\/|https:\/\/pr-webs-vendor\.des\.wa\.gov\/)BidCalendar\.aspx$/i.test(resp.headers.get("location") ?? "")) {
        clearTimeout(timer);
        return await request();
      }
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, WA_WEBS_LIST_URL));
      return await resp.text();
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
  };
  const post = (page: string, extra: [string, string][]) => {
    const names = new Set(extra.map(([k]) => k));
    return request(new URLSearchParams([...waFormFields(page).filter(([k]) => !names.has(k)), ...extra]));
  };
  const pause = () => new Promise((r) => setTimeout(r, PAGE_DELAY_MS));

  /** Follow the pager from `page` (already filtered by `org`); returns every page. */
  const walk = async (page: string, org: string): Promise<string[]> => {
    const pages = [page];
    const ids = new Set(waRowIds(page));
    for (let p = 1; p < MAX_PAGES; p++) {
      const target = waNextPageTarget(page);
      if (!target) break;
      await pause();
      page = await post(page, [["__EVENTTARGET", target], ["__EVENTARGUMENT", ""], ["ddlOrgNames", org]]);
      const fresh = waRowIds(page).filter((id) => !ids.has(id));
      if (fresh.length === 0) break;
      fresh.forEach((id) => ids.add(id));
      pages.push(page);
    }
    return pages;
  };

  const first = await request();
  if (!first.includes('id="DataGrid1"')) fail("bid calendar shape changed: no DataGrid1");
  const pages = await walk(first, "0");
  const listed = new Set(pages.flatMap(waRowIds));
  if (listed.size === 0) fail("no rows on the bid calendar (page shape changed?)");

  const orgs = waOrganizations(first).slice(0, MAX_ORGS);
  if (orgs.length === 0) fail("organization filter list is empty (page shape changed?)");
  const agencies = new Map<string, string[]>();
  for (const [value, name] of orgs) {
    await pause();
    const filtered = await post(first, [["ddlOrgNames", value], ["ImageButton1", "Search"], ["__EVENTTARGET", ""], ["__EVENTARGUMENT", ""]]);
    for (const id of (await walk(filtered, value)).flatMap(waRowIds)) {
      agencies.set(id, [...(agencies.get(id) ?? []), name]);
    }
  }

  const { rows, skipped, skippedRows } = parseWaPages(pages, agencies, now);
  const unmatched = [...listed].filter((id) => !agencies.has(id)).length;
  console.log(
    `  ${WA_WEBS_SOURCE}: ${rows.length} open solicitations accepted (listed: ${listed.size} on ${pages.length} page(s); ${orgs.length} organizations, ${unmatched} without one; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
