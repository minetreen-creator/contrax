/**
 * Tennessee batch 2 (owner 2026-11-06: "I want ALL construction bids in TN" → "Batch 2").
 *
 * EPB Chattanooga (`tn_epb`), the city-owned electric and fiber utility: its public
 * "Competitive Sealed Bids / Requests for Proposals" page
 *   GET https://business.epb.com/competitive-sealed-bids-request-for-proposals/
 * lists each solicitation as a card: short description (title), RFP number, long description,
 * owner, Issue Date, optional Pre-Bid Date, Due Date ("11/20/2026" or "11/30/2026 @ 2:00 P.M. EST").
 *
 * City of Kingsport (`tn_kingsport`): its public solicitations portal
 *   GET https://www.kingsporttn.gov/city-services/public-bids/
 * lists active solicitations as cards: category, title, "Solicitation #N", type (ITB/RFP/RFQ),
 * Posted Date, Closing Date ("Thu, November 19, 2026 • 4:00 pm"), and public document links.
 *
 * DATA HONESTY: both are Eastern time. A due date with no time is read as 11:59 PM Eastern (the
 * date-only convention) and the description says no time was stated. Contact names, emails and
 * phone numbers are never stored. Skipped: passed (`closed`), unreadable date (`bad_date`), no
 * title or number (`missing_fields`), repeats (`duplicate`).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
export const TN_EPB_SOURCE = "tn_epb";
export const EPB_BIDS_URL = "https://business.epb.com/competitive-sealed-bids-request-for-proposals/";
export const TN_KINGSPORT_SOURCE = "tn_kingsport";
export const KINGSPORT_BIDS_URL = "https://www.kingsporttn.gov/city-services/public-bids/";

/** Eastern wall time → ISO UTC, DST-aware; null for an impossible or ambiguous time. PURE. */
export function easternIso(y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  const target = { year: y, month: mo, day: d, hour: h, minute: mi };
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const hits = [4, 5].map((o) => new Date(wall + o * 3_600_000)).filter((t) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Object.entries(target).every(([k, val]) => p[k] === val);
  });
  return hits.length === 1 ? hits[0].toISOString() : null;
}

const to24 = (h12: number, ap: string) => (h12 % 12) + (/^p/i.test(ap) ? 12 : 0);
const text = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

interface Result extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}
function collector() {
  const r: Result = { rows: [], skipped: {}, skippedRows: [] };
  const skip = (id: string, reason: string) => {
    r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
    r.skippedRows.push({ id, reason });
  };
  return { r, skip };
}

/** "11/20/2026" or "11/30/2026 @ 2:00 P.M. EST" → { iso, timed }. PURE. */
export function epbDue(v: string): { iso: string; timed: boolean } | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*@\s*(\d{1,2}):(\d{2})\s*([AP])\.?\s*M\.?)?/i.exec(v.trim());
  if (!m) return null;
  const timed = !!m[4];
  const iso = timed ? easternIso(+m[3], +m[1], +m[2], to24(+m[4], m[6]), +m[5]) : easternIso(+m[3], +m[1], +m[2], 23, 59);
  return iso ? { iso, timed } : null;
}

