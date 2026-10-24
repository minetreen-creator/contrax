/**
 * Vermont Business Registry and Bid System — `vt_vbr`, the State of
 * Vermont's public bid board (www.vermontbusinessregistry.com, run by the
 * Agency of Commerce and Community Development).
 *
 * WHY: Contrax had no state Vermont feed. State agencies (Buildings &
 * General Services, Agency of Transportation, Education, Human Services
 * departments, DEC, …) post there, and so do Vermont towns, cities and
 * districts.
 *
 * SOURCE (verified live 2026-10-02, no login, no CAPTCHA):
 *   1. GET BidSearch.aspx?type=5 — "Open State Bids" (44 at capture) and
 *      GET BidSearch.aspx?type=7 — "Open Municipal Bids" (35), one page
 *      each. Every bid is a title link to BidPreview.aspx?BidID=<id>, the
 *      authoring entity (span id="lblOrganization") and the close date
 *      (span id="lblCloseDate", "11/20/2026 4:30:00 PM"). Federal, private
 *      and sources-sought lists are not fetched.
 *   2. GET BidPreview.aspx?BidID=<id> — the bid's public detail page:
 *      closing date, RFQ number, estimated dollar value, bid type, work
 *      locations (counties), keywords and the bid description.
 * A list longer than 50 bids pages with an ASP.NET pager (state list, 53
 * open on 2026-10-24): each further page is a POST back to the same URL with
 * the page's hidden form fields and `__EVENTTARGET=gvResults`,
 * `__EVENTARGUMENT=Page$N`, sent with the session and firewall cookies the
 * first GET set (without them the site answers 302). A page that should exist
 * but lists no bids fails loudly rather than ingesting a partial list.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the bid title; `agency` = the authoring entity.
 *   - `location` = "Vermont" (every author on these two lists is a Vermont
 *     state or municipal body); the work counties go in the description.
 *   - `due_date` = the closing date/time in Eastern time.
 *   - `description` = the bid description (emails, phone numbers and the
 *     author's name replaced; contacts are not ingested, agency words cause
 *     false trade matches), plus bid type, counties and keywords.
 *   - `estimated_value` = "Est. Dollar Value" when above $0.
 *   - `solicitation_number` = "RFQ Number" when given, else the bid id.
 *   - `source_url` = the bid's BidPreview page.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * When a detail page cannot be read the bid is still listed from the list
 * fields alone. Bids whose close time has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = vtvbr-<BidID>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const VT_VBR_SOURCE = "vt_vbr";
export const VT_VBR_ORIGIN = "https://www.vermontbusinessregistry.com";
/** BidSearch.aspx list types that are public buyers. */
export const VT_VBR_LIST_TYPES = { state: "5", municipal: "7" } as const;
const DETAIL_CONCURRENCY = 4;
/** Hard ceiling on list pages per type, so a pager bug can never loop forever. */
export const VBR_MAX_PAGES = 10;
const MAX_DESCRIPTION = 1500;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

export interface VbrListBid {
  id: string;
  title: string;
  author: string;
  close: string;
  kind: "state" | "municipal";
}

export interface VbrDetail {
  close: string;
  rfqNumber: string;
  estValue: string;
  bidType: string;
  locations: string;
  keywords: string;
  description: string;
}

export interface VbrParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** US Eastern offset (hours) for a calendar date: EDT 2nd Sun Mar – 1st Sun Nov. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "11/20/2026 4:30:00 PM" (or "10/30/2026 1:00 PM") → ISO, Eastern. Invalid → null. */
export function vbrDateToIso(text: string): string | null {
  const m = decode(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)$/i);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (m[6]!.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (m[6]!.toUpperCase() === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - easternOffset(year, month, day) * 3_600_000).toISOString();
}

/** True when a list page links to page `n` of its results. */
export function vbrHasPageLink(html: string, n: number): boolean {
  return html.includes(`__doPostBack(&#39;gvResults&#39;,&#39;Page$${n}&#39;)`) || html.includes(`__doPostBack('gvResults','Page$${n}')`);
}

/** The hidden ASP.NET form fields on a list page (view state, validation…), decoded. */
export function vbrHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*\btype="hidden"[^>]*>/gi)) {
    const name = m[0].match(/\bname="([^"]*)"/i)?.[1];
    if (!name) continue;
    const value = m[0].match(/\bvalue="([^"]*)"/i)?.[1] ?? "";
    fields[decodeAttr(name)] = decodeAttr(value);
  }
  return fields;
}

