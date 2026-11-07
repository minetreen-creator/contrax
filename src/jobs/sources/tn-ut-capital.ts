/**
 * University of Tennessee capital projects (`tn_ut_capital`) — owner 2026-11-06: "I want ALL
 * construction bids in TN", then "3" (read UT's due dates out of its PDFs).
 *
 * SOURCE (verified 2026-11-06, no login): UT Capital Projects publishes one public page per campus,
 *   https://tennessee.edu/about/divisions/finance-admin/capital-projects/construction-opportunities/<slug>/
 * (UT System, Knoxville, Chattanooga, Southern, Martin, Health Science Center, Institute of
 * Agriculture, Institute for Public Service). Its "Invitations to Bid" list links each project's
 * Invitation to Bid PDF, with a "Post Date" and sometimes a note ("Bid Opening has been moved to
 * Friday, February 27th at 2:00 pm ET"). The page itself states no deadline, so the reader opens each
 * linked PDF (public, same site) and reads the bid deadline it states:
 *   - the State's standard form: "Until 2:00 p.m., local time / On December 3, 2026"
 *   - CM/GC bid packages: "no later than 2:00 P.M., EST, Tuesday February 24, 2026",
 *     "Until: 2:00PM Local Time On: Tuesday, March 10, 2026", "Bid Due Date: Thursday May 14th, 2026, 2:00 pm EST"
 * A note on the page that moves the opening wins over the PDF.
 *
 * DATA HONESTY:
 *   - "local time" is the zone of the city where bids are received (Tennessee spans Eastern and
 *     Central; Crossville and Martin are Central, Knoxville and Chattanooga Eastern); an explicit
 *     EST/ET/CST/CT wins.
 *   - A PDF whose deadline cannot be read (scanned image, a table of per-trade dates) is skipped as
 *     `no_deadline`, never guessed. Contacts, Zoom links and phone numbers are not stored.
 * Skipped: `closed`, `no_deadline`, `pdf_unreadable`, `missing_fields`, `duplicate`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";
import { tbrZone } from "./tn-tbr";

export const TN_UT_CAPITAL_SOURCE = "tn_ut_capital";
export const UT_CAPITAL_BASE = "https://tennessee.edu/about/divisions/finance-admin/capital-projects/construction-opportunities/";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";

type Zone = "America/New_York" | "America/Chicago";
export interface UtCampus { slug: string; name: string; city: string; zone: Zone }
export const UT_CAMPUSES: readonly UtCampus[] = [
  { slug: "ut-system-bids", name: "University of Tennessee System", city: "Knoxville", zone: "America/New_York" },
  { slug: "utk-bids", name: "University of Tennessee, Knoxville", city: "Knoxville", zone: "America/New_York" },
  { slug: "utc-bids", name: "University of Tennessee at Chattanooga", city: "Chattanooga", zone: "America/New_York" },
  { slug: "uts-bids", name: "University of Tennessee Southern", city: "Pulaski", zone: "America/Chicago" },
  { slug: "utm-bids", name: "University of Tennessee at Martin", city: "Martin", zone: "America/Chicago" },
  { slug: "uthsc-bids", name: "University of Tennessee Health Science Center", city: "Memphis", zone: "America/Chicago" },
  { slug: "utia-bids", name: "UT Institute of Agriculture", city: "Knoxville", zone: "America/New_York" },
  { slug: "ips-bids", name: "UT Institute for Public Service", city: "Knoxville", zone: "America/New_York" },
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const month = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)) && s.length >= 3) + 1;
const to24 = (h: number, ap: string) => (h % 12) + (/^p/i.test(ap) ? 12 : 0);

/** Wall time in `zone` → ISO UTC, DST-aware; null when impossible or ambiguous. PURE. */
export function wallIso(zone: Zone, y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const target = { year: y, month: mo, day: d, hour: h, minute: mi };
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const hits = (zone === "America/Chicago" ? [5, 6] : [4, 5]).map((o) => new Date(wall + o * 3_600_000)).filter((t) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Object.entries(target).every(([k, val]) => p[k] === val);
  });
  return hits.length === 1 ? hits[0].toISOString() : null;
}

const zoneWord = (w: string | undefined, local: Zone): Zone =>
  !w || /local/i.test(w) ? local : /^e/i.test(w) ? "America/New_York" : /^c/i.test(w) ? "America/Chicago" : local;

