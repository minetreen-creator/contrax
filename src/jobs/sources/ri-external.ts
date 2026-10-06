/**
 * Rhode Island external solicitations — `ri_external`, the Division of
 * Purchases' public board of bids posted by quasi-public agencies (RIPTA, RI
 * Commerce, Quonset, the Narragansett Bay Commission, the Turnpike and Bridge
 * Authority, …), cities and towns, school districts, and URI / RIC / CCRI.
 *
 * WHY: Contrax had no Rhode Island feed (owner 2026-10-06). State-agency bids
 * come from `ri_osp`; this board carries the rest of Rhode Island's public
 * buyers.
 *
 * SOURCE (verified live 2026-10-06, no login, no CAPTCHA: 49 active rows):
 *   https://purchasing.ri.gov/bidding/ExternalBidSearch.aspx
 * is a classic ASP.NET form whose Search button posts (cross-page) to
 *   https://purchasing.ri.gov/bidding/ExternalBidListing.aspx
 * The connector GETs the form, keeps its hidden fields and cookies, selects
 * every posting entity and the "Active(Scheduled)" status, and posts it. The
 * listing shows "Solicitations matching the entered criteria : N" and all N
 * rows on one page. Each row links to a public description page
 * (ViewExDescription.aspx), which the connector reads for the description.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = Bid Title; `solicitation_number` = Solicitation Number.
 *   - `agency` = Posting Entity as listed ("RI Public Transit Authority",
 *     "North Kingstown"); municipalities get ", Rhode Island".
 *   - `due_date` = Opening Date + Opening Time, Eastern. A row with no readable
 *     time is stored at 11:59 PM Eastern (date-only convention) and says so.
 *   - `notice_type` = the Posting Group ("Quasi-Public", "Municipality", …).
 *   - `source_url` = the row's public description page.
 *   - `location` = "Rhode Island"; `naics_code` / `psc` / `set_aside` NULL.
 * Addenda are posted as their own rows; they are skipped (`addendum`) because
 * the base solicitation is already listed. Also skipped: no number or title
 * (`missing_fields`), repeated number for the same entity (`duplicate`),
 * unreadable date (`bad_date`), opening passed (`closed`).
 *
 * IDENTITY: `external_id = riext-<entity>-<solicitation number>` (slugged).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const RI_EXTERNAL_SOURCE = "ri_external";
const BASE = "https://purchasing.ri.gov/bidding/";
export const RI_EXTERNAL_SEARCH_URL = `${BASE}ExternalBidSearch.aspx`;
const LISTING_URL = `${BASE}ExternalBidListing.aspx`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface RiExternalRow {
  openingDate: string;
  openingTime: string;
  number: string;
  status: string;
  title: string;
  descriptionPath: string | null;
  group: string;
  entity: string;
}

export interface RiExternalParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function text(s: string | null | undefined): string {
  return decode(String(s ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** The "Solicitations matching the entered criteria : N" count, or NaN. */
export function riExternalTotal(html: string): number {
  const m = /criteria\s*:\s*(?:<[^>]+>\s*)*(\d+)/i.exec(html);
  return m ? Number(m[1]) : Number.NaN;
}

/** Rows of the GV_ExBidSearch grid. */
export function parseRiExternalListing(html: string): RiExternalRow[] {
  const out: RiExternalRow[] = [];
  const ids = [...html.matchAll(/id="(ctl00_ContentPlaceHolder1_GV_ExBidSearch_ctl\d+)_OpeningDate"/g)].map((m) => m[1]);
  for (const p of ids) {
    const span = (suffix: string) => text(new RegExp(`id="${p}_${suffix}"[^>]*>([\\s\\S]*?)</(?:span|a)>`).exec(html)?.[1]);
    const titleTag = new RegExp(`<a[^>]*id="${p}_ExBidTitleHyperLink"[^>]*>`).exec(html)?.[0] ?? "";
    const href = /href="([^"]+)"/.exec(titleTag)?.[1];
    out.push({
      openingDate: span("OpeningDate"),
      openingTime: span("OpeningTime"),
      number: span("ExBidNumberHyperLink"),
      status: span("ExBidStatusHyperLink"),
      title: span("ExBidTitleHyperLink"),
      descriptionPath: href ? decode(href) : null,
      group: span("lbl_ExBidGroup"),
      entity: span("lbl_ExBidEntity"),
    });
  }
  return out;
}

