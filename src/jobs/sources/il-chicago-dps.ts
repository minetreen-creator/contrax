/**
 * City of Chicago Department of Procurement Services weekly Bid Opportunity
 * List — `il_chicago_dps` (owner 2026-10-09: "what do we have for Chicago?" —
 * Contrax held only the City's AWARD feed, no open City bids).
 *
 * WHY: City of Chicago solicitations are answered in the City's eProcurement
 * (Oracle iSupplier) system, which needs a vendor login to browse; Contrax does
 * not read behind a login. DPS also publishes every open solicitation each week
 * as a public PDF, the "Bid Opportunity List", linked from its Current Bid
 * Opportunities page. That list is the source.
 *
 * SOURCE (verified live 2026-10-09, no login):
 *   1. https://www.chicago.gov/city/en/depts/dps/provdrs/contract/svcs/current_bid_opportunities.html
 *      links the newest list as …/WeeklyBidOpportunities/<YYYY>WeeklyBidOpportunities/<MMDDYY>.pdf
 *   2. That PDF: one block per solicitation, read in text order as
 *        11/06/2026
 *        3:00 p.m. 1356791                     ← bid opening date/time, spec #
 *        Electronic Bid                        ← solicitation status
 *        RFQ for New Master Task Order …       ← project name (wraps)
 *        CDOT Architecture &                   ← user department + category
 *        Engineering
 *        …description, ad date, pre-bid details, procurement specialist…
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = the project name as printed, without the trailing
 *                     "(eProcurement)" marker.
 *   - `agency`      = "City of Chicago — <department>" (DPS's own department
 *                     codes spelled out; an unknown code is kept as printed).
 *   - `location`    = "Chicago, IL".
 *   - `due_date`    = the bid opening date and time, Central time.
 *   - `category`    = "Construction" for DPS's Construction category; "Other"
 *                     for Architecture & Engineering (design contracts — the
 *                     text classifier would read "Transportation Planning
 *                     Studies" as moving work); else the shared text classifier.
 *   - `source_url`  = the DPS Current Bid Opportunities page (documents and
 *                     responses are on eProcurement, which needs registration).
 *   - `solicitation_number` = the spec number; `notice_type` = DPS's category.
 *   - `estimated_value` = "Not specified"; NAICS / PSC / set-aside stay NULL.
 * Solicitations whose opening has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = chicagodps-<spec #>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const CHICAGO_DPS_SOURCE = "il_chicago_dps";
export const CHICAGO_DPS_ORIGIN = "https://www.chicago.gov";
export const CHICAGO_DPS_PAGE_URL = `${CHICAGO_DPS_ORIGIN}/city/en/depts/dps/provdrs/contract/svcs/current_bid_opportunities.html`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** DPS's user-department codes as printed on the list. */
const DEPARTMENTS: Record<string, string> = {
  CDOT: "Department of Transportation",
  DWM: "Department of Water Management",
  DPS: "Department of Procurement Services",
  OPSA: "Office of Public Safety Administration",
  "2FM": "Department of Fleet and Facility Management",
  CDA: "Department of Aviation",
  OBM: "Office of Budget and Management",
  CPD: "Police Department",
  CFD: "Fire Department",
  CDPH: "Department of Public Health",
  DSS: "Department of Streets and Sanitation",
  DOH: "Department of Housing",
  DPD: "Department of Planning and Development",
  DOIT: "Department of Technology and Innovation",
  DCASE: "Department of Cultural Affairs and Special Events",
  OEMC: "Office of Emergency Management and Communications",
  BACP: "Department of Business Affairs and Consumer Protection",
  CPL: "Chicago Public Library",
};

/** DPS's categories: the word(s) that follow the department code. */
const CATEGORY_RE =
  /^([A-Z0-9]{2,6}) (Architecture & Engineering|Architecture &|Commodity|Commodities|Construction|Professional Services|Small Order|Work Services|Vehicles|Revenue|Concessions?)(?=\s|$)/;

export interface ChicagoDpsEntry {
  spec: string;
  opensAt: string; // ISO
  status: string; // "Electronic Bid"
  title: string;
  deptCode: string;
  category: string; // "Construction", "Work Services", …
}

