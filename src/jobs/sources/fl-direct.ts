/**
 * Florida direct readers (owner 2026-11-07: "Yes do the Florida batch").
 *
 * Most of Florida's biggest buyers (Orlando, Tampa Purchasing, Pinellas, Volusia, Collier, Seminole,
 * Sarasota, St. Petersburg) post only on OpenGov, and Manatee and Brevard sit behind a Cloudflare bot
 * check; Contrax does not get around either. These public pages answered our honest bot with no login:
 *
 *   FDOT lettings (`fl_fdot_*`): the Central Office, Florida's Turnpike and District 1, 2, 3, 5 and 7
 *     "Letting and Project Information" pages. Each upcoming letting lists Proposal ID, County and Major
 *     Work Type, with the proposal PDF linked. The page gives a letting DATE only, so (as with `oh_odot`)
 *     the deadline is 12:00 AM local on the letting day: a row is never shown open later than it is.
 *   Polk County (`fl_polk_county`): the procurement page's "current procurement opportunities" table
 *     (Bid #, Title, Open Date). Open date only, so 12:00 AM Eastern on that day, as above. "DQ" rows list
 *     only a street address, with no scope, so they are skipped (`no_scope_listed`).
 *   Lee County (`fl_lee_county`): its public IonWave "Current Bid Opportunities" board, the same portal
 *     type as `ne_omaha_ionwave`. Close times are printed in ET. Sole/single-source notices are not
 *     open competitions and are skipped (`not_competitive`). Detail pages are never requested.
 *   City of Tampa construction (`fl_tampa_construction`): Contract Administration's public construction
 *     bid list (Tampa's Purchasing bids are on OpenGov). Opening times are printed ("1:30PM, Tuesday,
 *     December 01, 2026", Eastern).
 *
 * DATA HONESTY: contact names, emails and phone numbers are never stored. Skipped rows are counted:
 * `closed`, `bad_date`, `missing_fields`, `duplicate` and the source-specific reasons above.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";
import { zonedIso } from "./revize-bids";

const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
type Zone = "America/New_York" | "America/Chicago";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const decode = (s: string) =>
  s.replace(/&nbsp;|&#160;/g, " ").replace(/&#8211;|&ndash;/g, "–").replace(/&#8217;|&rsquo;|&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export interface FlResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}
function collector() {
  const r: FlResult = { rows: [], skipped: {}, skippedRows: [] };
  const skip = (id: string, reason: string) => {
    r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
    r.skippedRows.push({ id, reason });
  };
  return { r, skip };
}

/** "December 2, 2026" → [2026, 12, 2]; null if unreadable. PURE. */
function longDate(v: string): [number, number, number] | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(v);
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && mo ? [+m[3], mo, +m[2]] : null;
}

/** Florida counties whose name the shared state resolver could read as another state. */
const STATE_NAMED_COUNTIES = new Set(["Washington", "Jackson", "Columbia", "Indian River"]);
/** One county → "<County> County, Florida"; several (or a state-like name) → "Florida". PURE. */
export function flCountyLocation(counties: string[]): string {
  return counties.length === 1 && !STATE_NAMED_COUNTIES.has(counties[0]) && !/districtwide/i.test(counties[0]) ? `${counties[0]} County, Florida` : "Florida";
}
const countyLabel = (counties: string[]) =>
  counties.some((c) => /districtwide/i.test(c)) ? "districtwide" : counties.length === 1 ? `${counties[0]} County` : `${counties.join(", ")} counties`;

// ---------------------------------------------------------------------------------------------- FDOT

export interface FdotPage {
  source: string;
  url: string;
  /** Who lets the work, as the title and description name it. */
  office: string;
  agency: string;
  zone: Zone;
}
const FDOT = "https://www.fdot.gov/contracts";
const fdotDistrict = (n: number, zone: Zone): FdotPage => ({
  source: `fl_fdot_d${n}`,
  url: `${FDOT}/district-offices/d${n}/lettings/dist-letting-project-info.shtm`,
  office: `FDOT District ${n}`,
  agency: "Florida Department of Transportation",
  zone,
});
export const FDOT_PAGES: readonly FdotPage[] = [
  { source: "fl_fdot_central", url: `${FDOT}/lettings/letting-project-info.shtm`, office: "FDOT Central Office", agency: "Florida Department of Transportation", zone: "America/New_York" },
  { source: "fl_fdot_turnpike", url: `${FDOT}/district-offices/tp/lettings/dist-letting-project-info.shtm`, office: "Florida's Turnpike", agency: "Florida's Turnpike Enterprise (FDOT)", zone: "America/New_York" },
  fdotDistrict(1, "America/New_York"),
  fdotDistrict(2, "America/New_York"),
  // District 3 is the Panhandle, run from Chipley (Central time).
  fdotDistrict(3, "America/Chicago"),
  fdotDistrict(5, "America/New_York"),
  fdotDistrict(7, "America/New_York"),
];