/** "10/07/2026" + "1:00PM" → epoch ms in Eastern time; no readable time → 11:59 PM. */
export function riExternalDueMs(date: string, time: string): { ms: number; timeKnown: boolean } {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim());
  if (!d) return { ms: Number.NaN, timeKnown: false };
  const [mo, day, y] = [+d[1], +d[2], +d[3]];
  const t = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m/i.exec(time);
  let hour = 23;
  let minute = 59;
  if (t && +t[1] >= 1 && +t[1] <= 12) {
    hour = (+t[1] % 12) + (t[3].toLowerCase() === "p" ? 12 : 0);
    minute = t[2] ? +t[2] : 0;
  }
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const dayUtc = Date.UTC(y, mo - 1, day);
  const dst = dayUtc >= Date.UTC(y, 2, nthSunday(3, 2)) && dayUtc < Date.UTC(y, 10, nthSunday(11, 1));
  return { ms: Date.UTC(y, mo - 1, day, hour + (dst ? 4 : 5), minute), timeKnown: !!t };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Addendum rows: "Addendum" in the title, or "<base> A1"/"<base>ADD2" when <base> is listed for the entity. */
export function isRiExternalAddendum(row: RiExternalRow, numbersByEntity: Map<string, Set<string>>): boolean {
  if (/\baddendum\b/i.test(row.title)) return true;
  const m = /^(.*?)[\s-]*(?:A|ADD)\s*\d+$/i.exec(row.number.trim());
  if (!m || !m[1]) return false;
  const base = m[1].trim().toLowerCase();
  return !!numbersByEntity.get(row.entity.toLowerCase())?.has(base);
}