export interface ChicagoDpsParseResult {
  rows: RawBid[];
  entries: ChicagoDpsEntry[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** US Central offset (hours) for a calendar date: CDT 2nd Sun Mar – 1st Sun Nov. */
function centralOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -5 : -6;
}

/** ("11/06/2026", "3:00 p.m.") → ISO instant in Central time; invalid → null. */
export function chicagoOpeningToIso(date: string, time: string): string | null {
  const d = date.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const t = time.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!d || !t) return null;
  const [month, day, year] = [Number(d[1]), Number(d[2]), Number(d[3])];
  let hour = Number(t[1]);
  const minute = Number(t[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (t[3]!.toLowerCase() === "p" && hour !== 12) hour += 12;
  if (t[3]!.toLowerCase() === "a" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - centralOffset(year, month, day) * 3_600_000).toISOString();
}

/** The newest weekly list PDF linked from the Current Bid Opportunities page, absolute; null if none. */
export function findBidListPdf(html: string): string | null {
  const links = [...html.matchAll(/href="([^"]*WeeklyBidOpportunities\/(\d{4})WeeklyBidOpportunities\/(\d{2})(\d{2})(\d{2})\.pdf)"/gi)];
  if (links.length === 0) return null;
  // Newest by the date in the file name (MMDDYY), should the page ever link more than one.
  const key = (m: RegExpMatchArray) => `20${m[5]}${m[3]}${m[4]}`;
  const best = links.sort((a, b) => key(b).localeCompare(key(a)))[0]!;
  return new URL(best[1]!.replace(/&amp;/g, "&"), CHICAGO_DPS_PAGE_URL).toString();
}

/** The solicitation blocks in the list's extracted text. */
export function readBidList(text: string): ChicagoDpsEntry[] {
  const out: ChicagoDpsEntry[] = [];
  const re =
    /(\d{2}\/\d{2}\/\d{4})\n(\d{1,2}:\d{2} [ap]\.m\.) (\d{5,8}[A-Z]?)\n([\s\S]*?)(?=\n\d{2}\/\d{2}\/\d{4}\n\d{1,2}:\d{2} [ap]\.m\. \d{5,8}|\nNOTICE: DPS|\n=====PAGE=====|$)/g;
  for (const m of text.matchAll(re)) {
    const lines = m[4]!.split("\n").map((l) => l.trim()).filter(Boolean);
    const catAt = lines.findIndex((l, i) => i > 0 && CATEGORY_RE.test(l));
    if (catAt < 1) continue;
    const cat = lines[catAt]!.match(CATEGORY_RE)!;
    let category = cat[2]!;
    if (category === "Architecture &") category = "Architecture & Engineering";
    const title = lines
      .slice(1, catAt)
      .join(" ")
      .replace(/\s*\(eProcurement\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const opensAt = chicagoOpeningToIso(m[1]!, m[2]!);
    if (!title || !opensAt) continue;
    out.push({ spec: m[3]!, opensAt, status: lines[0]!, title, deptCode: cat[1]!, category });
  }
  return out;
}

export function chicagoAgency(code: string): string {
  const name = DEPARTMENTS[code];
  return name ? `City of Chicago — ${name}` : `City of Chicago (${code})`;
}

function recordSkip(r: ChicagoDpsParseResult, id: string, reason: string) {
  r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
  r.skippedRows.push({ id, reason });
}

/** PURE parse of the list's extracted text — no network, no DB; `now` is injected. */
export function parseChicagoBidList(text: string, now: number = Date.now()): ChicagoDpsParseResult {
  const result: ChicagoDpsParseResult = { rows: [], entries: readBidList(text), skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const e of result.entries) {
    const rowId = `chicagodps-${e.spec}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    if (Date.parse(e.opensAt) <= now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = chicagoAgency(e.deptCode);
    const electronic = /electronic/i.test(e.status);
    const description = [
      `City of Chicago ${e.category} solicitation, specification ${e.spec}, for the ${agency.replace(/^City of Chicago — /, "")}.`,
      electronic
        ? "Responses are submitted electronically through the City's eProcurement system (vendor registration required)."
        : `Status: ${e.status}.`,
      "Listed on the Department of Procurement Services' weekly Bid Opportunity List (see source link).",
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.title,
      agency,
      description,
      location: "Chicago, IL",
      category:
        e.category === "Construction"
          ? "Construction"
          : e.category === "Architecture & Engineering"
            ? "Other"
            : mapCategory("", e.title, description),
      due_date: e.opensAt,
      estimated_value: "Not specified",
      source_url: CHICAGO_DPS_PAGE_URL,
      set_aside: null,
      notice_type: e.category,
      solicitation_number: e.spec,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** PDF bytes → text, pages joined with a marker line (the same shape readBidList expects). */
export async function bidListPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).join("\n=====PAGE=====\n");
}

function fail(detail: string): never {
  console.error(`  ${CHICAGO_DPS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(CHICAGO_DPS_SOURCE, [detail]);
}

async function get(url: string, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    return resp;
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the newest weekly Bid Opportunity List and return one bid per open solicitation. */
export async function fetchIlChicagoDpsBids(now: number = Date.now()): Promise<FetchResult> {
  const page = await (await get(CHICAGO_DPS_PAGE_URL, "text/html,*/*")).text();
  const pdfUrl = findBidListPdf(page);
  if (!pdfUrl) fail(`page shape changed: no weekly Bid Opportunity List link (${page.length} bytes)`);
  const bytes = new Uint8Array(await (await get(pdfUrl, "application/pdf,*/*")).arrayBuffer());
  let text: string;
  try {
    text = await bidListPdfText(bytes);
  } catch (e) {
    fail(`could not read the PDF ${pdfUrl}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const r = parseChicagoBidList(text, now);
  if (r.entries.length === 0) fail(`page shape changed: no solicitations read from ${pdfUrl}`);
  console.log(
    `  ${CHICAGO_DPS_SOURCE}: ${r.rows.length} solicitations accepted from ${pdfUrl} (read ${r.entries.length}; skips: ${
      Object.entries(r.skipped)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows: r.rows, skipped: r.skipped, skippedRows: r.skippedRows };
}
