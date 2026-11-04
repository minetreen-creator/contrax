/**
 * NJ TRANSIT procurement calendar — `nj_transit` (owner 2026-11-04: a Buffalo
 * visitor searched janitorial in New Jersey and found 4 bids → "yes" to more NJ
 * sources, then "Yes" to an NJ TRANSIT reader).
 *
 * WHY: NJ TRANSIT buys station and facility maintenance, cleaning, parking
 * operations, construction and supplies, and posts none of it on NJSTART or
 * BidNet.
 *
 * SOURCE (captured 2026-11-04 from a GitHub Actions job; public, no login, no
 * CAPTCHA): https://www.njtransit.com/procurement/calendar
 *   The page is server-rendered by Nuxt. Its `__NUXT_DATA__` JSON carries the
 *   page body as one HTML string: one table per fiscal year ("FY 2027 (…)"),
 *   with rows of Event Date | Time | Description | IFB/RFP No | Location |
 *   Contact | Bids Received. Full packages are on Bid Express; the calendar
 *   links each advertisement PDF.
 *
 * WHAT IS A BID: only rows whose description says bids or proposals are due
 * ("Electronic Bids Due for IFB No. …", "Proposals Due: RFP No. …"). Pre-bid
 * conferences, real-property notices of intent and scrap auctions are skipped.
 * Contact names are never stored.
 *
 * TIME: the calendar prints "02:00" / "11:00" with no AM/PM; NJ TRANSIT bid
 * deadlines are business hours, so an hour before 7 is read as p.m. Eastern.
 */
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import { mapCategory } from "~/lib/trade-classification";
import { odotLettingToIso } from "./oh-odot";
import type { RawBid } from "./sam-gov";

export const NJ_TRANSIT_SOURCE = "nj_transit";
export const NJ_TRANSIT_URL = "https://www.njtransit.com/procurement/calendar";
export const NJ_TRANSIT_AGENCY = "NJ TRANSIT (New Jersey Transit Corporation)";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** The page body HTML inside `__NUXT_DATA__` (the longest string), or null. PURE. */
export function calendarBody(pageHtml: string): string | null {
  const m = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(pageHtml);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  let best: string | null = null;
  for (const x of data) if (typeof x === "string" && x.includes("proc-cal") && (!best || x.length > best.length)) best = x;
  return best;
}

export interface CalendarRow {
  date: string;
  time: string;
  description: string;
  number: string;
  advertisement: string | null;
}

/** Every row of every fiscal-year table, in page order. PURE. */
export function readCalendarRows(body: string): CalendarRow[] {
  const out: CalendarRow[] = [];
  for (const tr of body.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g)) {
    const pdf = /href="(https:\/\/content\.njtransit\.com\/[^"]+\.pdf)"/i.exec(tr[3])?.[1] ?? null;
    out.push({ date: text(tr[1]), time: text(tr[2]), description: text(tr[3]), number: text(tr[4]), advertisement: pdf });
  }
  return out;
}

const DUE = /^(?:electronic\s+)?(?:sealed\s+)?(?:bids?|proposals?|qualifications|statements? of qualifications)\s+(?:are\s+)?due\b/i;

/** "12/22/26" + "02:00" → 2 p.m. Eastern; "11:00" → 11 a.m. PURE. */
export function calendarDueIso(date: string, time: string): string | null {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(date.trim());
  if (!d) return null;
  const year = d[3].length === 2 ? `20${d[3]}` : d[3];
  const midnight = odotLettingToIso(`${d[1]}/${d[2]}/${year}`);
  if (!midnight) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  let h = t ? Number(t[1]) : 17;
  const min = t ? Number(t[2]) : 0;
  if (h < 7) h += 12;
  return new Date(Date.parse(midnight) + (h * 60 + min) * 60_000).toISOString();
}

/** The quoted solicitation name in a description, or null. PURE. */
export function solicitationName(description: string): string | null {
  const m = /["“]([^"”]{4,200}?)[."”]*["”]/.exec(description);
  return m ? m[1].replace(/[.,\s]+$/, "").trim() : null;
}

const sentence = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (_m, p, c) => p + c.toUpperCase()) : s);

export interface NjTransitParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseNjTransitCalendar(pageHtml: string, now: number = Date.now()): NjTransitParseResult {
  const body = calendarBody(pageHtml);
  if (!body) throw new Error("calendar data missing");
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const r of readCalendarRows(body)) {
    const id = r.number.replace(/^(?:IFB|RFP|RFQ|RFI)\s*No\.?\s*/i, "").trim();
    if (!DUE.test(r.description)) { skip(id || r.date, "not_a_due_date"); continue; }
    const due = calendarDueIso(r.date, r.time);
    if (!due) { skip(id || r.date, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id || r.date, "closed"); continue; }
    const name = solicitationName(r.description);
    if (!id || !name) { skip(id || r.date, "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const title = sentence(name);
    const kind = /^RFP/i.test(r.number) ? "RFP" : /^RFQ/i.test(r.number) ? "RFQ" : "IFB";
    rows.push({
      external_id: `njtransit-${id}`,
      title,
      agency: NJ_TRANSIT_AGENCY,
      location: "New Jersey",
      description: `NJ TRANSIT ${kind} ${id}: ${title}. ${kind === "RFP" ? "Proposals" : "Bids"} are due ${r.date} at ${r.time} (electronic only, via Bid Express). The advertisement is linked from NJ TRANSIT's procurement calendar; full packages are on Bid Express.`,
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "Not specified",
      source_url: r.advertisement ?? NJ_TRANSIT_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: `${kind} ${id}`,
      notice_type: kind === "RFP" ? "Request for Proposals" : "Invitation for Bids",
    });
  }
  return { rows, skipped, skippedRows };
}

export const njTransitDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
};

export async function fetchNjTransitBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const r = await njTransitDeps.fetch(NJ_TRANSIT_URL, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const body = calendarBody(html);
    if (!body || !/FY 20\d\d/.test(body)) throw new Error("procurement calendar shape changed");
    return parseNjTransitCalendar(html, now);
  } catch (e) {
    throw new SourceUnreachableError(NJ_TRANSIT_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