function recordSkip(result: RiExternalParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

export function riExternalDescriptionUrl(path: string): string {
  return new URL(path, BASE).toString();
}

/** PURE parse — no network, no DB; `now` is injected. `details` maps description URL → text. */
export function buildRiExternalRows(
  listed: RiExternalRow[],
  details: Map<string, string> = new Map(),
  now: number = Date.now(),
): RiExternalParseResult {
  const result: RiExternalParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const numbersByEntity = new Map<string, Set<string>>();
  for (const r of listed) {
    const k = r.entity.toLowerCase();
    if (!numbersByEntity.has(k)) numbersByEntity.set(k, new Set());
    numbersByEntity.get(k)!.add(r.number.trim().toLowerCase());
  }
  const seen = new Set<string>();
  for (const r of listed) {
    const rowId = `riext-${slug(r.entity)}-${slug(r.number)}`;
    if (!r.number || !r.title || !r.entity) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (isRiExternalAddendum(r, numbersByEntity)) {
      recordSkip(result, rowId, "addendum");
      continue;
    }
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const due = riExternalDueMs(r.openingDate, r.openingTime);
    if (!Number.isFinite(due.ms)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (due.ms < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const url = r.descriptionPath ? riExternalDescriptionUrl(r.descriptionPath) : RI_EXTERNAL_SEARCH_URL;
    const posted = details.get(url) ?? "";
    const agency = r.group.toLowerCase() === "municipality" ? `${r.entity}, Rhode Island` : r.entity;
    const description = [
      posted ? (/[.!?]$/.test(posted) ? posted : `${posted}.`) : "",
      `${r.group || "Public"} solicitation ${r.number} posted by ${r.entity} on the Rhode Island Division of Purchases external bid board.`,
      due.timeKnown ? "" : "The opening time isn't listed; check the solicitation documents.",
      "Documents and submission instructions come from the posting entity (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: r.title,
      agency,
      description,
      location: "Rhode Island",
      category: mapCategory("", r.title, description),
      due_date: new Date(due.ms).toISOString(),
      estimated_value: "Not specified",
      source_url: url,
      set_aside: null,
      notice_type: r.group || null,
      solicitation_number: r.number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** The description text from a ViewExDescription.aspx page, or "". */
export function parseRiExternalDescription(html: string): string {
  const table = /<table[^>]*id="ctl00_ContentPlaceHolder1_GV_ViewExBid"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] ?? "";
  const cells = [...table.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1])).filter(Boolean);
  return cells.join(" ").slice(0, 2000);
}

function fail(detail: string): never {
  console.error(`  ${RI_EXTERNAL_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(RI_EXTERNAL_SOURCE, [detail]);
}

/** Build the search form post: hidden fields as served, every entity, Active status only. */
export function riExternalSearchForm(html: string): URLSearchParams {
  const data = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]*>/g)) {
    const tag = m[0];
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    if (!name) continue;
    const type = /type="([^"]+)"/.exec(tag)?.[1] ?? "text";
    if (type === "submit" || type === "button" || type === "image") continue;
    if (type === "checkbox" && !/checked/.test(tag)) continue;
    const value = /value="([^"]*)"/.exec(tag)?.[1];
    data.append(name, value != null ? decode(value) : type === "checkbox" ? "on" : "");
  }
  for (const m of html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const [, name, body] = m;
    const opts = [...body.matchAll(/<option([^>]*)value="([^"]*)"/g)];
    if (/Status/.test(name)) {
      for (const o of opts) if (o[2].startsWith("Active")) data.append(name, decode(o[2]));
    } else if (/Entities/.test(name)) {
      for (const o of opts) data.append(name, decode(o[2]));
    } else {
      const sel = opts.filter((o) => /selected/.test(o[1]));
      for (const o of sel.length ? sel : opts.slice(0, 1)) data.append(name, decode(o[2]));
    }
  }
  data.append("ctl00$ContentPlaceHolder1$btn_ExSearch", "Search");
  return data;
}

/** Search the external board for active solicitations and return ingest rows. */
export async function fetchRiExternalBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const keep = (resp: Response) => {
    const set: string[] = typeof (resp.headers as any).getSetCookie === "function" ? (resp.headers as any).getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const cookie = (): Record<string, string> => (cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let listing = "";
  const details = new Map<string, string>();
  try {
    const form = await fetch(RI_EXTERNAL_SEARCH_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    keep(form);
    if (form.status !== 200) fail(httpFailureDetail(form.status, RI_EXTERNAL_SEARCH_URL));
    const formHtml = await form.text();
    const resp = await fetch(LISTING_URL, {
      method: "POST",
      body: riExternalSearchForm(formHtml),
      headers: { "User-Agent": UA, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded", Referer: RI_EXTERNAL_SEARCH_URL, ...cookie() },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, LISTING_URL));
    listing = await resp.text();
    const total = riExternalTotal(listing);
    const listed = parseRiExternalListing(listing);
    if (!Number.isFinite(total)) fail("page shape changed: no result count");
    if (listed.length < total) fail(`only ${listed.length} of ${total} solicitations on the page`);
    // Descriptions are best-effort: a failed page leaves that row without one.
    for (const r of listed) {
      if (!r.descriptionPath || /addendum/i.test(r.title)) continue;
      const url = riExternalDescriptionUrl(r.descriptionPath);
      if (details.has(url)) continue;
      try {
        const d = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
        if (d.status === 200) details.set(url, parseRiExternalDescription(await d.text()));
      } catch {
        // keep going without this description
      }
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const listed = parseRiExternalListing(listing);
  const { rows, skipped, skippedRows } = buildRiExternalRows(listed, details, now);
  console.log(
    `  ${RI_EXTERNAL_SOURCE}: ${rows.length} active solicitations accepted (listed: ${listed.length}; descriptions: ${details.size}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
