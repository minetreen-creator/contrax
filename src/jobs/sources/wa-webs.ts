/**
 * Washington WEBS (Washington's Electronic Business Solution) open bids —
 * `wa_webs`, the State of Washington's statewide bid calendar.
 *
 * WHY: Contrax had no Washington bid feed (owner 2026-10-04 added the host).
 * State agencies, universities and colleges, and some cities, ports, transit
 * and housing authorities post here: DES, WSDOT, DSHS, Ecology, UW, Seattle
 * Housing Authority, Spokane Transit, …
 *
 * SOURCE (verified live 2026-10-04, no login, no CAPTCHA: 127 open bids on 6
 * pages from 42 organizations): the public calendar
 *   https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx
 * is an ASP.NET page. The connector does what its own controls do:
 *   1. GET the calendar (keeps the session cookies).
 *   2. Rows don't name the agency, so for each organization in the page's own
 *      "Filter by Government Organization" list, POST the filter (answered
 *      directly with 200). Each bid id then maps to the organization that
 *      listed it, and together the filters cover the whole calendar.
 *   3. A filter with more than 25 bids is paged: POST its pager link
 *      (__EVENTTARGET=DataGrid1$_ctl29$_ctlN); the server answers 302 back to
 *      the calendar and the next GET shows the new page (kept in the session).
 * The server takes 4-8 s per request, so a run is ~45 requests / ~4 minutes.
 * Detail pages (Search_BidDetails.aspx) redirect to the vendor login, so they
 * are never requested, and links point at the public calendar.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the bid title; `solicitation_number` = "Ref#".
 *   - `agency` = the organization whose filter lists the bid; "State of
 *     Washington (WEBS)" only if no filter lists it.
 *   - `due_date` = Solicitation Close Date (no time given) at 11:59 PM
 *     Pacific, the convention used for date-only deadlines elsewhere.
 *   - `description` = the listing text plus pre-bid conference, question
 *     deadline, last amendment, contact and the registration note.
 *   - `location` = "Washington"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: marked "Selective" (`selective` — offered only to vendors WEBS
 * invites), close date passed (`closed`), unreadable date (`bad_date`).
 *
 * IDENTITY: `external_id = wawebs-<WEBS ID>` (the detail link's ID).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const WA_WEBS_SOURCE = "wa_webs";
export const WA_WEBS_CALENDAR_URL = "https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx";
const FALLBACK_AGENCY = "State of Washington (WEBS)";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAX_PAGES = 30;
const DELAY_MS = 400;

export interface WaParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export interface WaListing {
  id: string;
  title: string;
  ref: string | null;
  closeDate: string;
  amendmentDate: string | null;
  selective: boolean;
  text: string;
  preBid: string | null;
  questionsDue: string | null;
  contact: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeHtml(s: string): string {
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
function spanText(row: string, suffix: string): string | null {
  const m = new RegExp(`id="DataGrid1__ctl\\d+_${suffix}"[^>]*>([^<]*)<`).exec(row);
  const v = m ? text(m[1]) : "";
  return v || null;
}

/** Bid ids listed on a calendar page, in order. */
export function waBidIds(html: string): string[] {
  return [...html.matchAll(/Search_BidDetails\.aspx\?ID=(\d+)/g)].map((m) => m[1]);
}

/** The grid's numbered pager links: { "2": "DataGrid1$_ctl29$_ctl1", … }. */
export function waPagerLinks(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/href="javascript:__doPostBack\(&#39;(DataGrid1\$_ctl\d+\$_ctl\d+)&#39;,&#39;&#39;\)">([^<]+)<\/a>/g)) {
    out[decodeHtml(m[2]).trim()] = m[1];
  }
  return out;
}

/** The organization filter's options (value, name), without "<All>". */
export function waOrganizations(html: string): { value: string; name: string }[] {
  const sel = /<select name="ddlOrgNames"[^>]*>(.*?)<\/select>/s.exec(html);
  if (!sel) return [];
  return [...sel[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/g)]
    .map((m) => ({ value: m[1], name: decodeHtml(m[2]).trim() }))
    .filter((o) => o.value !== "0" && o.name);
}

/** The selected organization filter value ("0" = all). */
export function waSelectedOrganization(html: string): string | null {
  const sel = /<select name="ddlOrgNames"[^>]*>(.*?)<\/select>/s.exec(html);
  const m = sel ? /<option selected="selected" value="(\d+)"/.exec(sel[1]) : null;
  return m ? m[1] : null;
}

