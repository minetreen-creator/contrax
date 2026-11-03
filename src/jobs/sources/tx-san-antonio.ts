/**
 * City of San Antonio — `tx_san_antonio`, the city's own public "Bidding &
 * Contract Opportunities" list (owner 2026-11-03: "we need more construction
 * bids in TX"; CivCast wants $1,000/month for automated access, so we read the
 * city's own list instead).
 *
 * SOURCE (captured 2026-11-03, no login, no CAPTCHA): an ASP.NET grid at
 *   https://webapp1.sanantonio.gov/BidContractOpps/Default.aspx
 * Page 1 is a GET; later pages are the grid's own "Page$N" postback (the same
 * form a person's click on "2" submits). The host has no robots.txt. Each row
 * links to the city's public detail page (Content.aspx?id=N), which is never
 * fetched.
 *
 * WHAT A ROW BECOMES (data honesty):
 *   - `title` = the bid name without its leading solicitation number, which goes
 *     in `solicitation_number` ("23-03923 Vance Jackson …" → "Vance Jackson …").
 *   - `due_date` = the deadline date (the "Extended to" date when the city
 *     extended it) at 11:59 PM San Antonio time. The list gives a date only;
 *     the description says so and points to the solicitation for the hour.
 *   - `agency` = "City of San Antonio"; the department is in the description.
 * Skipped: deadline passed (`closed`), unreadable deadline (`bad_date`), no id
 * or name (`missing_fields`), and Requests for Information / Applications,
 * which are not bids (`not_a_bid`).
 *
 * IDENTITY: `external_id = sanantonio-<detail page id>`.
 */