export function parseEpbBids(html: string, now: number = Date.now()): Result {
  if (!/rfp-short-description|rfp-number/.test(html) && !/Competitive Sealed Bids/i.test(html)) {
    throw new SourceUnreachableError(TN_EPB_SOURCE, ["Bid cards missing (page changed)"]);
  }
  const { r, skip } = collector();
  const seen = new Set<string>();
  const cards = html.split(/<h2 class="rfp-short-description[^"]*">/).slice(1);
  for (const card of cards) {
    const title = text(card.slice(0, card.indexOf("</h2>")));
    const number = text(/<h3 class="rfp-number[^"]*">([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? "");
    const long = text(/<p class="rfp-long-description[^"]*">([\s\S]*?)<\/p>/.exec(card)?.[1] ?? "");
    const dueRaw = text(/<p class="rfp-date-due[^"]*">\s*<span[^>]*>[^<]*<\/span>([\s\S]*?)<\/p>/.exec(card)?.[1] ?? "");
    const preBid = text(/<p class="rfp-date-pre-bid[^"]*">\s*<span[^>]*>[^<]*<\/span>([\s\S]*?)<\/p>/.exec(card)?.[1] ?? "");
    if (!title || !number) { skip(number || "unknown", "missing_fields"); continue; }
    if (seen.has(number)) { skip(number, "duplicate"); continue; }
    seen.add(number);
    const due = epbDue(dueRaw);
    if (!due) { skip(number, "bad_date"); continue; }
    if (Date.parse(due.iso) <= now) { skip(number, "closed"); continue; }
    const description = [
      `EPB (Chattanooga) ${number}: ${title}.`,
      long && long !== title ? `${long.replace(/([^.!?])$/, "$1.")}` : "",
      preBid ? `Pre-bid: ${preBid}.` : "",
      `Due ${dueRaw}${due.timed ? "" : " (no time stated; check the solicitation)"}.`,
    ].filter(Boolean).join(" ");
    r.rows.push({
      external_id: `epb-${number}`,
      title,
      agency: "EPB (Electric Power Board of Chattanooga)",
      location: "Chattanooga, TN",
      description,
      category: mapCategory("", title, long),
      due_date: due.iso,
      estimated_value: "",
      source_url: EPB_BIDS_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: /invitation to bid|\bitb\b/i.test(long) ? "ITB" : "RFP",
    });
  }
  return r;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Thu, November 19, 2026 • 4:00 pm" → ISO (Eastern). PURE. */
export function kingsportDue(v: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\D+(\d{1,2}):(\d{2})\s*([ap])m/i.exec(v);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  if (mo < 1 || +m[4] < 1 || +m[4] > 12) return null;
  return easternIso(+m[3], mo, +m[2], to24(+m[4], m[6]), +m[5]);
}

const NOTICE: Record<string, string> = { ITB: "ITB", IFB: "ITB", RFP: "RFP", RFQ: "RFQ", RFI: "RFI" };

export function parseKingsportBids(html: string, now: number = Date.now()): Result {
  if (!/id="bidList"/.test(html)) throw new SourceUnreachableError(TN_KINGSPORT_SOURCE, ["Solicitation list missing (page changed)"]);
  const { r, skip } = collector();
  const seen = new Set<string>();
  const list = html.slice(html.indexOf('id="bidList"'));
  for (const m of list.matchAll(/<article\b([^>]*class="bid-card[^"]*"[^>]*)>([\s\S]*?)<\/article>/g)) {
    const attrs = m[1];
    const card = m[2];
    const title = text(/<h2 class="bid-title">([\s\S]*?)<\/h2>/.exec(card)?.[1] ?? "");
    const number = /Solicitation #\s*([\w-]+)/.exec(card)?.[1] ?? "";
    const type = text(/<p class="bid-solicitation-type">([\s\S]*?)<\/p>/.exec(card)?.[1] ?? "");
    const category = text(/<div class="bid-category[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(card)?.[1] ?? "");
    const closing = text(/Closing Date<\/span>\s*<span class="deadline-value">([\s\S]*?)<\/span>/.exec(card)?.[1] ?? "");
    if (!title || !number) { skip(number || "unknown", "missing_fields"); continue; }
    if (seen.has(number)) { skip(number, "duplicate"); continue; }
    seen.add(number);
    const due = kingsportDue(closing);
    if (!due) { skip(number, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(number, "closed"); continue; }
    let doc: string | null = null;
    try {
      const docs = JSON.parse((/data-documents="([^"]*)"/.exec(attrs)?.[1] ?? "[]").replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as { url?: string; type?: string }[];
      doc = docs.find((d) => /solicitation/i.test(d.type ?? ""))?.url ?? docs[0]?.url ?? null;
    } catch { doc = null; }
    r.rows.push({
      external_id: `kingsport-${number}`,
      title,
      agency: "City of Kingsport",
      location: "Kingsport, TN",
      description: `City of Kingsport ${type || "solicitation"} #${number}${category ? ` (${category})` : ""}: ${title}. Closes ${closing.replace(/\s*•\s*/, " at ")} Eastern time. Documents are on the City's public solicitations page.`,
      category: mapCategory(category, title, category),
      due_date: due,
      estimated_value: "",
      source_url: doc && /^https:\/\/www\.kingsporttn\.gov\//.test(doc) ? doc : KINGSPORT_BIDS_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: NOTICE[type.toUpperCase()] ?? (type || null),
    });
  }
  return r;
}

export const tnBatch2Deps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

async function read(source: string, url: string, parse: (html: string, now: number) => Result, now: number): Promise<FetchResult> {
  try {
    const r = await tnBatch2Deps.fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parse(await r.text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(source, [e instanceof Error ? e.message : String(e)]);
  }
}

export const fetchTnEpbBids = (now: number = Date.now()) => read(TN_EPB_SOURCE, EPB_BIDS_URL, parseEpbBids, now);
export const fetchTnKingsportBids = (now: number = Date.now()) => read(TN_KINGSPORT_SOURCE, KINGSPORT_BIDS_URL, parseKingsportBids, now);
