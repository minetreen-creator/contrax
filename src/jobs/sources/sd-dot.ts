/**
 * South Dakota Department of Transportation highway bid lettings — `sd_dot`,
 * the SDDOT projects currently advertised for bidding.
 *
 * WHY: South Dakota had NO state or local bid source at all (2026-10-12, owner
 * directive "not grants, state bids"). The state's central procurement portal is
 * the BHRA ServiceNow service portal (www.sd.gov/bhra, reached from boa.sd.gov):
 * it is a JavaScript SPA whose listings are Knowledge Base articles, it publishes
 * no dated solicitation records through any endpoint Contrax may read, and its
 * Bid/contract pages are article links, not a solicitation API — so it is OUT
 * (see shared/sd-bids-discovery-2026-10-11/EVIDENCE.md). SDDOT's own letting site
 * is public, server-rendered, login-free and date-bearing, so it is the SD source.
 *
 * SOURCE (verified live 2026-10-12, no login, no CAPTCHA, no JavaScript): the
 * SDDOT Bid Letting application
 *   https://apps.sd.gov/HC65BidLetting/ebslettings1.aspx   (SDEBS Lettings)
 * is an ASP.NET page. Under "Lettings Currently Advertised for Bids" it links one
 * `ebslettingsdetail1.aspx?args=<token>` page per advertised letting. That page
 * is server-rendered and heads its table with the letting date
 * (`<span id="ctl00_cpSubContent_lblLettingDate">10/21/2026 Letting</span>`) and
 * one row per contract under "Projects Available for Bidding", each row reading
 *   `NH-EM-TA 0100(107)411 - Grading, PCC, C&G, Storm, Light - PCN - 01VA`
 * plus the SDDOT area, its addendum and question counts, its prequalification
 * work types and its plan sheets. Captured 2026-10-12: two advertised lettings
 * (10/21/2026, 11/04/2026) holding 16 contracts. "Post bid opening" and
 * "Completed" lettings on the same page are NOT read (they are history).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = "<work description exactly as SDDOT wrote it> — South Dakota DOT
 *     contract <contract number>, <area>".
 *   - `agency` = "South Dakota Department of Transportation".
 *   - `category` = "Construction": every contract on this letting is a highway
 *     construction contract (the page is the "Advertisement of Highway Bid
 *     Letting"); the text classifier would read e.g. "Interchange Lighting" as
 *     electrical work.
 *   - `location` = "South Dakota". SDDOT prints a *maintenance area* ("Sioux Falls
 *     Area"), not the place of work, so the area name goes in the title and the
 *     description and is never promoted to a city.
 *   - `due_date` = the letting date. The page prints no time, so it is stored at
 *     11:59 PM Central (the convention for date-only deadlines), and the
 *     description says so.
 *   - `estimated_value` = "Not specified" (the letting page publishes none).
 *   - `source_url` = the letting page that lists this contract. SDDOT has no
 *     per-contract page that opens without an SDEBS session (the plan-holder /
 *     Q&A pages 302 on a first, cookie-less request), so the row cites the
 *     letting page it was read from.
 *   - `solicitation_number` = the contract number; `notice_type` =
 *     "Highway construction letting"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: letting date has passed (`closed`), no readable letting date
 * (`bad_date`), the same contract twice in one letting (`duplicate`), a row with
 * no contract text (`missing_title`).
 *
 * IDENTITY: `external_id = sddot-<YYYY-MM-DD>-<contract number>` — SDDOT's own
 * contract number, scoped by the letting it was advertised in, so a contract
 * re-advertised at a later letting is a NEW row (as SDDOT presents it) while a
 * re-read of the same letting can never write a second row.
 */
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const SD_DOT_SOURCE = "sd_dot";
export const SD_DOT_BASE = "https://apps.sd.gov/HC65BidLetting";
/** The SDEBS Lettings index: what is advertised right now. */
export const SD_DOT_LETTINGS_URL = `${SD_DOT_BASE}/ebslettings1.aspx`;
const SD_DOT_AGENCY = "South Dakota Department of Transportation";
const SD_DOT_LETTING_DETAIL = `${SD_DOT_BASE}/ebslettingsdetail1.aspx`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** One letting advertised on the index page. */
export interface SdDotLettingLink {
  /** The page's own opaque `args` token (`ebslettingsdetail1.aspx?args=<args>`). */
  args: string;
  /** The index's own date label, e.g. "October 21, 2026" (never converted here). */
  dateText: string;
}

/** One contract row of a letting detail page, as the page prints it. */
export interface SdDotContract {
  /** "Item #" cell, e.g. "* 1". */
  item: string;
  /** Contract Information cell, e.g. "NH-EM-TA 0100(107)411 - Grading, PCC, C&G, Storm, Light - PCN - 01VA". */
  contractInfo: string;
  /** e.g. "Sioux Falls     Area". */
  area: string;
  /** e.g. "0 - addendums for this contract". */
  addendums: string;
  /** e.g. "3 - questions for this contract". */
  questions: string;
  /** Prequalification work types, e.g. "Work Type 1 or Work Type 3". */
  workTypes: string;
}

