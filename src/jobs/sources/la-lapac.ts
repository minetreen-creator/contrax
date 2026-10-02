/**
 * Louisiana Procurement and Contract Network (LaPAC) — `la_lapac`, the State
 * of Louisiana's public bid board (wwwcfprd.doa.louisiana.gov/osp/lapac, run
 * by the Office of State Procurement).
 *
 * WHY: Contrax had no state Louisiana feed. LaPAC carries the Office of State
 * Procurement's statewide bids, agency bids (DOTD, Education, LDH, …), the
 * universities and community/technical colleges, and local bodies that post
 * there (City of New Orleans, Jefferson Parish, East Baton Rouge City-Parish,
 * Orleans Parish School Board, Sewerage & Water Board, RTA, BREC, …).
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA: about 280 bids):
 *   1. GET deptbids.cfm — one link per department with a bid count:
 *      <a href="dspBid.cfm?search=department&term=13"><strong>+ State -
 *      Transportation and Development - (12)</strong></a> (count 0 = no link).
 *   2. GET each linked department page — a table of bids: bid number
 *      (<span style="color:#0000FF;">3000026771</span>), a description cell
 *      (title, then "Bid Cancelled: <date>" when cancelled, the "Original"
 *      document and its attachments), date issued, and the bid open
 *      date/time ("10/21/2026<br />10:00:00 AM CT"). Addendum rows have no
 *      bid number and are not bids.
 * A bid listed under both the "*** State Procurement ***" group and its own
 * department is kept once, under its own department.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the bid's description line; `solicitation_number` = the bid
 *     number.
 *   - `agency` = the LaPAC department name without its list prefix
 *     ("+ State - ", "++ University - ", "+- Comm/Tech College - ",
 *     "Non State - "); the statewide group reads "Office of State Procurement".
 *   - `location` = "Louisiana" (every buyer is a Louisiana public body).
 *   - `due_date` = the bid open date/time, in Central time.
 *   - `description` is constructed from the bid number, issue date, the
 *     buyer type (state agency, university, …) and the names of the bid's
 *     attachments (specifications, scopes), minus boilerplate forms.
 *   - `source_url` = LaPAC's bid-number page, dspBid.cfm?search=bidno&term=<no>.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Cancelled bids are skipped (`cancelled`); bids whose open time has passed
 * are skipped (`closed`).
 *
 * IDENTITY: `external_id = lapac-<bid number>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const LAPAC_SOURCE = "la_lapac";
export const LAPAC_BASE = "https://wwwcfprd.doa.louisiana.gov/osp/lapac";
export const LAPAC_DEPTS_URL = `${LAPAC_BASE}/deptbids.cfm`;
/** The "*** State Procurement ***" group: statewide bids also listed under agencies. */
export const LAPAC_STATEWIDE_TERM = "1";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Attachment names that are standard forms, not a description of the work. */
const BOILERPLATE_ATTACHMENT =
  /instruction|preference|affidavit|certification|terms and conditions|standard terms|bid form|price sheet|pricing sheet|signature|w-?9|addendum|non-?collusion|insurance requirement|attestation|disclosure|questionnaire/i;

export interface LapacDepartment {
  term: string;
  name: string; // as printed, without the count
  count: number;
}

export interface LapacBid {
  number: string;
  title: string;
  cancelled: boolean;
  issued: string; // "09/30/2026"
  opens: string; // "10/21/2026 10:00:00 AM CT"
  attachments: string[];
}

export interface LapacParseResult {
  rows: RawBid[];
  bids: LapacBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&emsp;|&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** US Central offset (hours) for a calendar date: CDT 2nd Sun Mar – 1st Sun Nov. */
function centralOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -5 : -6;
}

/** "10/21/2026 10:00:00 AM CT" → ISO (Central). Invalid → null. */
export function lapacDateToIso(text: string): string | null {
  const m = decode(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)(?:\s+C[DS]?T)?$/i);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (m[6]!.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (m[6]!.toUpperCase() === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - centralOffset(year, month, day) * 3_600_000).toISOString();
}

/** The department list (only departments with a link, i.e. a non-zero count). */
export function readLapacDepartments(html: string): LapacDepartment[] {
  const out: LapacDepartment[] = [];
  for (const m of html.matchAll(/<a href="dspBid\.cfm\?search=department&(?:amp;)?term=(\d+)"\s*>\s*<strong>([\s\S]*?)<\/strong>/gi)) {
    const text = decode(m[2]!);
    const count = text.match(/\((\d+)\)\s*$/);
    out.push({ term: m[1]!, name: text.replace(/\s*-?\s*\(\d+\)\s*$/, "").trim(), count: count ? Number(count[1]) : 0 });
  }
  return out;
}