const T = String.raw`(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?`;
const Z = String.raw`(local time|e[sd]?t|c[sd]?t)?`;
const DOW = String.raw`(?:(?:mon|tues|wednes|weds|thurs|fri|satur|sun)[a-z]*\.?,?\s+)?`;
const D = String.raw`([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`;
const DEADLINE: { re: RegExp; order: "TD" | "DT" }[] = [
  // "Until 2:00 p.m., local time On December 3, 2026" / "Until: 2:00PM Local Time On: Tuesday, March 10, 2026"
  { re: new RegExp(String.raw`until:?\s*${T},?\s*${Z},?\s*on:?\s*${DOW}${D}`, "i"), order: "TD" },
  // "no later than 2:00 P.M., EST, Tuesday February 24, 2026"
  { re: new RegExp(String.raw`no later than\s*${T},?\s*${Z},?\s*(?:on\s+)?${DOW}${D}`, "i"), order: "TD" },
  // "Bid Due Date: Thursday May 14th, 2026, 2:00 pm EST"
  { re: new RegExp(String.raw`bid due date:?\s*${DOW}${D},?\s*(?:at|@)?\s*${T}\s*${Z}`, "i"), order: "DT" },
];

/** The bid deadline a UT Invitation to Bid PDF states, or null. PURE. */
export function utPdfDeadline(text: string, local: Zone): { iso: string; zone: Zone } | null {
  const t = text.replace(/\s+/g, " ");
  for (const { re, order } of DEADLINE) {
    const m = re.exec(t);
    if (!m) continue;
    const [h, mi, ap, zw, mo, d, y] = order === "TD"
      ? [m[1], m[2], m[3], m[4], m[5], m[6], m[7]]
      : [m[4], m[5], m[6], m[7], m[1], m[2], m[3]];
    const zone = zoneWord(zw, local);
    const iso = wallIso(zone, +y, month(mo), +d, to24(+h, ap), +mi);
    if (iso) return { iso, zone };
  }
  return null;
}

/** A page note that moves the opening ("moved to Friday, February 27th at 2:00 pm ET"). PURE. */
export function utMovedDeadline(note: string, local: Zone, fallbackYear: number): { iso: string; zone: Zone } | null {
  const m = new RegExp(String.raw`(?:moved|postponed|rescheduled|extended|changed)\s+to\s+${DOW}([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?,?\s*(?:at|@)\s*${T}\s*(local time|e[sd]?t|c[sd]?t)?`, "i").exec(note.replace(/\s+/g, " "));
  if (!m) return null;
  const zone = zoneWord(m[8], local);
  const iso = wallIso(zone, m[3] ? +m[3] : fallbackYear, month(m[1]), +m[2], to24(+m[4], m[6]), +m[5]);
  return iso ? { iso, zone } : null;
}

const clean = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–").replace(/&#8217;|&rsquo;|&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export interface UtListing { campus: UtCampus; title: string; pdf: string; postDate: string | null; notes: string[] }

