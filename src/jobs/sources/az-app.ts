/**
 * Arizona Procurement Portal (APP) open solicitations — `az_app`, the State of
 * Arizona's statewide bid board (app.az.gov).
 *
 * WHY: Arizona was loaded once from a snapshot (#565, scripts/import-az-app.ts).
 * This connector keeps it live on the regular sync: new bids appear and
 * deadlines stay current. It writes the same `external_id`s as the snapshot
 * import ("az-app:BPM007809"), so existing rows are updated, never duplicated.
 *
 * SOURCE (verified live 2026-10-04, no login, no CAPTCHA): the public list
 *   https://app.az.gov/page.aspx/en/rfp/request_browse_public
 * is a standard ASP.NET page. The connector does what the page's own buttons do:
 *   1. GET the page (keeps the session cookies).
 *   2. POST its form with Status = "Open for Bidding" (body:x:selStatusCode_1=val)
 *      and the Search button.
 *   3. POST the grid's pager (__EVENTTARGET=body_x_grid_grd, Page|N) until a page
 *      brings no new rows.
 * The CSRFToken input sits outside <form>, so it is sent explicitly.
 * The site's front page and detail pages run a browser check; this connector
 * never requests them (no bypass). Links point at the detail page, which opens
 * normally in a person's browser.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `solicitation_number` = Code ("BPM007809"); `title` = Label.
 *   - `agency` = the listed organization(s), duplicates removed, "; "-joined.
 *   - `description` = the commodity plus code and deadline.
 *   - `location` = "Arizona"; `due_date` = the End column, which the portal
 *     labels UTC-7 (Arizona keeps MST all year).
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Skipped: status other than Open for Bidding (`not_open`), marked awarded
 * (`awarded`), deadline passed (`closed` — the board still lists some 2019
 * leftovers as open), unreadable deadline (`bad_date`).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const AZ_APP_SOURCE = "az_app";
export const AZ_APP_HOST = "https://app.az.gov";
export const AZ_APP_LIST_URL = `${AZ_APP_HOST}/page.aspx/en/rfp/request_browse_public`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAX_PAGES = 40;
const PAGE_DELAY_MS = 500;

export interface AzParseResult {
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

function cellText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** "10/19/2026 3:00:00 PM" (UTC-7) → epoch ms, or NaN. */
export function parseAzDate(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(s.trim());
  if (!m) return NaN;
  const hour = (Number(m[4]) % 12) + (m[7] === "PM" ? 12 : 0);
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour + 7, Number(m[5]), Number(m[6]));
}

/** The organization cell: one name, or a list of <li> names (deduplicated). */
export function azAgency(cellHtml: string): string {
  const items = [...cellHtml.matchAll(/<li[^>]*>(.*?)<\/li>/gis)].map((m) => cellText(m[1]));
  const names = items.length ? items : [cellText(cellHtml)];
  return [...new Set(names.filter(Boolean))].join("; ") || "State of Arizona";
}

/** Grid row ids on a page, in order. */
export function azRowIds(html: string): string[] {
  return [...html.matchAll(/<tr id="body_x_grid_grd_tr_(\d+)"/g)].map((m) => m[1]);
}

function recordSkip(result: AzParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/**
 * PURE parse of one or more list pages — no network, no DB; `now` is injected.
 * Columns: 0 edit, 1 Code, 2 Label, 3 pub begin (hidden), 4 Commodity,
 * 5 Organization, 6 pub end (hidden), 7 Status, 8 Awarded, 9 countdown,
 * 10 Begin, 11 End.
 */
export function parseAzPages(pages: string[], now: number = Date.now()): AzParseResult {
  const result: AzParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const page of pages) {
    for (const m of page.matchAll(/<tr id="body_x_grid_grd_tr_(\d+)"[^>]*>(.*?)<\/tr>/gs)) {
      const dataId = m[1];
      const cells = [...m[2].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => c[1]);
      const code = cells.length >= 12 ? cellText(cells[1]) : "";
      const rowId = code ? `az-app:${code}` : `az-app:row-${dataId}`;
      if (seen.has(rowId)) {
        recordSkip(result, rowId, "duplicate");
        continue;
      }
      seen.add(rowId);
      const title = code ? cellText(cells[2]) : "";
      if (!/^BPM\d+$/.test(code) || !title) {
        recordSkip(result, rowId, "missing_fields");
        continue;
      }
      const status = cellText(cells[7]);
      if (status !== "Open for Bidding") {
        recordSkip(result, rowId, "not_open");
        continue;
      }
      if (/value="True"/i.test(cells[8])) {
        recordSkip(result, rowId, "awarded");
        continue;
      }
      const due = cellText(cells[11]);
      const dueMs = parseAzDate(due);
      if (!Number.isFinite(dueMs)) {
        recordSkip(result, rowId, "bad_date");
        continue;
      }
      if (dueMs < now) {
        recordSkip(result, rowId, "closed");
        continue;
      }
      const commodity = cellText(cells[4]);
      const agency = azAgency(cells[5]);
      const description = [
        commodity ? `Commodity: ${commodity}.` : "",
        `Arizona Procurement Portal solicitation ${code}, due ${due} Arizona time.`,
        "Respond through the Arizona Procurement Portal (see source link).",
      ]
        .filter(Boolean)
        .join(" ");
      result.rows.push({
        external_id: rowId,
        title,
        agency,
        description,
        location: "Arizona",
        category: mapCategory("", title, commodity || description),
        due_date: new Date(dueMs).toISOString(),
        estimated_value: "Not specified",
        source_url: `${AZ_APP_HOST}/page.aspx/en/bpm/process_manage_extranet/${dataId}`,
        set_aside: null,
        notice_type: null,
        solicitation_number: code,
        naics_code: null,
        psc: null,
      });
    }
  }
  return result;
}