/** "Labor & Industries, Department of" → "Department of Labor & Industries". */
export function waAgencyName(name: string): string {
  const m = /^(.+?),\s*((?:Department|Dept\.?|Office|Board|Administrative Office|State Board) (?:of|for)(?: the)?)$/i.exec(name.trim());
  if (!m) {
    // "Parks & Recreation Commission, State" → "State Parks & …"; "State Patrol, Washington" → "Washington State Patrol".
    const tail = /^(.+?),\s*(State|Washington)$/i.exec(name.trim());
    return tail ? `${tail[2]} ${tail[1]}` : name.trim();
  }
  const lead = m[2].replace(/^Dept\.?/i, "Department");
  return `${lead} ${m[1]}`.replace(/\s+/g, " ").trim();
}

/** PURE: the listings on one calendar page. */
export function parseWaListings(html: string): WaListing[] {
  const out: WaListing[] = [];
  const chunks = html.split(/<tr class="grid_item(?:_alt)?">/).slice(1);
  for (let raw of chunks) {
    const pager = raw.indexOf("DataGrid1__ctl29");
    if (pager >= 0) raw = raw.slice(0, pager);
    const link = /<a id="DataGrid1__ctl\d+_DetailsHyperlink" href="Search_BidDetails\.aspx\?ID=(\d+)">(.*?)<\/a>/s.exec(raw);
    if (!link) continue;
    const dateCell = /<div class="grid_item_td"[^>]*>\s*([^<]*?)\s*<br/.exec(raw);
    const afterLink = raw.slice(link.index + link[0].length);
    const panel = afterLink.indexOf('<div id="DataGrid1__ctl');
    const bodyHtml = panel >= 0 ? afterLink.slice(0, panel) : afterLink;
    // "Ref#:2026-RFP-002" sits on its own line between <br /> tags.
    const refHtml = /Ref#:([^<]*)</.exec(bodyHtml);
    const ref = refHtml ? text(refHtml[1]) || null : null;
    const rest = text(refHtml ? bodyHtml.replace(refHtml[0], "<") : bodyHtml);
    const contacts = [...raw.matchAll(/<span class="grid_item_td">([^<]*)<\/span>/g)];
    out.push({
      id: link[1],
      title: text(link[2]),
      ref,
      closeDate: dateCell ? text(dateCell[1]) : "",
      amendmentDate: spanText(raw, "lblAmendmentDate"),
      selective: /selective/i.test(spanText(raw, "lblSelective") ?? ""),
      text: rest,
      preBid: spanText(raw, "PreBidConferenceLabel"),
      questionsDue: spanText(raw, "QAPeriodLabel"),
      contact: contacts.length ? text(contacts[contacts.length - 1][1]) || null : null,
    });
  }
  return out;
}

function laOffsetMinutes(utcMs: number): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -480;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -mins : mins;
}

