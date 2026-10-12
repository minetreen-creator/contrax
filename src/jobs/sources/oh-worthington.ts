/** Worthington's current RFP page. Legacy Bids.aspx entries are not ingested:
 * they retain old projects as 'Open / Upon Contract'. Read deadlines from the
 * current page's linked solicitation PDFs instead. Bid Express is a separate
 * surface and is not claimed as covered by this connector.
 */
import { mapCategory } from "~/lib/trade-classification";
import { stripHtml, type RawBid } from "./sam-gov";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";

export const WORTHINGTON_PAGE = "https://www.worthington.org/492/RFP-Bid-Postings";
const ORIGIN = "https://www.worthington.org";
export interface WorthingtonListing { title: string; url: string; id: string; type: string }

export function readWorthingtonListings(html: string): WorthingtonListing[] {
  const listings = new Map<string, WorthingtonListing>();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = stripHtml(m[2]).replace(/&amp;/g, "&").trim();
    const kind = title.match(/^(RFP|RFQ|BID):\s*(.+)/i);
    if (!kind) continue;
    const url = new URL(m[1].replace(/&amp;/g, "&"), ORIGIN);
    const id = url.pathname.match(/^\/DocumentCenter\/View\/(\d+)(?:\/|$)/i)?.[1];
    if (url.origin !== ORIGIN || !id) continue;
    listings.set(id, { title: kind[2], url: url.href, id, type: kind[1].toUpperCase() });
  }
  return [...listings.values()];
}

/** Only an explicit response delivery deadline with a year and AM/PM time.
 * Question dates, issue dates and tentative schedules are never substitutes.
 * Current notice: Nov 2 2026 noon in Worthington (EST, after DST ends).
 */
export function readWorthingtonDeadline(raw: string): { iso: string; phrase: string } | null {
  const text = raw.replace(/\s+/g, " ");
  const m = text.match(/(?:completed\s+response\s+must\s+be\s+delivered|proposals?\s+must\s+be\s+(?:received|submitted|delivered))\s+(?:on\s+or\s+before|no\s+later\s+than|by)\s+(?:\w+,\s*)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4}),?\s+(?:by|at)\s+(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = months.indexOf(m[1].toLowerCase());
  const day = Number(m[2]), year = Number(m[3]), hour12 = Number(m[4]), minute = Number(m[5]);
  if (month < 0 || hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = hour12 % 12 + (m[6].toUpperCase() === "PM" ? 12 : 0);
  const local = Date.UTC(year, month, day, hour, minute);
  const d = new Date(local);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  // Intl uses the actual jurisdiction's timezone rules, including DST.
  const format = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const parts = Object.fromEntries(format.formatToParts(new Date(local)).map(p => [p.type, p.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return { iso: new Date(local + local - wall).toISOString(), phrase: m[0] };
}

export function worthingtonRow(listing: WorthingtonListing, text: string, now: number): RawBid | null {
  const deadline = readWorthingtonDeadline(text);
  if (!deadline || Date.parse(deadline.iso) <= now) return null;
  const budget = text.replace(/\s+/g, " ").match(/The City has budgeted\s+(\$[\d,]+)/i)?.[1] ?? "";
  return {
    external_id: `worthington-${listing.id}`, title: listing.title,
    agency: "City of Worthington", location: "Worthington, OH",
    description: `City of Worthington ${listing.type}: ${listing.title}. Deadline as stated: "${deadline.phrase}" (Worthington local time). ${budget ? `The City states a project budget of ${budget}. ` : ""}Full scope, requirements and submission instructions are in the official solicitation PDF.`,
    category: mapCategory("", listing.title, ""), due_date: deadline.iso,
    estimated_value: budget, source_url: listing.url, set_aside: null,
    naics_code: null, psc: null, solicitation_number: null,
    notice_type: listing.type === "BID" ? "ITB" : listing.type,
  };
}

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.url.startsWith(ORIGIN + "/")) throw new Error(`HTTP ${response.status} or unexpected redirect at ${url}`);
  return response;
}

export async function fetchOhWorthingtonBids(now = Date.now()): Promise<FetchResult> {
  try {
    const html = await (await get(WORTHINGTON_PAGE)).text();
    if (!/Request for Proposals\s*(?:&amp;|&)\s*Bid Information/i.test(html)) throw new Error("RFP page shape changed");
    const listings = readWorthingtonListings(html);
    if (listings.length > 30) throw new Error("RFP listing limit exceeded; refusing partial coverage");
    const rows: RawBid[] = [], skipped: Record<string, number> = {}, skippedRows: { id: string; reason: string }[] = [];
    const { extractText, getDocumentProxy } = await import("unpdf");
    for (const listing of listings) {
      const bytes = new Uint8Array(await (await get(listing.url)).arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error(`Not a PDF: ${listing.url}`);
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      if (!text.trim()) throw new Error(`Unreadable PDF: ${listing.url}`);
      const row = worthingtonRow(listing, text, now);
      if (row) rows.push(row);
      else {
        const reason = readWorthingtonDeadline(text) ? "closed" : "no_verified_deadline";
        skipped[reason] = (skipped[reason] ?? 0) + 1;
        skippedRows.push({ id: listing.id, reason });
      }
    }
    return { rows, skipped, skippedRows };
  } catch (e) {
    throw new SourceUnreachableError("oh_worthington", [e instanceof Error ? e.message : String(e)]);
  }
}
