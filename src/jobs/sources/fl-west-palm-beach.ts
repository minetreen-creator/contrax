/**
 * City of West Palm Beach, Florida — `fl_west_palm_beach` (owner 2026-11-14: "Florida coverage is
 * very thin" / "go"). The city lists every solicitation on its own site; documents are on DemandStar
 * (login), but the list, closing date, reference number, summary and status are public.
 *
 * SOURCE (checked 2026-11-14 as ContraxBot, no login, no CAPTCHA; robots.txt does not disallow it):
 * GET https://www.wpb.org/Departments/Procurement/Solicitations — one server-rendered page
 * ("190 Result(s) Found") of <article> cards, each with: link /Bids/<slug>, title (h2),
 * "Reference number", "Closing date December 15, 2026, 03:00 PM", a summary and "Status: Open".
 *
 * WHAT A ROW BECOMES: only cards with Status Open and a closing date still ahead. `due_date` is the
 * closing time in Eastern time. `source_url` is the city's own bid page. Canceled, closed, awarded,
 * past-due and undated cards (12 "Open" cards had no closing date on 2026-11-14) are skipped with
 * their reason. Live check that day: 6 open bids.
 *
 * IDENTITY: `external_id = flwpb-<the /Bids/ slug>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";
import { zonedIso } from "./revize-bids";

export const FL_WPB_SOURCE = "fl_west_palm_beach";
export const FL_WPB_LIST_URL = "https://www.wpb.org/Departments/Procurement/Solicitations";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const AGENCY = "City of West Palm Beach";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface WpbCard { slug: string; url: string; title: string; reference: string; closing: string; summary: string; status: string }

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&ndash;|&#8211;/g, "–").replace(/\s+/g, " ").trim();

/** The solicitation cards on the list page. PURE. */
export function readWpbCards(html: string): WpbCard[] {
  const out: WpbCard[] = [];
  for (const m of html.matchAll(/<article>([\s\S]*?)<\/article>/g)) {
    const a = m[1];
    const href = /href="(https:\/\/www\.wpb\.org\/Bids\/([^"]+))"/.exec(a);
    if (!href) continue;
    const title = decode(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(a)?.[1] ?? "");
    const reference = decode(/Reference number:(?:&nbsp;|\s)*<\/span>([\s\S]*?)<\/p>/.exec(a)?.[1] ?? "");
    const closing = decode(/Closing date\s*([\s\S]*?)<\/p>/.exec(a)?.[1] ?? "");
    const status = decode(/Status:(?:&nbsp;|\s)*<\/span>([\s\S]*?)<\/p>/.exec(a)?.[1] ?? "");
    const ps = [...a.matchAll(/<p\s*>([\s\S]*?)<\/p>/g)].map((x) => decode(x[1])).filter(Boolean);
    out.push({ slug: href[2], url: href[1], title, reference, closing, summary: ps[0] ?? "", status });
  }
  return out;
}

/** "December 15, 2026, 03:00 PM" → ISO in Eastern time, or null. PURE. */
export function wpbClosing(v: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s*(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(v.trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].toLowerCase());
  const h = +m[4];
  if (mon < 0 || h < 1 || h > 12) return null;
  return zonedIso("America/New_York", +m[3], mon + 1, +m[2], (h % 12) + (m[6].toUpperCase() === "P" ? 12 : 0), +m[5]);
}

export function mapWpbCards(cards: WpbCard[], now: number = Date.now()): FetchResult & { rows: RawBid[] } {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({ id, reason }); };
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.slug)) { skip(c.slug, "duplicate"); continue; }
    seen.add(c.slug);
    if (!/^open$/i.test(c.status) || /^CANCEL/i.test(c.slug) || /cancel/i.test(c.title)) { skip(c.slug, "not_open"); continue; }
    if (!c.title) { skip(c.slug, "missing_fields"); continue; }
    // Some cards stay "Open" for years with no closing date (2024-25 term contracts): never shown without a real deadline.
    if (!c.closing) { skip(c.slug, "no_closing_date"); continue; }
    const due = wpbClosing(c.closing);
    if (!due) { skip(c.slug, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(c.slug, "closed"); continue; }
    const ref = c.reference || null;
    rows.push({
      external_id: `flwpb-${c.slug}`,
      title: c.title,
      agency: AGENCY,
      location: "West Palm Beach, FL",
      description: `${AGENCY}${ref ? ` ${ref}` : ""}: ${c.title}. ${c.summary ? `${c.summary} ` : ""}Closes ${c.closing} Eastern. Documents are on DemandStar, linked from the city's bid page.`,
      category: mapCategory("", c.title, c.summary),
      due_date: due,
      estimated_value: "",
      source_url: c.url,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: ref,
      notice_type: ref ? (/^ITB|^IFB/i.test(ref) ? "ITB" : /^RFP/i.test(ref) ? "RFP" : /^RFQ|^RFQu/i.test(ref) ? "RFQ" : null) : null,
    });
  }
  return { rows, skipped, skippedRows };
}

export async function fetchWestPalmBeachBids(now: number = Date.now()): Promise<FetchResult> {
  let html: string;
  try {
    const res = await fetch(FL_WPB_LIST_URL, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new SourceUnreachableError(FL_WPB_SOURCE, [httpFailureDetail(res.status, FL_WPB_LIST_URL)]);
    html = await res.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(FL_WPB_SOURCE, [requestFailureDetail(e)]);
  }
  const cards = readWpbCards(html);
  if (!cards.length) throw new SourceUnreachableError(FL_WPB_SOURCE, ["No solicitation cards on the page (layout changed?)"]);
  return mapWpbCards(cards, now);
}
