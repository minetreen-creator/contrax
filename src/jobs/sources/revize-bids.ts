/**
 * Revize "Bid Postings" module (owner 2026-11-07: "Yes do Pennsylvania, Virginia and Ohio"). Many county
 * and town sites built on Revize publish the same public table (class "rpfbids"): each row links a
 * bid_detail page and gives the bid number, Opening Date/Time and Closing Date/Time
 * ("November 20, 2026 2:00 PM"). One reader serves every such board; each board names its time zone.
 *
 * DATA HONESTY: a closing date with no time is read as 11:59 PM local (the date-only convention) and the
 * description says so. Closed rows (the module keeps old ones) are skipped. No detail pages are read.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

type Zone = "America/New_York" | "America/Chicago" | "America/Denver" | "America/Los_Angeles";
export interface RevizeBoard {
  source: string;
  url: string;
  agency: string;
  location: string;
  idPrefix: string;
  zone: Zone;
}

export const REVIZE_BOARDS: readonly RevizeBoard[] = [
  { source: "oh_butler_county", url: "https://www.bcohio.gov/board_of_commissioners/services/bid_postings.php", agency: "Butler County, Ohio", location: "Butler County, OH", idPrefix: "butlercountyoh", zone: "America/New_York" },
  { source: "pa_lackawanna_county", url: "https://lackawannacounty.org/government/departments/rfp_rfq.php", agency: "Lackawanna County, Pennsylvania", location: "Lackawanna County, PA", idPrefix: "lackawannacounty", zone: "America/New_York" },
  { source: "tn_smyrna", url: "https://townofsmyrna.org/departments/finance/bid_opportunities.php", agency: "Town of Smyrna", location: "Smyrna, TN", idPrefix: "smyrnatn", zone: "America/Chicago" },
];

const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const OFFSETS: Record<Zone, number[]> = { "America/New_York": [4, 5], "America/Chicago": [5, 6], "America/Denver": [6, 7], "America/Los_Angeles": [7, 8] };

/** Wall time in `zone` → ISO UTC, DST-aware; null when impossible or ambiguous. PURE. */
export function zonedIso(zone: Zone, y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const target = { year: y, month: mo, day: d, hour: h, minute: mi };
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const hits = OFFSETS[zone].map((o) => new Date(wall + o * 3_600_000)).filter((t) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Object.entries(target).every(([k, v]) => p[k] === v);
  });
  return hits.length === 1 ? hits[0].toISOString() : null;
}

const text = (s: string) =>
  s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#8211;|&ndash;/g, "–").replace(/&#8217;|&rsquo;|&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** "November 20, 2026 2:00 PM" (time optional) → { iso, timed }. PURE. */
export function revizeClosing(v: string, zone: Zone): { iso: string; timed: boolean } | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP])\.?M)?/i.exec(v);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  if (!mo) return null;
  const timed = !!m[4];
  const h = timed ? (+m[4] % 12) + (/^p/i.test(m[6]) ? 12 : 0) : 23;
  const iso = zonedIso(zone, +m[3], mo, +m[2], h, timed ? +m[5] : 59);
  return iso ? { iso, timed } : null;
}

export interface RevizeParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseRevizeBids(board: RevizeBoard, html: string, now: number = Date.now()): RevizeParseResult {
  if (!/rfpbid/.test(html)) throw new SourceUnreachableError(board.source, ["Revize bid postings table missing (page changed)"]);
  const r: RevizeParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const skip = (id: string, reason: string) => {
    r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
    r.skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  const row = /<a href="([^"]*bid_detail[^"]*)">([\s\S]*?)<\/a>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  for (const m of html.matchAll(row)) {
    const href = m[1];
    const title = text(m[2]);
    const number = text(m[3]).replace(/^(RFP\/Q|RFP|RFQ|Bid|ITB)\s*(No\.?|#)\s*/i, "").trim();
    const id = /_R(\d+)\.php/.exec(href)?.[1] ?? href;
    if (!title) { skip(id, "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const closingText = text(m[5]);
    const due = revizeClosing(closingText, board.zone);
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due.iso) <= now) { skip(id, "closed"); continue; }
    r.rows.push({
      external_id: `${board.idPrefix}-${id}`,
      title,
      agency: board.agency,
      location: board.location,
      description: `${board.agency} bid posting${number ? ` ${number}` : ""}: ${title}. Closes ${closingText}${due.timed ? "" : " (no time stated; check the bid documents)"}.`,
      category: mapCategory("", title, ""),
      due_date: due.iso,
      estimated_value: "",
      source_url: new URL(href, board.url).href,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number || null,
      notice_type: /\bRFP\b/i.test(text(m[3])) ? "RFP" : /\bRFQ\b/i.test(text(m[3])) ? "RFQ" : null,
    });
  }
  return r;
}

export const revizeDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

export async function fetchRevizeBoard(board: RevizeBoard, now: number = Date.now()): Promise<FetchResult> {
  try {
    const res = await revizeDeps.fetch(board.url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRevizeBids(board, await res.text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(board.source, [e instanceof Error ? e.message : String(e)]);
  }
}

export const REVIZE_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = REVIZE_BOARDS.map((b) => ({
  name: b.source,
  fetchFn: () => fetchRevizeBoard(b),
}));
