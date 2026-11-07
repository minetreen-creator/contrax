/**
 * California buyers read directly (owner 2026-11-07: "more bids of our own instead of relying mostly on
 * bidnet" → "Yes start California"). Captured 2026-11-07 (fixtures/ca-direct); no logins, forms or
 * documents.
 *
 *  - San Bernardino County ePro and Contra Costa County: Periscope BuySpeed marketplaces, read with the
 *    shared BSO reader (open bids only, every page).
 *  - EBMUD (East Bay Municipal Utility District): its public "Current Construction Bid Opportunities"
 *    table — project, specification number, construction estimate, bid opening date. The table states a
 *    date only, so the deadline is 11:59 PM Pacific (the date-only convention) and the description says
 *    so. Prequalification calls are not bids and are skipped.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import { fetchBsoBids, type BsoConfig } from "./periscope-bso";
import type { RawBid } from "./sam-gov";

const PT = -8;
export const CA_COUNTY_BSO: readonly BsoConfig[] = [
  { source: "ca_san_bernardino_county", origin: "https://epro.sbcounty.gov", idPrefix: "sbcountyepro", stateName: "California", portalName: "San Bernardino County ePro", standardOffsetHours: PT, buyer: "San Bernardino County", location: "San Bernardino County, CA" },
  { source: "ca_contra_costa_county", origin: "https://purchasing.cccounty.us", idPrefix: "cccountybso", stateName: "California", portalName: "Contra Costa County's BuySpeed marketplace", standardOffsetHours: PT, buyer: "Contra Costa County", location: "Contra Costa County, CA" },
];

export const CA_EBMUD_SOURCE = "ca_ebmud";
export const EBMUD_BIDS_URL = "https://construction-bids.ebmud.com/CurrentorFutureBid.aspx";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "December 02, 2026" → 11:59 PM Pacific that day (ISO, DST-aware); null when invalid. PURE. */
export function pacificEndOfDay(v: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(v.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const [d, y] = [+m[2], +m[3]];
  if (mo < 1 || d < 1 || d > 31) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  for (const off of [7, 8]) {
    const t = new Date(Date.UTC(y, mo - 1, d, 23 + off, 59));
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    if (p.year === y && p.month === mo && p.day === d && p.hour === 23 && p.minute === 59) return t.toISOString();
  }
  return null;
}

const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export interface EbmudParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseEbmudBids(html: string, now: number = Date.now()): EbmudParseResult {
  const at = html.indexOf('id="dgCurrent"');
  if (at < 0) throw new SourceUnreachableError(CA_EBMUD_SOURCE, ["Current bids table missing (page changed)"]);
  const table = html.slice(at, html.indexOf("</table>", at));
  const r: EbmudParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const skip = (id: string, reason: string) => {
    r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
    r.skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const tr of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const href = /href="([^"]+)"/.exec(cells[0])?.[1]?.replace(/&amp;/g, "&");
    const [title, spec, estimate, opening] = cells.map(text);
    const id = spec || href || title;
    if (!title || !spec) { skip(id || "unknown", "missing_fields"); continue; }
    if (/^request for (pre-?)?qualification/i.test(title)) { skip(spec, "not_a_bid"); continue; }
    if (seen.has(spec)) { skip(spec, "duplicate"); continue; }
    seen.add(spec);
    const due = pacificEndOfDay(opening);
    if (!due) { skip(spec, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(spec, "closed"); continue; }
    const est = /\$\d/.test(estimate) ? estimate : "";
    r.rows.push({
      external_id: `ebmud-${spec}`,
      title,
      agency: "East Bay Municipal Utility District (EBMUD)",
      location: "Oakland, CA",
      description: `EBMUD construction bid, specification ${spec}: ${title}.${est ? ` Construction estimate ${est}.` : ""} Bid opening ${opening} (the list gives no time; check the specification).`,
      // Every row on this page is a construction bid (the page is "Construction bids").
      category: mapCategory("", title, "construction bid"),
      due_date: due,
      estimated_value: est,
      source_url: href ? new URL(href, EBMUD_BIDS_URL).href : EBMUD_BIDS_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: spec,
      notice_type: "ITB",
    });
  }
  return r;
}

export const caDirectDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  pause: (ms: number) => new Promise((res) => setTimeout(res, ms)),
};