/** "10/05/26" → 11:59 PM Pacific that day, as epoch ms; NaN when unreadable. */
export function waCloseMs(date: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(date.trim());
  if (!m) return NaN;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const [month, day] = [Number(m[1]), Number(m[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return NaN;
  const wall = Date.UTC(year, month - 1, day, 23, 59);
  return wall - laOffsetMinutes(wall - laOffsetMinutes(wall) * 60_000) * 60_000;
}

function recordSkip(result: WaParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `agencyById` maps WEBS id → organization name; `now` is injected. */
export function parseWaPages(pages: string[], agencyById: ReadonlyMap<string, string>, now: number = Date.now()): WaParseResult {
  const result: WaParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const page of pages) {
    for (const l of parseWaListings(page)) {
      const rowId = `wawebs-${l.id}`;
      if (seen.has(rowId)) continue; // the same bid on the unfiltered and a filtered page
      seen.add(rowId);
      if (!l.title) {
        recordSkip(result, rowId, "missing_fields");
        continue;
      }
      if (l.selective) {
        recordSkip(result, rowId, "selective");
        continue;
      }
      const closeMs = waCloseMs(l.closeDate);
      if (!Number.isFinite(closeMs)) {
        recordSkip(result, rowId, "bad_date");
        continue;
      }
      if (closeMs < now) {
        recordSkip(result, rowId, "closed");
        continue;
      }
      const org = agencyById.get(l.id);
      const agency = org ? waAgencyName(org) : FALLBACK_AGENCY;
      const description = [
        l.text ? (/[.!?]$/.test(l.text) ? l.text : `${l.text}.`) : "",
        `Washington WEBS solicitation${l.ref ? ` ${l.ref}` : ""}, closes ${l.closeDate} (no time listed).`,
        l.preBid ? `Pre-bid conference: ${l.preBid}.` : "",
        l.questionsDue ? `Questions due: ${l.questionsDue}.` : "",
        l.amendmentDate ? `Last amended ${l.amendmentDate}.` : "",
        l.contact ? `Contact: ${l.contact}.` : "",
        "Documents and responses through WEBS (free vendor registration; see source link).",
      ]
        .filter(Boolean)
        .join(" ");
      result.rows.push({
        external_id: rowId,
        title: l.title,
        agency,
        description,
        location: "Washington",
        category: mapCategory("", l.title, description),
        due_date: new Date(closeMs).toISOString(),
        estimated_value: "Not specified",
        source_url: WA_WEBS_CALENDAR_URL,
        set_aside: null,
        notice_type: null,
        solicitation_number: l.ref,
        naics_code: null,
        psc: null,
      });
    }
  }
  return result;
}

/** The page's hidden ASP.NET fields (__VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION). */
export function waHiddenFields(html: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)) {
    if (m[1] === "__EVENTTARGET" || m[1] === "__EVENTARGUMENT") continue;
    out.push([m[1], decodeHtml(m[2])]);
  }
  return out;
}

function fail(detail: string): never {
  console.error(`  ${WA_WEBS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(WA_WEBS_SOURCE, [detail]);
}

/** Fetch every open bid through the organization filters and return ingest rows. */
export async function fetchWaWebsBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const sleep = () => new Promise((r) => setTimeout(r, DELAY_MS));
  const request = async (form?: [string, string][]): Promise<{ status: number; html: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const headers: Record<string, string> = { "User-Agent": UA, Accept: "text/html" };
      if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      if (form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers.Referer = WA_WEBS_CALENDAR_URL;
      }
      const resp = await fetch(WA_WEBS_CALENDAR_URL, {
        method: form ? "POST" : "GET",
        headers,
        body: form ? new URLSearchParams(form).toString() : undefined,
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
      if (resp.status !== 200 && resp.status !== 302) fail(httpFailureDetail(resp.status, WA_WEBS_CALENDAR_URL));
      return { status: resp.status, html: await resp.text() };
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
  };
  /** POST a postback; a 302 means "GET the calendar again to see the result". */
  const postback = async (from: string, extra: [string, string][]): Promise<string> => {
    const r = await request([...waHiddenFields(from), ...extra]);
    return r.status === 302 ? (await request()).html : r.html;
  };
  /** The current page plus every further page of the grid (same filter). */
  const allPages = async (first: string, org: string): Promise<string[]> => {
    const pages = [first];
    const ids = new Set(waBidIds(first));
    let cur = first;
    for (let n = 2; n <= MAX_PAGES; n++) {
      const target = waPagerLinks(cur)[String(n)];
      if (!target) break;
      await sleep();
      const next = await postback(cur, [["ddlOrgNames", org], ["__EVENTTARGET", target], ["__EVENTARGUMENT", ""]]);
      if (waSelectedOrganization(next) !== org) fail(`pager lost the organization filter (${org})`);
      const fresh = waBidIds(next).filter((id) => !ids.has(id));
      if (fresh.length === 0) break;
      fresh.forEach((id) => ids.add(id));
      pages.push(next);
      cur = next;
    }
    return pages;
  };

  const first = (await request()).html;
  if (!first.includes('id="DataGrid1"')) fail("calendar shape changed: no DataGrid1");
  const orgs = waOrganizations(first);
  if (orgs.length === 0) fail("calendar shape changed: no organization filter");

  // Each organization's filtered list (all its pages). Together they cover the
  // calendar (2026-10-04: 127 of 127), and each id gets the organization that
  // listed it. The unfiltered first page is kept too, so a bid no filter lists
  // still comes in (with the fallback agency).
  const pages = [first];
  const agencyById = new Map<string, string>();
  let cur = first;
  for (const org of orgs) {
    await sleep();
    const filtered = await postback(cur, [["ddlOrgNames", org.value], ["ImageButton1", "Search"], ["__EVENTTARGET", ""], ["__EVENTARGUMENT", ""]]);
    if (waSelectedOrganization(filtered) !== org.value) fail(`organization filter not applied (${org.name})`);
    const orgPages = await allPages(filtered, org.value);
    for (const page of orgPages) {
      for (const id of waBidIds(page)) if (!agencyById.has(id)) agencyById.set(id, org.name);
    }
    pages.push(...orgPages);
    cur = orgPages[orgPages.length - 1];
  }
  const listed = new Set(pages.flatMap(waBidIds));
  if (listed.size === 0) fail("no bids on the calendar (page shape changed?)");

  const { rows, skipped, skippedRows } = parseWaPages(pages, agencyById, now);
  const unmapped = [...listed].filter((id) => !agencyById.has(id)).length;
  console.log(
    `  ${WA_WEBS_SOURCE}: ${rows.length} open bids accepted (listed: ${listed.size} on ${pages.length} page(s) across ${orgs.length} organization filters; unmapped agency: ${unmapped}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