import { isConstructionNonWork, isConstructionTitle, mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const SAN_ANTONIO_SOURCE = "tx_san_antonio";
export const SAN_ANTONIO_LIST_URL = "https://webapp1.sanantonio.gov/BidContractOpps/Default.aspx";
const ORIGIN = "https://webapp1.sanantonio.gov";
const GRID = "ctl00$ContentPlaceHolder1$gvBidContractOpps";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
/** The list held 2 pages on 2026-11-03; a much longer list means the page changed. */
const MAX_PAGES = 8;

export interface SanAntonioRow {
  id: string;
  name: string;
  type: string;
  department: string;
  released: string;
  deadline: string;
}

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

/** The grid's rows (header row skipped). */
export function readSanAntonioRows(html: string): SanAntonioRow[] {
  const rows: SanAntonioRow[] = [];
  for (const tr of html.matchAll(/<tr>\s*<td><a href="Content\.aspx\?id=(\d+)[^"]*">([\s\S]*?)<\/a><\/td>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[3].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 5) continue;
    rows.push({
      id: tr[1],
      name: decode(tr[2]),
      type: decode(cells[0]),
      department: decode(cells[1]),
      released: decode(cells[2]),
      deadline: decode(cells[4]),
    });
  }
  return rows;
}

/** Page numbers the pager offers ("Page$2" …). */
export function sanAntonioPages(html: string): number[] {
  const pages = new Set<number>();
  for (const m of html.matchAll(/__doPostBack\(&#39;ctl00\$ContentPlaceHolder1\$gvBidContractOpps&#39;,&#39;Page\$(\d+)&#39;\)/g)) {
    pages.add(Number(m[1]));
  }
  return [...pages].sort((a, b) => a - b);
}

/** The deadline that applies: the "Extended to" date when present, else the first date. */
export function sanAntonioDeadline(cell: string): string | null {
  const dates = [...cell.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
  if (!dates.length) return null;
  const ext = /Extended to\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(cell);
  const [, mm, dd, yyyy] = ext ?? dates[0];
  const month = Number(mm) - 1, day = Number(dd), year = Number(yyyy);
  const local = Date.UTC(year, month, day, 23, 59);
  const check = new Date(local);
  if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  // 11:59 PM in San Antonio (America/Chicago, DST aware).
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const p = Object.fromEntries(fmt.formatToParts(new Date(local)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(local + (local - wall)).toISOString();
}

/** "23-03923 Vance Jackson …" → number + name; "RFQ 2026-101 On-Call …" keeps the kind with the number. */
export function splitSanAntonioName(name: string): { number: string | null; title: string } {
  const m = /^((?:RFQ|RFP|RFCSP|RFO|IFB|RFI|RFA|CMAR|DB)\s+)?(\d[\w-]*)\s+(.+)$/i.exec(name.trim());
  if (!m) return { number: null, title: name.trim() };
  return { number: `${m[1] ?? ""}${m[2]}`.trim(), title: m[3].trim() };
}

const NOTICE_TYPE: Record<string, string> = {
  "invitation for bids": "ITB",
  "request for competitive sealed proposals": "RFCSP",
  "request for proposals": "RFP",
  "request for qualifications": "RFQ",
  "request for offer": "RFO",
  "construction manager at risk": "CMAR",
  "design build": "Design-Build",
  other: "Solicitation",
};
const NOT_A_BID = /^request for (information|applications)$/i;

/** The Capital Delivery Department delivers the city's capital construction
 *  projects, so its bids and sealed proposals are Construction on the map even
 *  when named only by the road ("Vance Jackson (Loop 410 to Adrian Drive)").
 *  Its RFQs (engineering services) keep the title's own classification. */
const CAPITAL_DELIVERY = /^capital delivery department$/i;
const CONSTRUCTION_TYPES = /^(invitation for bids|request for competitive sealed proposals|construction manager at risk|design build)$/i;
export function sanAntonioCategory(title: string, r: Pick<SanAntonioRow, "department" | "type">): string {
  const own = mapCategory("", title, "");
  if (own !== "Other") return own;
  if (CAPITAL_DELIVERY.test(r.department) && CONSTRUCTION_TYPES.test(r.type)) return "Construction";
  if (isConstructionTitle(title) && !isConstructionNonWork(title)) return "Construction";
  return own;
}

export interface SanAntonioParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseSanAntonio(list: SanAntonioRow[], now: number = Date.now()): SanAntonioParseResult {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const r of list) {
    if (!r.id || !r.name) { skip(r.id || "unknown", "missing_fields"); continue; }
    if (seen.has(r.id)) { skip(r.id, "duplicate"); continue; }
    seen.add(r.id);
    if (NOT_A_BID.test(r.type)) { skip(r.id, "not_a_bid"); continue; }
    const due = sanAntonioDeadline(r.deadline);
    if (!due) { skip(r.id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(r.id, "closed"); continue; }
    const { number, title } = splitSanAntonioName(r.name);
    const dept = r.department ? ` (${r.department})` : "";
    rows.push({
      external_id: `sanantonio-${r.id}`,
      title,
      agency: "City of San Antonio",
      location: "San Antonio, TX",
      description: `City of San Antonio ${r.type}${dept}: ${title}.${number ? ` Solicitation ${number}.` : ""} Released ${r.released}. The city's list gives the deadline date only (${r.deadline}); the time and submission instructions are in the solicitation.`,
      category: sanAntonioCategory(title, r),
      due_date: due,
      estimated_value: "",
      source_url: `${ORIGIN}/BidContractOpps/Content.aspx?id=${r.id}&page=Default`,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: NOTICE_TYPE[r.type.toLowerCase()] ?? "Solicitation",
    });
  }
  return { rows, skipped, skippedRows };
}

const hidden = (html: string, name: string) =>
  (new RegExp(`id="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "").replace(/&#43;/g, "+").replace(/&#47;/g, "/").replace(/&amp;/g, "&");

export const sanAntonioDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  pause: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

async function page(init: RequestInit): Promise<string> {
  const r = await sanAntonioDeps.fetch(SAN_ANTONIO_LIST_URL, {
    ...init,
    headers: { "user-agent": UA, accept: "text/html", ...(init.headers ?? {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  if (!html.includes("gvBidContractOpps")) throw new Error("bid list shape changed");
  return html;
}

export async function fetchTxSanAntonioBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    let html = await page({ method: "GET" });
    const all = readSanAntonioRows(html);
    const pages = sanAntonioPages(html);
    if (pages.length > MAX_PAGES) throw new Error(`${pages.length} pages; refusing partial coverage`);
    for (const n of pages.filter((p) => p > 1)) {
      await sanAntonioDeps.pause(1500);
      const body = new URLSearchParams({
        __EVENTTARGET: GRID,
        __EVENTARGUMENT: `Page$${n}`,
        __VIEWSTATE: hidden(html, "__VIEWSTATE"),
        __VIEWSTATEGENERATOR: hidden(html, "__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: hidden(html, "__EVENTVALIDATION"),
      });
      html = await page({ method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
      all.push(...readSanAntonioRows(html));
    }
    if (all.length === 0) throw new Error("no rows on the bid list");
    return parseSanAntonio(all, now);
  } catch (e) {
    throw new SourceUnreachableError(SAN_ANTONIO_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