export async function fetchCaEbmudBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const res = await caDirectDeps.fetch(EBMUD_BIDS_URL, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseEbmudBids(await res.text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(CA_EBMUD_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}

export const CA_DIRECT_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = [
  ...CA_COUNTY_BSO.map((c) => ({ name: c.source, fetchFn: () => fetchBsoBids(c) })),
  { name: CA_EBMUD_SOURCE, fetchFn: () => fetchCaEbmudBids() },
];

// ── Batch 2 (owner 2026-11-07: "Yes do batch 2") ─────────────────────────────────────────────────

type Result = EbmudParseResult;
const newResult = (): Result => ({ rows: [], skipped: {}, skippedRows: [] });
const skipOf = (r: Result) => (id: string, reason: string) => {
  r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
  r.skippedRows.push({ id, reason });
};

/** Pacific wall time → ISO UTC, DST-aware; null when impossible or ambiguous. PURE. */
export function pacificIso(y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const target = { year: y, month: mo, day: d, hour: h, minute: mi };
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const hits = [7, 8].map((o) => new Date(wall + o * 3_600_000)).filter((t) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Object.entries(target).every(([k, v]) => p[k] === v);
  });
  return hits.length === 1 ? hits[0].toISOString() : null;
}
const to24 = (h: number, ap: string) => (h % 12) + (/^p/i.test(ap) ? 12 : 0);

/**
 * LA County (`ca_la_county`): the open solicitations its public Doing Business page lists, from the same
 * public API that page calls (lacobids.lacounty.gov/api/v1/opensolicitations/departments/{n}), one
 * request per department, paced. ClosingDate is LA wall-clock time sent with a "Z" (5:30 PM reads
 * "17:30:00.000Z"), so it is read as Pacific. "Continuous" solicitations are open on a rolling basis;
 * any row whose own closing date has passed is skipped. Bids open inside that page, so source_url is it.
 */
export const CA_LA_COUNTY_SOURCE = "ca_la_county";
export const LA_COUNTY_API = "https://lacobids.lacounty.gov/api/v1/opensolicitations";
export const LA_COUNTY_PAGE = "https://doingbusiness.lacounty.gov/open-solicitations/";
export interface LaCountyRow { "Bid#"?: string; BidRefNbr?: string; Title?: string; Type?: string; DeptName?: string; ClosingDate?: string; OpenContinuous?: string }

export function parseLaCounty(rows: readonly LaCountyRow[], now: number = Date.now()): Result {
  const r = newResult();
  const skip = skipOf(r);
  const seen = new Set<string>();
  for (const row of rows) {
    const ref = String(row.BidRefNbr ?? "").trim();
    const num = String(row["Bid#"] ?? "").trim();
    const title = String(row.Title ?? "").replace(/\s+/g, " ").trim();
    const id = ref || num;
    if (!id || !title) { skip(id || "unknown", "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(row.ClosingDate ?? ""));
    const due = m ? pacificIso(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    const type = String(row.Type ?? "").trim();
    const dept = String(row.DeptName ?? "").trim();
    const continuous = /continuous/i.test(String(row.OpenContinuous ?? ""));
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "long", timeStyle: "short" }).format(new Date(due));
    r.rows.push({
      external_id: `lacounty-${id}`,
      title,
      agency: dept ? `Los Angeles County ${dept.replace(/^(Los Angeles|LA) County\s+/i, "")}` : "Los Angeles County",
      location: "Los Angeles County, CA",
      description: `LA County ${type || "solicitation"} ${num || id}${dept ? ` (${dept})` : ""}: ${title}. ${continuous ? "Open on a continuous basis; current closing date" : "Closes"} ${local} Pacific. Details, documents and contacts are on LA County's Open Solicitations page.`,
      category: mapCategory("", title, /construction/i.test(type) ? "construction" : ""),
      due_date: due,
      estimated_value: "",
      source_url: LA_COUNTY_PAGE,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: num || null,
      notice_type: type || null,
    });
  }
  return r;
}

export async function fetchCaLaCountyBids(now: number = Date.now()): Promise<FetchResult> {
  const H = { "user-agent": UA, accept: "application/json", referer: LA_COUNTY_PAGE };
  try {
    const dres = await caDirectDeps.fetch(`${LA_COUNTY_API}/departments`, { headers: H, signal: AbortSignal.timeout(30000) });
    if (!dres.ok) throw new Error(`departments HTTP ${dres.status}`);
    const depts = (await dres.json()) as { DeptNbr?: string }[];
    if (!Array.isArray(depts) || depts.length === 0) throw new Error("no departments listed");
    const all: LaCountyRow[] = [];
    for (const d of depts) {
      const n = String(d.DeptNbr ?? "").trim();
      if (!/^\d+$/.test(n)) continue;
      const res = await caDirectDeps.fetch(`${LA_COUNTY_API}/departments/${n}`, { headers: H, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`department ${n} HTTP ${res.status}`);
      const rows = await res.json();
      if (Array.isArray(rows)) all.push(...rows);
      await caDirectDeps.pause(1000);
    }
    return parseLaCounty(all, now);
  } catch (e) {
    throw new SourceUnreachableError(CA_LA_COUNTY_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}

/**
 * Port of Oakland (`ca_port_of_oakland`): its public Bids/RFPs/RFQs table (Type, Title, Deadline
 * "12/01/2026 until 12:00 pm [Pacific Time]", Status). Only "Current" rows are read.
 */
export const CA_PORT_OAKLAND_SOURCE = "ca_port_of_oakland";
export const PORT_OAKLAND_URL = "https://www.portofoakland.com/business/bids-rfp-center";

export function parsePortOfOakland(html: string, now: number = Date.now()): Result {
  if (!/class="bid-table"/.test(html)) throw new SourceUnreachableError(CA_PORT_OAKLAND_SOURCE, ["Bid table missing (page changed)"]);
  const r = newResult();
  const skip = skipOf(r);
  const seen = new Set<string>();
  for (const tr of html.matchAll(/<tr class="bid-table-row">([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) { skip("unknown", "missing_fields"); continue; }
    const type = text(cells[0]);
    const a = /<a href='([^']+)'[^>]*>([\s\S]*?)<\/a>/.exec(cells[1]);
    const title = text(a?.[2] ?? cells[1]);
    const status = text(cells[3]);
    const id = /\((?:Bid|RFP|RFQ)\s+No\.\s*([\w/-]+)\)/i.exec(title)?.[1] ?? title;
    if (!title) { skip("unknown", "missing_fields"); continue; }
    if (!/^current$/i.test(status)) { skip(id, "not_current"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+until\s+(\d{1,2}):(\d{2})\s*([ap])m/i.exec(text(cells[2]));
    const due = m ? pacificIso(+m[3], +m[1], +m[2], to24(+m[4], m[6]), +m[5]) : null;
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    r.rows.push({
      external_id: `portoakland-${id.replace(/[^\w-]+/g, "-")}`,
      title: title.replace(/^\((?:Bid|RFP|RFQ)\s+No\.\s*[\w/-]+\)\s*/i, ""),
      agency: "Port of Oakland",
      location: "Oakland, CA",
      description: `Port of Oakland ${type || "solicitation"}: ${title}. Deadline ${text(cells[2]).replace(/\s*\[Pacific Time\]/i, "")} Pacific.`,
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: a ? new URL(a[1], PORT_OAKLAND_URL).href : PORT_OAKLAND_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: id === title ? null : id,
      notice_type: /rfp/i.test(type) ? "RFP" : /rfq/i.test(type) ? "RFQ" : /bid/i.test(type) ? "ITB" : type || null,
    });
  }
  return r;
}

/**
 * City of Berkeley (`ca_berkeley`): its Bid & Proposal Opportunities table (title, spec number, due date
 * as a machine-readable <time datetime>, posted date).
 */
export const CA_BERKELEY_SOURCE = "ca_berkeley";
export const BERKELEY_URL = "https://berkeleyca.gov/doing-business/working-city/bid-proposal-opportunities";

export function parseBerkeley(html: string, now: number = Date.now()): Result {
  if (!/co-due-date/.test(html)) throw new SourceUnreachableError(CA_BERKELEY_SOURCE, ["Opportunities table missing (page changed)"]);
  const r = newResult();
  const skip = skipOf(r);
  const seen = new Set<string>();
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = tr[1];
    if (!/co-name/.test(row)) continue;
    const a = /co-name[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    const title = text(a?.[2] ?? "");
    const spec = text((/co-spec-number[^>]*>([\s\S]*?)<\/td>/.exec(row)?.[1] ?? "").replace(/<!--[\s\S]*?-->/g, ""));
    const dueAttr = /co-due-date[\s\S]*?<time datetime="([^"]+)"/.exec(row)?.[1];
    const id = spec || a?.[1] || title;
    if (!title) { skip(id || "unknown", "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const due = dueAttr && Number.isFinite(Date.parse(dueAttr)) ? new Date(dueAttr).toISOString() : null;
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "long", timeStyle: "short" }).format(new Date(due));
    r.rows.push({
      external_id: `berkeley-${id.replace(/[^\w-]+/g, "-").slice(0, 80)}`,
      title,
      agency: "City of Berkeley",
      location: "Berkeley, CA",
      description: `City of Berkeley solicitation${spec ? ` ${spec}` : ""}: ${title}. Due ${local} Pacific.`,
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: a ? new URL(a[1], BERKELEY_URL).href : BERKELEY_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: spec || null,
      notice_type: null,
    });
  }
  return r;
}

/**
 * UC Berkeley Capital Strategies (`ca_uc_berkeley`): its "Current Bids: Construction" table (project,
 * number, due "December 3, 2026 10:00AM PST"). Every row on that table is a construction bid.
 */
export const CA_UCB_SOURCE = "ca_uc_berkeley";
export const UCB_URL = "https://capitalstrategies.berkeley.edu/current-bids";

export function parseUcBerkeley(html: string, now: number = Date.now()): Result {
  const at = html.indexOf("Bids: Construction");
  if (at < 0) throw new SourceUnreachableError(CA_UCB_SOURCE, ["Construction bids table missing (page changed)"]);
  const table = html.slice(at, html.indexOf("</table>", at));
  const r = newResult();
  const skip = skipOf(r);
  const seen = new Set<string>();
  for (const tr of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 3 || /Project Name/.test(cells[0])) continue;
    const a = /<p>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(cells[0]);
    const title = text((a?.[2] ?? "").replace(/<span[^>]*class="element-invisible"[\s\S]*?<\/span>/g, "")).replace(/\(link is external\)/i, "").trim();
    const number = text(cells[1]);
    const id = number || title;
    if (!title || !number) { skip(id || "unknown", "missing_fields"); continue; }
    if (seen.has(`${number}|${title}`)) { skip(id, "duplicate"); continue; }
    seen.add(`${number}|${title}`);
    const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\D*?(\d{1,2}):(\d{2})\s*([AP])M/i.exec(text(cells[2]));
    const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
    const due = m && mo ? pacificIso(+m[3], mo, +m[2], to24(+m[4], m[6]), +m[5]) : null;
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    r.rows.push({
      external_id: `ucberkeley-${number}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
      title,
      agency: "University of California, Berkeley (Capital Strategies)",
      location: "Berkeley, CA",
      description: `UC Berkeley construction bid ${number}: ${title}. Due ${text(cells[2])}.`,
      category: mapCategory("", title, "construction bid"),
      due_date: due,
      estimated_value: "",
      source_url: UCB_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: "ITB",
    });
  }
  return r;
}

/**
 * UCLA Capital Programs (`ca_ucla_capital`): "Projects Currently Bidding". The page names each project
 * (number, description, estimated cost) and links its Advertisement for Bids PDF; the deadline is only in
 * the PDF ("BID DEADLINE: … must be received at or before: 2:00 p.m., July 28, 2026"). The reader opens
 * each linked PDF on the same site (paced) and reads that line; a PDF without it (prequalification calls,
 * contractor-run sub bids in other formats) is skipped as `no_deadline`, never guessed.
 */
export const CA_UCLA_SOURCE = "ca_ucla_capital";
export const UCLA_URL = "https://www.capitalprograms.ucla.edu/Contracts/Bidding";

export interface UclaListing { title: string; pdf: string; number: string; description: string; estimate: string }

export function parseUclaPage(html: string): UclaListing[] {
  if (!/Projects Currently Bidding|Project Name/.test(html)) throw new SourceUnreachableError(CA_UCLA_SOURCE, ["Bidding list missing (page changed)"]);
  const out: UclaListing[] = [];
  const blocks = html.split(/<th scope="row" class="bg-ucla-light-blue">Project Name<\/th>/).slice(1);
  for (const b of blocks) {
    const a = /<a href="(\/file\/contract\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<span class="visually-hidden">/.exec(b);
    if (!a) continue;
    const field = (label: string) => text(new RegExp(`${label}</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`).exec(b)?.[1] ?? "");
    out.push({ title: text(a[2]), pdf: new URL(a[1], UCLA_URL).href, number: field("Project Number"), description: field("Project Description"), estimate: field("Estimated Construction Cost") });
  }
  return out;
}

/** "… BID DEADLINE: … at or before: 2:00 p.m., July 28, 2026" → ISO (Pacific). PURE. */
export function uclaPdfDeadline(pdfText: string): string | null {
  const t = pdfText.replace(/\s+/g, " ");
  const at = t.search(/BID DEADLINE/i);
  if (at < 0) return null;
  const m = /at or before:?\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?,?\s*([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(t.slice(at, at + 600));
  if (!m) return null;
  const mo = MONTHS.indexOf(m[4].toLowerCase()) + 1 || MONTHS.findIndex((x) => x.startsWith(m[4].toLowerCase().slice(0, 3))) + 1;
  return mo ? pacificIso(+m[6], mo, +m[5], to24(+m[1], m[3]), +m[2]) : null;
}

/** First `max` characters, cut at a word, with an ellipsis. PURE. */
const shorten = (v: string, max: number) => (v.length <= max ? v.replace(/([^.!?])$/, "$1.") : `${v.slice(0, max).replace(/\s+\S*$/, "")}…`);

export function collectUcla(entries: { listing: UclaListing; pdfText: string | null }[], now: number = Date.now()): Result {
  const r = newResult();
  const skip = skipOf(r);
  const seen = new Set<string>();
  for (const { listing: l, pdfText } of entries) {
    const id = l.pdf.split("/").slice(-2).join("-").replace(/\.pdf$/i, "");
    if (!l.title) { skip(id, "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    if (pdfText === null) { skip(id, "pdf_unreadable"); continue; }
    const due = uclaPdfDeadline(pdfText);
    if (!due) { skip(id, "no_deadline"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    const est = /\$\d/.test(l.estimate) ? l.estimate : "";
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "long", timeStyle: "short" }).format(new Date(due));
    r.rows.push({
      external_id: `uclacapital-${id.replace(/[^\w-]+/g, "-").slice(0, 90)}`,
      title: l.title,
      agency: "University of California, Los Angeles (Capital Programs)",
      location: "Los Angeles, CA",
      description: `UCLA Capital Programs bid${l.number ? ` (project ${l.number})` : ""}: ${l.title}.${l.description ? ` ${shorten(l.description.replace(/\s*TO VIEW AND DOWNLOAD[\s\S]*$/i, ""), 420)}` : ""}${est ? ` Estimated construction cost ${est}.` : ""} Bids due ${local} Pacific (from the Advertisement for Bids).`,
      category: mapCategory("", l.title, "construction bid"),
      due_date: due,
      estimated_value: est,
      source_url: l.pdf,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: l.number || null,
      notice_type: "ITB",
    });
  }
  return r;
}

export const caPdfDeps = {
  pdfText: async (bytes: Uint8Array): Promise<string> => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text: t } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    return String(t);
  },
};

export async function fetchCaUclaBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const res = await caDirectDeps.fetch(UCLA_URL, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const listings = parseUclaPage(await res.text());
    const entries: { listing: UclaListing; pdfText: string | null }[] = [];
    const cache = new Map<string, string | null>();
    for (const listing of listings) {
      if (!cache.has(listing.pdf)) {
        let t: string | null = null;
        try {
          await caDirectDeps.pause(800);
          const p = await caDirectDeps.fetch(listing.pdf, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(40000) });
          if (p.ok) t = await caPdfDeps.pdfText(new Uint8Array(await p.arrayBuffer()));
        } catch { t = null; }
        cache.set(listing.pdf, t);
      }
      entries.push({ listing, pdfText: cache.get(listing.pdf) ?? null });
    }
    return collectUcla(entries, now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(CA_UCLA_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}

async function readHtml(source: string, url: string, parse: (html: string, now: number) => Result, now: number): Promise<FetchResult> {
  try {
    const res = await caDirectDeps.fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parse(await res.text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(source, [e instanceof Error ? e.message : String(e)]);
  }
}

export const CA_DIRECT_BATCH2: { name: string; fetchFn: () => Promise<FetchResult> }[] = [
  { name: CA_LA_COUNTY_SOURCE, fetchFn: () => fetchCaLaCountyBids() },
  { name: CA_PORT_OAKLAND_SOURCE, fetchFn: () => readHtml(CA_PORT_OAKLAND_SOURCE, PORT_OAKLAND_URL, parsePortOfOakland, Date.now()) },
  { name: CA_BERKELEY_SOURCE, fetchFn: () => readHtml(CA_BERKELEY_SOURCE, BERKELEY_URL, parseBerkeley, Date.now()) },
  { name: CA_UCB_SOURCE, fetchFn: () => readHtml(CA_UCB_SOURCE, UCB_URL, parseUcBerkeley, Date.now()) },
  { name: CA_UCLA_SOURCE, fetchFn: () => fetchCaUclaBids() },
];