/** The top-level items of a campus page's "Invitations to Bid" list. PURE. */
export function parseUtCampusPage(campus: UtCampus, html: string): UtListing[] {
  const at = html.lastIndexOf("Invitations to Bid</h2>");
  if (at < 0) throw new SourceUnreachableError(TN_UT_CAPITAL_SOURCE, [`${campus.slug}: "Invitations to Bid" heading missing (page changed)`]);
  const end = html.indexOf("<h2", at + 10);
  const section = html.slice(at, end < 0 ? undefined : end);
  const items: string[] = [];
  let depth = 0, start = -1;
  for (const tag of section.matchAll(/<(\/?)(ul|li)\b[^>]*>/gi)) {
    const close = tag[1] === "/", name = tag[2].toLowerCase();
    if (name === "ul") { depth += close ? -1 : 1; continue; }
    if (depth !== 1) continue;
    if (!close) start = tag.index! + tag[0].length;
    else if (start >= 0) { items.push(section.slice(start, tag.index)); start = -1; }
  }
  const out: UtListing[] = [];
  for (const item of items) {
    const a = /^\s*<a href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/i.exec(item);
    if (!a) continue; // "No information available at this time"
    const notes = [...item.slice(a[0].length).matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((n) => clean(n[1])).filter(Boolean);
    const post = notes.map((n) => /^Post Date:\s*(.+)$/i.exec(n)?.[1]).find(Boolean) ?? null;
    out.push({ campus, title: clean(a[2]), pdf: a[1], postDate: post, notes: notes.filter((n) => !/^Post Date:/i.test(n)) });
  }
  return out;
}

export interface UtParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** One listing plus its PDF's text (null when the PDF could not be read) → a bid or a skip reason. PURE. */
export function utListingToBid(l: UtListing, pdfText: string | null, now: number): RawBid | string {
  if (!l.title || !l.pdf) return "missing_fields";
  if (pdfText === null) return "pdf_unreadable";
  const flat = pdfText.replace(/\s+/g, " ");
  // The city in the bid-receipt address (within the next ~250 characters), never one from elsewhere in the PDF.
  const receiptAt = flat.search(/BIDS RECEIVED AT/i);
  const receipt = receiptAt < 0 ? "" : flat.slice(receiptAt, receiptAt + 250);
  const received = /([A-Z][A-Za-z .]+),\s*TN\s+3\d{4}/.exec(receipt)?.[1]?.trim().split(/,\s*/).pop()?.replace(/^\d+\s+[A-Za-z .]*?(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Blvd)\.?\s+/, "") ?? null;
  const city = received && received.length < 30 ? received : l.campus.city;
  const local: Zone = received ? tbrZone(city, l.campus.zone === "America/New_York" ? "Knoxville" : "Nashville") : l.campus.zone;
  const fromPdf = utPdfDeadline(flat, local);
  const year = fromPdf ? new Date(fromPdf.iso).getUTCFullYear() : Number(/(\d{4})/.exec(l.postDate ?? "")?.[1] ?? new Date(now).getUTCFullYear());
  const moved = l.notes.map((n) => utMovedDeadline(n, local, year)).find(Boolean) ?? null;
  const due = moved ?? fromPdf;
  if (!due) return "no_deadline";
  if (Date.parse(due.iso) <= now) return "closed";
  const utNumber = /UT Number:?\s*([0-9/\-]+)/i.exec(flat)?.[1] ?? null;
  const id = utNumber ? `${utNumber}-${l.title}` : l.pdf;
  const tz = due.zone === "America/New_York" ? "Eastern" : "Central";
  const local12 = new Intl.DateTimeFormat("en-US", { timeZone: due.zone, dateStyle: "long", timeStyle: "short" }).format(new Date(due.iso));
  return {
    external_id: `utcapital-${hash(id)}`,
    title: l.title,
    agency: l.campus.name,
    location: `${city}, TN`,
    description: `${l.campus.name} Invitation to Bid${utNumber ? ` (UT Number ${utNumber})` : ""}: ${l.title}. Bids due ${local12} ${tz} time${moved ? " (opening moved, per UT's bid page)" : ""}.${l.postDate ? ` Posted ${l.postDate}.` : ""} The Invitation to Bid PDF names the designer and plan rooms.`,
    category: mapCategory("", l.title, ""),
    due_date: due.iso,
    estimated_value: "",
    source_url: l.pdf,
    set_aside: null,
    naics_code: null,
    psc: null,
    solicitation_number: utNumber,
    notice_type: "ITB",
  };
}

/** Short stable id (FNV-1a) so ids survive long titles. PURE. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export function collectUtBids(entries: { listing: UtListing; pdfText: string | null }[], now: number): UtParseResult {
  const r: UtParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const { listing, pdfText } of entries) {
    const out = utListingToBid(listing, pdfText, now);
    const id = typeof out === "string" ? listing.pdf : out.external_id;
    const reason = typeof out === "string" ? out : seen.has(out.external_id) ? "duplicate" : null;
    if (reason) {
      r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
      r.skippedRows.push({ id, reason });
      continue;
    }
    seen.add(id);
    r.rows.push(out as RawBid);
  }
  return r;
}

export const utDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  pdfText: async (bytes: Uint8Array): Promise<string> => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    return String(text);
  },
  pause: (ms: number) => new Promise((res) => setTimeout(res, ms)),
};

export async function fetchTnUtCapitalBids(now: number = Date.now()): Promise<FetchResult> {
  const entries: { listing: UtListing; pdfText: string | null }[] = [];
  try {
    for (const campus of UT_CAMPUSES) {
      const r = await utDeps.fetch(`${UT_CAPITAL_BASE}${campus.slug}/`, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`${campus.slug}: HTTP ${r.status}`);
      for (const listing of parseUtCampusPage(campus, await r.text())) {
        let pdfText: string | null = null;
        if (/^https:\/\/tennessee\.edu\//.test(listing.pdf)) {
          try {
            await utDeps.pause(1000);
            const p = await utDeps.fetch(listing.pdf, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(40000) });
            if (p.ok) pdfText = await utDeps.pdfText(new Uint8Array(await p.arrayBuffer()));
          } catch { pdfText = null; }
        }
        entries.push({ listing, pdfText });
      }
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(TN_UT_CAPITAL_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
  return collectUtBids(entries, now);
}