/** A "Major Work Type" cell: plain lines are the work, bold lines are FDOT's notes. PURE. */
export function fdotWorkCell(cell: string): { work: string; notes: string[] } {
  const notes: string[] = [];
  const plain = cell.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner: string) => {
    for (const line of inner.split(/<br\s*\/?>/i)) {
      const t = text(line);
      // Short all-caps tags ("BDI") are FDOT program labels, not notes.
      if (t && !/^[A-Z]{2,5}$/.test(t)) notes.push(t);
    }
    return "<br>";
  });
  const work = plain.split(/<br\s*\/?>/i).map(text).filter(Boolean).join(" / ");
  return { work, notes };
}

const LETTING_HEADER = /((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d)(?=\s*(?:<[^>]+>\s*)*Important Letting Documents)/g;

export function parseFdotLettings(page: FdotPage, html: string, now: number = Date.now()): FlResult {
  const headers = [...html.matchAll(LETTING_HEADER)];
  if (!headers.length || !/Proposal ID/.test(html)) throw new SourceUnreachableError(page.source, ["Letting list missing (page changed)"]);
  const { r, skip } = collector();
  const seen = new Set<string>();
  let tables = 0;
  headers.forEach((h, i) => {
    const seg = html.slice(h.index! + h[0].length, i + 1 < headers.length ? headers[i + 1].index : html.length);
    const head = seg.indexOf("Proposal ID");
    if (head < 0) return;
    tables++;
    const close = seg.indexOf("</table>", head);
    const table = seg.slice(head, close < 0 ? seg.length : close);
    const ymd = longDate(h[1]);
    const due = ymd ? zonedIso(page.zone, ymd[0], ymd[1], ymd[2], 0, 0) : null;
    for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      if (cells.length < 3) continue;
      const id = text(cells[0]);
      const href = /<a\b[^>]*href="(https:\/\/[^"]+)"/.exec(cells[0])?.[1] ?? "";
      const counties = text(cells[1]).split(/\s*,\s*/).filter(Boolean);
      const { work, notes } = fdotWorkCell(cells[2]);
      if (id === "Proposal ID" || (!id && !work && !notes.length)) continue;
      if (notes.some((n) => /\bmoved to\b/i.test(n))) { skip(id || "unknown", "moved_to_other_letting"); continue; }
      if (notes.some((n) => /^(withdrawn|cancell?ed)\b/i.test(n))) { skip(id || "unknown", "withdrawn"); continue; }
      if (!/^[A-Z0-9]{4,6}(?:-R\d+)?$/.test(id) || !counties.length || !work) { skip(id || "unknown", "missing_fields"); continue; }
      if (!due) { skip(id, "bad_date"); continue; }
      if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
      if (seen.has(id)) { skip(id, "duplicate"); continue; }
      seen.add(id);
      const estimate = notes.map((n) => /budgetary estimate of (\$[\d,]+(?:\.\d+)?)/i.exec(n)?.[1]).find(Boolean) ?? "";
      const where = countyLabel(counties);
      const description = [
        `${page.office} letting on ${h[1]}: proposal ${id}, ${work}, ${where}.`,
        ...notes.map((n) => (/[.!?]$/.test(n) ? n : `${n}.`)),
        "Bids go in through Bid Express by the time in the letting advertisement; the page gives only the letting date, so this listing counts the start of that day as the deadline.",
      ].filter(Boolean).join(" ");
      r.rows.push({
        external_id: `fdot-${id}`,
        title: `${work} — ${page.office.replace(/^FDOT Central Office$/, "FDOT")} ${id}, ${where}`,
        agency: page.agency,
        location: flCountyLocation(counties),
        description,
        category: mapCategory("", work, description),
        due_date: due,
        estimated_value: estimate,
        source_url: /^https:\/\/(?:ftp\.fdot\.gov|fdotwww\.blob\.core\.windows\.net|www\.fdot\.gov)\//.test(href) ? href : page.url,
        set_aside: null,
        naics_code: null,
        psc: null,
        solicitation_number: id,
        notice_type: "Construction letting",
      });
    }
  });
  if (!tables) throw new SourceUnreachableError(page.source, ["Proposal tables missing (page changed)"]);
  return r;
}