/** "+ State - Transportation and Development" → "Transportation and Development". */
export function lapacAgencyName(department: string): string {
  if (/state procurement/i.test(department) && /\*{3}/.test(department)) return "Office of State Procurement";
  const name = department
    .replace(/^[+\-\s]*(?:State|University|Comm\/Tech College|Non State)\s+-\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^LDH$/i.test(name)) return "Louisiana Department of Health";
  return name;
}

/** The kind of buyer a department is, from LaPAC's own grouping prefix. */
function buyerType(department: string): string {
  if (/^\s*\+\+\s*University/i.test(department)) return "a Louisiana public university";
  if (/^\s*\+-\s*Comm\/Tech/i.test(department)) return "a Louisiana community or technical college";
  if (/^\s*Non State/i.test(department)) return "a Louisiana local public body";
  return "a Louisiana state agency";
}

/** The bids on one department page (addendum rows are not bids). */
export function readLapacDepartmentPage(html: string): LapacBid[] {
  const bids: LapacBid[] = [];
  const rowRe = /<tr class="(?:odd|even)Row">([\s\S]*?)<\/tr>/gi;
  for (const tr of html.matchAll(rowRe)) {
    const cells = [...tr[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!);
    const number = cells[0]?.match(/<span[^>]*>([\s\S]*?)<\/span>/)?.[1];
    if (!number || cells.length < 4) continue;
    const desc = cells[1]!;
    const titleHtml = desc.split(/<br\s*\/?>/i)[0] ?? "";
    const attachments = [...desc.matchAll(/<a[^>]*href="[^"]*\/agency\/pdf\/[^"]*-\d+\.pdf"[^>]*>([\s\S]*?)<\/a>/gi)].map((a) => decode(a[1]!));
    bids.push({
      number: decode(number),
      title: decode(titleHtml),
      cancelled: /Bid Cancelled/i.test(desc),
      issued: decode(cells[2]!),
      opens: decode(cells[3]!),
      attachments,
    });
  }
  return bids;
}

function recordSkip(result: LapacParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of one department page — no network, no DB; `now` is injected. */
export function parseLapacDepartment(department: string, html: string, now: number = Date.now()): LapacParseResult {
  const result: LapacParseResult = { rows: [], bids: readLapacDepartmentPage(html), skipped: {}, skippedRows: [] };
  const agency = lapacAgencyName(department);
  for (const b of result.bids) {
    const rowId = `lapac-${b.number}`;
    if (!b.title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (b.cancelled) {
      recordSkip(result, rowId, "cancelled");
      continue;
    }
    const due = lapacDateToIso(b.opens);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const docs = [...new Set(b.attachments.filter((a) => a && !BOILERPLATE_ATTACHMENT.test(a)))].slice(0, 6);
    const description = [
      `Louisiana LaPAC bid ${b.number}${b.issued ? `, issued ${b.issued}` : ""}, from ${buyerType(department)}.`,
      docs.length ? `Bid documents include: ${docs.join("; ")}.` : "",
      "The bid document, attachments and any addenda are on LaPAC (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: b.title,
      agency,
      description,
      location: "Louisiana",
      category: mapCategory("", b.title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: `${LAPAC_BASE}/dspBid.cfm?search=bidno&term=${encodeURIComponent(b.number)}`,
      set_aside: null,
      notice_type: "Solicitation",
      solicitation_number: b.number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${LAPAC_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(LAPAC_SOURCE, [detail]);
}

async function getText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    return await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch every LaPAC department with bids and return ingest rows (one per bid number). */
export async function fetchLaLapacBids(now: number = Date.now()): Promise<FetchResult> {
  const departments = readLapacDepartments(await getText(LAPAC_DEPTS_URL));
  if (departments.length === 0) fail("page shape changed: no department links on deptbids.cfm");
  // Agencies first, the statewide group last, so a bid keeps its own department.
  const ordered = [
    ...departments.filter((d) => d.term !== LAPAC_STATEWIDE_TERM),
    ...departments.filter((d) => d.term === LAPAC_STATEWIDE_TERM),
  ].filter((d) => d.count > 0);
  const seen = new Set<string>();
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  let bids = 0;
  for (const dept of ordered) {
    const r = parseLapacDepartment(dept.name, await getText(`${LAPAC_BASE}/dspBid.cfm?search=department&term=${dept.term}`), now);
    if (r.bids.length === 0) fail(`page shape changed: department ${dept.term} lists ${dept.count} bids, parsed 0`);
    bids += r.bids.length;
    for (const row of r.rows) {
      if (seen.has(row.external_id)) {
        skipped.duplicate = (skipped.duplicate ?? 0) + 1;
        continue;
      }
      seen.add(row.external_id);
      rows.push(row);
    }
    for (const [k, n] of Object.entries(r.skipped)) skipped[k] = (skipped[k] ?? 0) + n;
    skippedRows.push(...r.skippedRows);
  }
  console.log(
    `  ${LAPAC_SOURCE}: ${rows.length} open bids accepted (bids read: ${bids} in ${ordered.length} departments; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