function decodeAttr(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** The bids on one BidSearch.aspx list page, in page order. */
export function readVbrList(html: string, kind: VbrListBid["kind"]): VbrListBid[] {
  const out: VbrListBid[] = [];
  const re =
    /BidPreview\.aspx\?BidID=(\d+)[^>]*>([\s\S]*?)<\/a>[\s\S]*?id="lblOrganization"[^>]*>([\s\S]*?)<\/span>[\s\S]*?id="lblCloseDate"[^>]*>([\s\S]*?)<\/span>/gi;
  for (const m of html.matchAll(re)) {
    out.push({ id: m[1]!, title: decode(m[2]!), author: decode(m[3]!), close: decode(m[4]!), kind });
  }
  return out;
}

function span(html: string, id: string): string {
  const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</span>`, "i"));
  return m ? decode(m[1]!) : "";
}

/** The fields of a BidPreview.aspx page. */
export function readVbrDetail(html: string): VbrDetail {
  return {
    close: span(html, "lblBidCloseDate"),
    rfqNumber: span(html, "lblRFQNumber"),
    estValue: span(html, "lblEstDollarValue"),
    bidType: span(html, "lblBidType"),
    locations: span(html, "lblBidLocations"),
    keywords: span(html, "lblBidKeywords"),
    description: span(html, "lblBidDescription"),
  };
}

function recordSkip(result: VbrParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/**
 * PURE parse — no network, no DB; `now` is injected. `details` maps a BidID
 * to its parsed detail page (missing → list fields only).
 */
export function parseVbrBids(list: readonly VbrListBid[], details: Record<string, VbrDetail | null>, now: number = Date.now()): VbrParseResult {
  const result: VbrParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const b of list) {
    const rowId = `vtvbr-${b.id}`;
    if (seen.has(b.id)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(b.id);
    if (!b.title || !b.author) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const d = details[b.id] ?? null;
    const due = vbrDateToIso(b.close) ?? (d ? vbrDateToIso(d.close) : null);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const scrub = (s: string) =>
      s
        .replace(EMAIL_RE, "(email on the bid page)")
        .replace(PHONE_RE, "(phone on the bid page)")
        .replace(new RegExp(`(?:\\b[Tt]he\\s+)?\\b${escapeRegExp(b.author)}\\b`, "gi"), "the buyer");
    let text = d ? scrub(d.description) : "";
    if (text.length > MAX_DESCRIPTION) text = `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
    const description = [
      text,
      d?.bidType ? `Bid type: ${d.bidType}.` : "",
      d?.locations ? `Work location: ${d.locations} (Vermont).` : "",
      d?.keywords ? `Keywords: ${d.keywords}.` : "",
      `Posted on the Vermont Business Registry and Bid System as a ${b.kind} bid.`,
    ]
      .filter(Boolean)
      .join(" ");
    const est = d?.estValue && /[1-9]/.test(d.estValue.replace(/\.00$/, "")) ? d.estValue : "";
    result.rows.push({
      external_id: rowId,
      title: b.title,
      agency: b.author,
      description,
      location: "Vermont",
      category: mapCategory("", b.title, description),
      due_date: due,
      estimated_value: est || "Not specified",
      source_url: `${VT_VBR_ORIGIN}/BidPreview.aspx?BidID=${b.id}`,
      set_aside: null,
      notice_type: d?.bidType || "Solicitation",
      solicitation_number: d?.rfqNumber || b.id,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${VT_VBR_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(VT_VBR_SOURCE, [detail]);
}

/** Cookies by name, carried from a list GET into its paging POSTs. */
type CookieJar = Map<string, string>;

function cookieHeader(jar: CookieJar): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function getText(url: string, opts: { jar?: CookieJar; form?: Record<string, string> } = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const headers: Record<string, string> = { "User-Agent": UA, Accept: "text/html" };
    if (opts.jar && opts.jar.size > 0) headers.Cookie = cookieHeader(opts.jar);
    let body: string | undefined;
    if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    }
    const resp = await fetch(url, { method: opts.form ? "POST" : "GET", headers, body, redirect: opts.form ? "manual" : "follow", signal: controller.signal });
    if (opts.jar) {
      for (const c of resp.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const eq = pair!.indexOf("=");
        if (eq > 0) opts.jar.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
      }
    }
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    return await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch Vermont's open state and municipal bids and return ingest rows. */
export async function fetchVtVbrBids(now: number = Date.now()): Promise<FetchResult> {
  const list: VbrListBid[] = [];
  for (const [kind, type] of Object.entries(VT_VBR_LIST_TYPES) as [VbrListBid["kind"], string][]) {
    const url = `${VT_VBR_ORIGIN}/BidSearch.aspx?type=${type}`;
    const jar: CookieJar = new Map();
    let html = await getText(url, { jar });
    const bids = readVbrList(html, kind);
    if (bids.length === 0 && !/No (records|bids)/i.test(decode(html))) {
      fail(`page shape changed: list type ${type} has no bids and no "no bids" message`);
    }
    list.push(...bids);
    for (let page = 2; vbrHasPageLink(html, page); page++) {
      if (page > VBR_MAX_PAGES) fail(`list type ${type} has more than ${VBR_MAX_PAGES} pages`);
      const form = { ...vbrHiddenFields(html), __EVENTTARGET: "gvResults", __EVENTARGUMENT: `Page$${page}` };
      html = await getText(url, { jar, form });
      const more = readVbrList(html, kind);
      if (more.length === 0) fail(`list type ${type} page ${page} listed no bids`);
      list.push(...more);
    }
  }
  const details: Record<string, VbrDetail | null> = {};
  const ids = [...new Set(list.map((b) => b.id))];
  for (let i = 0; i < ids.length; i += DETAIL_CONCURRENCY) {
    await Promise.all(
      ids.slice(i, i + DETAIL_CONCURRENCY).map(async (id) => {
        try {
          details[id] = readVbrDetail(await getText(`${VT_VBR_ORIGIN}/BidPreview.aspx?BidID=${id}`));
        } catch {
          details[id] = null;
        }
      }),
    );
  }
  const { rows, skipped, skippedRows } = parseVbrBids(list, details, now);
  const unread = ids.filter((id) => !details[id]).length;
  console.log(
    `  ${VT_VBR_SOURCE}: ${rows.length} open bids accepted (listed: ${list.length}; detail pages unread: ${unread}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