// ---------------------------------------------------------------------------------------------- Polk

export const FL_POLK_SOURCE = "fl_polk_county";
export const POLK_URL = "https://www.polkfl.gov/business/procurement/";

export function parsePolkBids(html: string, now: number = Date.now()): FlResult {
  const start = html.indexOf("current procurement opportunities");
  if (start < 0) throw new SourceUnreachableError(FL_POLK_SOURCE, ["Current opportunities table missing (page changed)"]);
  const end = html.indexOf("Continuing Solicitations", start);
  const list = html.slice(start, end > 0 ? end : undefined);
  const { r, skip } = collector();
  const seen = new Set<string>();
  for (const m of list.matchAll(/<td class="bid">\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/td>\s*<td class="bid-title">([\s\S]*?)<\/td>\s*<td class="bid-date">([\s\S]*?)<\/td>/g)) {
    const number = text(m[2]);
    const title = text(m[3]);
    const open = text(m[4]);
    const prefix = /^([A-Za-z]+)\b/.exec(number)?.[1] ?? "";
    if (!number || !title) { skip(number || "unknown", "missing_fields"); continue; }
    if (seen.has(number)) { skip(number, "duplicate"); continue; }
    seen.add(number);
    if (/^DQ$/i.test(prefix)) { skip(number, "no_scope_listed"); continue; }
    const ymd = longDate(open);
    const due = ymd ? zonedIso("America/New_York", ymd[0], ymd[1], ymd[2], 0, 0) : null;
    if (!due) { skip(number, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(number, "closed"); continue; }
    r.rows.push({
      external_id: `polk-${number.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title,
      agency: "Polk County, Florida",
      location: "Polk County, Florida",
      description: `Polk County ${number}: ${title}. Opens ${open}; the page gives no time, so this listing counts the start of that day as the deadline. Documents, addenda and any mandatory pre-bid meeting are on the County's bid page.`,
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: /^https:\/\/www\.polkfl\.gov\//.test(m[1]) ? m[1] : POLK_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: /^bid$/i.test(prefix) ? "ITB" : /^rfp$/i.test(prefix) ? "RFP" : /^rfq$/i.test(prefix) ? "RFQ" : prefix || null,
    });
  }
  return r;
}

// ---------------------------------------------------------------------------------------------- Lee (IonWave)

export const FL_LEE_SOURCE = "fl_lee_county";
export const LEE_ORIGIN = "https://leegov.ionwave.net";
export const LEE_URL = `${LEE_ORIGIN}/SourcingEvents.aspx?SourceType=1`;

export interface IonwaveItem { id: string; number: string; title: string; type: string; close: string }

/** One page of the public IonWave board. PURE. */
export function readLeePage(html: string): { items: IonwaveItem[]; total: number; pages: number } {
  const fail = (s: string): never => { throw new SourceUnreachableError(FL_LEE_SOURCE, [s]); };
  if (!html.includes("Current Bid Opportunities")) fail("Current bid board missing (page changed)");
  const count = /<strong>(\d+)<\/strong>\s*items in\s*<strong>(\d+)<\/strong>\s*pages/i.exec(html);
  if (!count) fail("Bid count missing (page changed)");
  let keys: Record<string, { BidID?: string }> = {};
  const raw = /"_clientKeyValues":(\{.*?\}),"_controlToFocus"/s.exec(html)?.[1];
  if (raw) { try { keys = JSON.parse(raw); } catch { fail("Bid identities unreadable"); } }
  const items: IonwaveItem[] = [];
  for (const m of html.matchAll(/<tr class="rg(?:Alt)?Row"[^>]*id="ctl00_mainContent_rgBidList_ctl00__(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    const id = keys[m[1]]?.BidID ?? "";
    if (cells.length !== 7 || !/^\d+$/.test(id)) fail("Bid row shape changed");
    items.push({ id, number: cells[1], title: cells[2], type: cells[3], close: cells[6] });
  }
  const total = +count![1], pages = +count![2];
  if ((total > 0 && !items.length) || items.length > total) fail("Incomplete bid list");
  return { items, total, pages };
}

/** "11/11/2026 05:30:00 PM (ET)" → ISO. PURE. */
export function leeClose(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):\d{2} ([AP])M \(ET\)$/.exec(v.trim());
  if (!m || +m[4] < 1 || +m[4] > 12) return null;
  return zonedIso("America/New_York", +m[3], +m[1], +m[2], (+m[4] % 12) + (m[6] === "P" ? 12 : 0), +m[5]);
}

export function mapLeeBoard(items: IonwaveItem[], now: number = Date.now()): FlResult {
  const { r, skip } = collector();
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) { skip(it.id, "duplicate"); continue; }
    seen.add(it.id);
    if (!it.title || !it.number) { skip(it.id, "missing_fields"); continue; }
    if (/sole source|single source/i.test(it.type)) { skip(it.id, "not_competitive"); continue; }
    const due = leeClose(it.close);
    if (!due) { skip(it.id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(it.id, "closed"); continue; }
    const number = it.number.replace(/\s+Addendum\s+\d+$/i, "");
    const addendum = /Addendum\s+(\d+)$/i.exec(it.number)?.[1];
    r.rows.push({
      external_id: `leeionwave-${it.id}`,
      title: it.title,
      agency: "Lee County, Florida",
      location: "Lee County, Florida",
      description: `Lee County ${number} (${it.type}): ${it.title}. Closes ${it.close.replace(" (ET)", " Eastern")}.${addendum ? ` Addendum ${addendum} has been issued.` : ""} Documents are on the County's IonWave bid site.`,
      category: mapCategory("", it.title, ""),
      due_date: due,
      estimated_value: "",
      source_url: `${LEE_ORIGIN}/PublicDetail.aspx?bidID=${it.id}&SourceType=1`,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: /^IB/i.test(it.type) ? "ITB" : /^RFP/i.test(it.type) ? "RFP" : /^RFQ/i.test(it.type) ? "RFQ" : it.type || null,
    });
  }
  return r;
}