/** A letting page: its date (MM/DD/YYYY) and the contracts it advertises. */
export interface SdDotLetting {
  args: string;
  /** MM/DD/YYYY as printed by `lblLettingDate`. */
  lettingDate: string;
  contracts: SdDotContract[];
}

export interface SdDotParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** The public letting page a row points at. */
export function sdDotLettingUrl(args: string): string {
  return `${SD_DOT_LETTING_DETAIL}?args=${encodeURIComponent(args)}`;
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The lettings advertised RIGHT NOW on the index page: only the rows of the
 * `repCurLettings` repeater ("Lettings Currently Advertised for Bids"). The
 * "Tentative Future Bid Opening Dates" list is deliberately NOT read — those
 * dates carry no projects, so a row from them would be a manufactured deadline.
 */
export function parseSdDotIndex(html: string): SdDotLettingLink[] {
  const out: SdDotLettingLink[] = [];
  const seen = new Set<string>();
  const re =
    /id="ctl00_cpSubContent_repCurLettings_ctl\d+_LettingId"[^>]*href="ebslettingsdetail1\.aspx\?args=([A-F0-9]+)"[^>]*>([^<]*)</g;
  for (const m of html.matchAll(re)) {
    const args = m[1];
    if (seen.has(args)) continue;
    seen.add(args);
    out.push({ args, dateText: decode(m[2]) });
  }
  return out;
}

/**
 * True when the index page still has the shape the parser needs. A missing
 * anchor is a shape change (fetch FAILS); zero currently-advertised lettings is
 * honest-empty and still has the shape.
 */
export function sdDotIndexShapeOk(html: string): boolean {
  return /Lettings Currently Advertised for Bids/.test(html) && /repCurLettings_ctl\d+_LettingId/.test(html);
}

/** The letting date the detail page prints (`10/21/2026 Letting`), or null. */
export function sdDotLettingDate(html: string): string | null {
  const m = /id="ctl00_cpSubContent_lblLettingDate"[^>]*>\s*(\d{2}\/\d{2}\/\d{4})/.exec(html);
  return m ? m[1] : null;
}

/** True when the detail page still carries the contract table (or says there is none). */
export function sdDotDetailShapeOk(html: string): boolean {
  return /id="ctl00_cpSubContent_itemtable"/.test(html) && /Projects Available for Bidding/.test(html);
}

/** The contract rows of a letting detail page, in the page's own order. */
export function parseSdDotContracts(html: string): SdDotContract[] {
  const at = html.indexOf('id="ctl00_cpSubContent_itemtable"');
  if (at < 0) return [];
  const seg = html.slice(at);
  const out: SdDotContract[] = [];
  for (const m of seg.matchAll(/<tr align="left"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 2) continue;
    const spans = [...cells[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((s) => decode(s[1]));
    const contractInfo = spans[0] ?? "";
    if (!contractInfo) continue;
    const wt = /<a[^>]*href="[^"]*WorkTypes\.pdf"[^>]*>([\s\S]*?)<\/a>/.exec(cells[1]);
    out.push({
      item: decode(cells[0]),
      contractInfo,
      area: spans[1] ?? "",
      addendums: spans[2] ?? "",
      questions: spans[3] ?? "",
      workTypes: wt ? decode(wt[1]) : "",
    });
  }
  return out;
}

/** A detail page parsed whole (null when the page has no readable letting date). */
export function parseSdDotDetail(args: string, html: string): SdDotLetting | null {
  const lettingDate = sdDotLettingDate(html);
  if (!lettingDate) return null;
  return { args, lettingDate, contracts: parseSdDotContracts(html) };
}

/** "10/21/2026" → 11:59 PM Central that day (CDT/CST by US rules), or NaN. */
export function sdDotDueMs(lettingDate: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(lettingDate.trim());
  if (!m) return NaN;
  const [y, mo, d] = [+m[3], +m[1], +m[2]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  // US DST: second Sunday of March through first Sunday of November (Central time).
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const dstStart = Date.UTC(y, 2, nthSunday(3, 2));
  const dstEnd = Date.UTC(y, 10, nthSunday(11, 1));
  const day = Date.UTC(y, mo - 1, d);
  const offsetHours = day >= dstStart && day < dstEnd ? 5 : 6;
  return Date.UTC(y, mo - 1, d, 23 + offsetHours, 59);
}

/** "10/21/2026" → "2026-10-21" (the letting date as SDDOT prints it). */
export function sdDotDateKey(lettingDate: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(lettingDate.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** The contract number is everything before the first " - " in the cell. */
export function sdDotContractNumber(contractInfo: string): string {
  const at = contractInfo.indexOf(" - ");
  return (at > 0 ? contractInfo.slice(0, at) : contractInfo).replace(/\s+/g, " ").trim();
}

/** The work description is what SDDOT wrote between the number and its PCN tail. */
export function sdDotWorkDescription(contractInfo: string): string {
  const parts = contractInfo.split(" - ");
  if (parts.length > 2 && parts[parts.length - 2] === "PCN") return parts.slice(1, parts.length - 2).join(" - ").trim();
  return parts.slice(1).join(" - ").trim();
}

/** The PCN SDDOT prints at the end of the Contract Information cell, or null. */
export function sdDotPcn(contractInfo: string): string | null {
  const m = / - PCN - ([A-Z0-9]+)\s*$/.exec(contractInfo);
  return m ? m[1] : null;
}

/** "Sioux Falls     Area" → "Sioux Falls"; anything else is returned as printed. */
export function sdDotArea(area: string): string {
  return area.replace(/\s+Area\s*$/i, "").replace(/\s+/g, " ").trim();
}

function recordSkip(result: SdDotParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseSdDot(lettings: readonly SdDotLetting[], now: number = Date.now()): SdDotParseResult {
  const result: SdDotParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const letting of lettings) {
    const dateKey = sdDotDateKey(letting.lettingDate);
    const dueMs = sdDotDueMs(letting.lettingDate);
    for (const [i, c] of letting.contracts.entries()) {
      const number = sdDotContractNumber(c.contractInfo);
      const rowId = dateKey && number ? `sddot-${dateKey}-${number.replace(/\s+/g, "-")}` : `sddot-row-${i}`;
      if (!number) {
        recordSkip(result, rowId, "missing_title");
        continue;
      }
      if (!dateKey || !Number.isFinite(dueMs)) {
        recordSkip(result, rowId, "bad_date");
        continue;
      }
      if (seen.has(rowId)) {
        recordSkip(result, rowId, "duplicate");
        continue;
      }
      seen.add(rowId);
      if (dueMs < now) {
        recordSkip(result, rowId, "closed");
        continue;
      }
      const work = sdDotWorkDescription(c.contractInfo) || number;
      const area = sdDotArea(c.area);
      const pcn = sdDotPcn(c.contractInfo);
      const addendums = /^(\d+) - addendums/.exec(c.addendums)?.[1] ?? "";
      const questions = /^(\d+) - questions/.exec(c.questions)?.[1] ?? "";
      const title = `${work} — South Dakota DOT contract ${number}${area ? `, ${area} Area` : ""}`;
      const description = [
        `SDDOT highway construction letting ${letting.lettingDate}${area ? ` (${area} Area)` : ""}, item ${c.item.replace(/^\*\s*/, "").trim()}: contract ${number}${pcn ? `, PCN ${pcn}` : ""}.`,
        /^\*/.test(c.item.trim()) ? "Marked * on SDDOT's page: combo bid." : "",
        c.workTypes ? `Prequalification: ${c.workTypes}.` : "",
        addendums ? `${addendums} addendum(s) issued for this contract.` : "",
        questions ? `${questions} question(s) submitted for this contract.` : "",
        "SDDOT lists only the letting DATE (no time); Contrax stores the deadline at 11:59 PM Central on that date.",
        "Plans, special provisions and bids are on SDDOT's SDEBS electronic bidding system (see the source link).",
      ]
        .filter(Boolean)
        .join(" ");
      result.rows.push({
        external_id: rowId,
        title,
        agency: SD_DOT_AGENCY,
        description,
        location: "South Dakota",
        category: "Construction",
        due_date: new Date(dueMs).toISOString(),
        estimated_value: "Not specified",
        source_url: sdDotLettingUrl(letting.args),
        set_aside: null,
        notice_type: "Highway construction letting",
        solicitation_number: number || null,
        naics_code: null,
        psc: null,
      });
    }
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${SD_DOT_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(SD_DOT_SOURCE, [detail]);
}

async function getHtml(url: string, signal: AbortSignal): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html", Referer: SD_DOT_LETTINGS_URL },
    signal,
  });
  if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
  return await resp.text();
}

/**
 * Read SDDOT's advertised lettings and return one bid per contract. Zero
 * advertised lettings is honest-empty (0 rows), never a failure; a page that
 * lost its shape FAILS instead of reading as empty.
 */
export async function fetchSdDotBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const lettings: SdDotLetting[] = [];
  let links: SdDotLettingLink[] = [];
  let listed = 0;
  try {
    const index = await getHtml(SD_DOT_LETTINGS_URL, controller.signal);
    if (!sdDotIndexShapeOk(index)) {
      fail("page shape changed: the SDEBS Lettings index no longer lists advertised lettings");
    }
    links = parseSdDotIndex(index);
    for (const link of links) {
      const html = await getHtml(sdDotLettingUrl(link.args), controller.signal);
      if (!sdDotDetailShapeOk(html)) fail(`page shape changed: letting ${link.dateText} has no projects table`);
      const detail = parseSdDotDetail(link.args, html);
      if (!detail) fail(`page shape changed: letting ${link.dateText} prints no letting date`);
      listed += detail.contracts.length;
      lettings.push(detail);
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const { rows, skipped, skippedRows } = parseSdDot(lettings, now);
  console.log(
    `  ${SD_DOT_SOURCE}: ${rows.length} contracts accepted (advertised lettings: ${links.length}; listed: ${listed}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