/** The page's form fields as a browser would post them (plus the CSRFToken outside <form>). */
export function azFormFields(html: string): [string, string][] {
  const start = html.indexOf('<form method="post"');
  const end = start >= 0 ? html.indexOf("</form>", start) : -1;
  const form = start >= 0 && end > start ? html.slice(start, end) : "";
  const attr = (tag: string, name: string) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
    return m ? decodeHtml(m[1]) : null;
  };
  const fields: [string, string][] = [];
  for (const m of form.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    const name = attr(tag, "name");
    if (!name) continue;
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/.test(tag)) continue;
    if (["submit", "button", "image", "file"].includes(type)) continue;
    fields.push([name, attr(tag, "value") ?? ""]);
  }
  for (const m of form.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>(.*?)<\/select>/gs)) {
    const opt = /<option[^>]*selected[^>]*value="([^"]*)"/.exec(m[2]);
    fields.push([decodeHtml(m[1]), opt ? decodeHtml(opt[1]) : ""]);
  }
  const token = /id="CSRFToken" type="hidden" value="([^"]*)"/.exec(html);
  return fields
    .filter(([k]) => k !== "CSRFToken" && k !== "__EVENTTARGET" && k !== "__EVENTARGUMENT")
    .concat(token ? [["CSRFToken", decodeHtml(token[1])]] : []);
}

function fail(detail: string): never {
  console.error(`  ${AZ_APP_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(AZ_APP_SOURCE, [detail]);
}

/** Fetch every "Open for Bidding" page and return ingest rows. */
export async function fetchAzAppBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const request = async (body?: URLSearchParams): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const headers: Record<string, string> = { "User-Agent": UA, Accept: "text/html" };
      if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      if (body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers.Referer = AZ_APP_LIST_URL;
      }
      const resp = await fetch(body ? `${AZ_APP_LIST_URL}?` : AZ_APP_LIST_URL, {
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
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, AZ_APP_LIST_URL));
      return await resp.text();
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await request();
  if (!first.includes('<form method="post"')) fail("list page shape changed: no form");
  const filter = azFormFields(first).filter(([k]) => k !== "body:x:selStatusCode_1");
  filter.push(["body:x:selStatusCode_1", "val"], ["body:x:prxFilterBar:x:cmdSearchBtn", ""], ["__EVENTTARGET", ""], ["__EVENTARGUMENT", ""]);
  let page = await request(new URLSearchParams(filter));
  const pages = [page];
  const ids = new Set(azRowIds(page));
  if (ids.size === 0) fail("no rows on the filtered list (page shape changed?)");
  for (let p = 1; p < MAX_PAGES; p++) {
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    const fields = azFormFields(page);
    fields.push(["__EVENTTARGET", "body_x_grid_grd"], ["__EVENTARGUMENT", `Page|${p}`]);
    page = await request(new URLSearchParams(fields));
    const fresh = azRowIds(page).filter((id) => !ids.has(id));
    if (fresh.length === 0) break;
    fresh.forEach((id) => ids.add(id));
    pages.push(page);
  }
  const { rows, skipped, skippedRows } = parseAzPages(pages, now);
  console.log(
    `  ${AZ_APP_SOURCE}: ${rows.length} open solicitations accepted (listed: ${ids.size} on ${pages.length} page(s); skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