/** The ASP.NET form that asks the board for its next page. PURE. */
export function leeNextPageForm(html: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname="([^"]+)"/i.exec(m[0])?.[1];
    if (name && /\btype="hidden"/i.test(m[0])) params.set(decode(name), decode(/\bvalue="([^"]*)"/i.exec(m[0])?.[1] ?? ""));
  }
  const next = [...html.matchAll(/<input\b[^>]*>/gi)].find((m) => /title="Next Page"/.test(m[0]))?.[0];
  const name = next && /name="([^"]+)"/.exec(next)?.[1];
  if (!name || !params.has("__VIEWSTATE") || /onclick="return false;"/.test(next!)) throw new SourceUnreachableError(FL_LEE_SOURCE, ["Next-page control missing"]);
  params.set(decode(name), " ");
  return params;
}

// ---------------------------------------------------------------------------------------------- Tampa

export const FL_TAMPA_SOURCE = "fl_tampa_construction";
export const TAMPA_URL = "https://www.tampa.gov/contract-administration/programs/construction-project-bidding";

/** "1:30PM, Tuesday, December 01, 2026" → ISO (Eastern). PURE. */
export function tampaOpening(v: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M,\s*[A-Za-z]+,\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/i.exec(v.trim());
  const mo = m ? MONTHS.indexOf(m[4].toLowerCase()) + 1 : 0;
  if (!m || !mo || +m[1] < 1 || +m[1] > 12) return null;
  return zonedIso("America/New_York", +m[6], mo, +m[5], (+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0), +m[2]);
}

export function parseTampaConstruction(html: string, now: number = Date.now()): FlResult {
  if (!/view-construction-bids/.test(html)) throw new SourceUnreachableError(FL_TAMPA_SOURCE, ["Construction bid list missing (page changed)"]);
  const { r, skip } = collector();
  const seen = new Set<string>();
  for (const m of html.matchAll(/<div class="rfq-title[^"]*">\s*<div class="monospace">([\s\S]*?)<\/div>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?Opening:\s*<strong class="date">([\s\S]*?)<\/strong>[\s\S]*?Pre-Bid:\s*<strong class="date">([\s\S]*?)<\/strong>/g)) {
    const number = text(m[1]);
    const title = text(m[3]).replace(new RegExp(`^${number.replace(/[-]/g, "\\-")}\\s*`), "");
    const opening = text(m[4]);
    const preBid = text(m[5]);
    if (!number || !title) { skip(number || "unknown", "missing_fields"); continue; }
    if (seen.has(number)) { skip(number, "duplicate"); continue; }
    seen.add(number);
    const due = tampaOpening(opening);
    if (!due) { skip(number, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(number, "closed"); continue; }
    const detail = new URL(m[2], "https://www.tampa.gov").href;
    r.rows.push({
      external_id: `tampa-${number}`,
      title,
      agency: "City of Tampa",
      location: "Tampa, FL",
      description: [
        `City of Tampa Contract Administration construction bid ${number}: ${title}. Opening ${opening} Eastern.`,
        preBid && !/^none$/i.test(preBid) ? `Pre-bid: ${preBid}.` : "",
        "Bids are delivered on paper (mail, parcel service or in person), not online. Plans, specifications and addenda are on the City's construction bid page.",
      ].filter(Boolean).join(" "),
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: /^https:\/\/www\.tampa\.gov\//.test(detail) ? detail : TAMPA_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: "ITB",
    });
  }
  return r;
}

// ---------------------------------------------------------------------------------------------- fetch

export const flDirectDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

async function getPage(source: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await flDirectDeps.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000), ...init, headers: { "user-agent": UA, accept: "text/html", ...(init.headers as Record<string, string>) } });
  if (!res.ok) throw new SourceUnreachableError(source, [`HTTP ${res.status}`]);
  return res;
}

async function readHtml(source: string, url: string, parse: (html: string, now: number) => FlResult, now: number): Promise<FetchResult> {
  try {
    return parse(await (await getPage(source, url)).text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(source, [e instanceof Error ? e.message : String(e)]);
  }
}

export const fetchFdotPage = (page: FdotPage, now: number = Date.now()) => readHtml(page.source, page.url, (h, n) => parseFdotLettings(page, h, n), now);
export const fetchFlPolkBids = (now: number = Date.now()) => readHtml(FL_POLK_SOURCE, POLK_URL, parsePolkBids, now);
export const fetchFlTampaConstruction = (now: number = Date.now()) => readHtml(FL_TAMPA_SOURCE, TAMPA_URL, parseTampaConstruction, now);

export async function fetchFlLeeBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const first = await getPage(FL_LEE_SOURCE, LEE_URL);
    const cookie = (first.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    let html = await first.text();
    let page = readLeePage(html);
    const { total, pages } = page;
    if (pages > 20) throw new SourceUnreachableError(FL_LEE_SOURCE, ["Too many pages"]);
    const items = [...page.items];
    for (let p = 1; p < pages; p++) {
      const res = await getPage(FL_LEE_SOURCE, LEE_URL, { method: "POST", body: leeNextPageForm(html), headers: { "content-type": "application/x-www-form-urlencoded", cookie } });
      html = await res.text();
      page = readLeePage(html);
      if (page.total !== total || page.items.some((i) => items.some((o) => o.id === i.id))) throw new SourceUnreachableError(FL_LEE_SOURCE, ["Pagination changed or repeated a page"]);
      items.push(...page.items);
    }
    if (items.length !== total) throw new SourceUnreachableError(FL_LEE_SOURCE, [`Only ${items.length} of ${total} bids read`]);
    return mapLeeBoard(items, now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(FL_LEE_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}

export const FL_DIRECT_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = [
  ...FDOT_PAGES.map((p) => ({ name: p.source, fetchFn: () => fetchFdotPage(p) })),
  { name: FL_POLK_SOURCE, fetchFn: () => fetchFlPolkBids() },
  { name: FL_LEE_SOURCE, fetchFn: () => fetchFlLeeBids() },
  { name: FL_TAMPA_SOURCE, fetchFn: () => fetchFlTampaConstruction() },
];
