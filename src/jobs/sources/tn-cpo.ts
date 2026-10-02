/**
 * Tennessee Central Procurement Office RFP opportunities — `tn_cpo`, the
 * State of Tennessee's public list of open requests for proposals,
 * qualifications and information (www.tn.gov/generalservices, Department of
 * General Services, Central Procurement Office).
 *
 * WHY: Contrax had no state Tennessee feed. The CPO posts every state
 * agency's RFPs, RFQs, RFIs and solicitation notices (insurance, Medicaid,
 * IT systems, corrections programs, real estate, …) on one page.
 *
 * SOURCE (verified live 2026-10-02, no login, no CAPTCHA: 73 rows):
 *   GET /generalservices/procurement/central-procurement-office--cpo-/
 *       supplier-information/request-for-proposals--rfp--opportunities1.html
 * One table, four cells per row:
 *   1. the document links: the first is the event itself ("RFP 30901-65626",
 *      "RFI 34800-042826", "Solicitation Notice 34307-31427"); later links
 *      are amendments, attachments and releases;
 *   2. "Start - Response Due": two dates (MM/DD/YYYY<br />MM/DD/YYYY);
 *   3. the title; 4. (empty).
 * The page lists no agency name; the 5-digit agency code leads the event
 * number.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the title cell; `solicitation_number` = the event number
 *     ("30901-65626"); `notice_type` = the event kind (RFP, RFQ, RFI,
 *     Solicitation Notice).
 *   - `agency` = "State of Tennessee" (no per-row agency is published).
 *   - `location` = "Tennessee".
 *   - `due_date` = the response due DATE at 12:00 AM Eastern (the page has no
 *     time; Tennessee spans Eastern and Central, and the earliest reading
 *     never shows a row as open later than it really is).
 *   - `description` is constructed: kind, number, start date, and the names
 *     of the amendments/attachments posted with it.
 *   - `source_url` = the event's own document link (absolute).
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Rows whose response due date has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = tncpo-<event number>` (the event number is the
 * state's own identifier and is unique on the page; characters other than
 * letters, digits and "-" become "-", e.g. "529/000-01-2026" → "529-000-01-2026").
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const TN_CPO_SOURCE = "tn_cpo";
export const TN_CPO_URL =
  "https://www.tn.gov/generalservices/procurement/central-procurement-office--cpo-/supplier-information/request-for-proposals--rfp--opportunities1.html";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface TnEvent {
  kind: string; // "RFP", "RFQ", "RFI", "Solicitation Notice"
  number: string; // "30901-65626"
  title: string;
  start: string; // "10/01/2026"
  due: string; // "10/08/2026"
  link: string | null;
  documents: string[];
}

export interface TnParseResult {
  rows: RawBid[];
  events: TnEvent[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** US Eastern offset (hours) for a calendar date: EDT 2nd Sun Mar – 1st Sun Nov. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "10/08/2026" → 12:00 AM Eastern that day. Invalid → null. */
export function tnDateToIso(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day) - easternOffset(year, month, day) * 3_600_000).toISOString();
}

/** "RFP 30901-65626" / "Solicitation_Notice 3…" → kind + number; null when it is not an event label. */
export function tnEventLabel(text: string): { kind: string; number: string } | null {
  const m = decode(text)
    .replace(/_/g, " ")
    .match(/^(RFP|RFQ|RFI|Solicitation Notice|Solicitation)\s+([0-9][0-9A-Za-z/-]*[0-9A-Za-z])/i);
  if (!m) return null;
  const kind = /^solicitation/i.test(m[1]!) ? "Solicitation Notice" : m[1]!.toUpperCase();
  return { kind, number: m[2]! };
}

/** The events in the page's table (rows without an event label are ignored). */
export function readTnEvents(html: string): TnEvent[] | null {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0];
  if (!table || !/Response Due/i.test(table)) return null;
  const events: TnEvent[] = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!);
    if (cells.length < 3) continue;
    const links = [...cells[0]!.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((a) => ({ href: a[1]!, text: decode(a[2]!) }));
    const first = links[0] ?? { href: "", text: decode(cells[0]!) };
    const label = tnEventLabel(first.text) ?? tnEventLabel(decode(cells[0]!));
    if (!label) continue;
    const dates = decode(cells[1]!).match(/\d{1,2}\/\d{1,2}\/\d{4}/g) ?? [];
    let link: string | null = null;
    try {
      link = first.href ? new URL(first.href.replace(/&amp;/g, "&"), TN_CPO_URL).toString() : null;
    } catch {
      link = null;
    }
    events.push({
      ...label,
      // The CPO marks re-posted rows "… - UPDATED"; that is not part of the title.
      title: decode(cells[2]!).replace(/\s*[-–(]\s*UPDATED\)?\s*$/i, ""),
      start: dates[0] ?? "",
      due: dates[1] ?? dates[0] ?? "",
      link,
      documents: links.slice(1).map((l) => l.text).filter((t) => t && !tnEventLabel(t)),
    });
  }
  return events;
}

function recordSkip(result: TnParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseTnPage(html: string, now: number = Date.now()): TnParseResult {
  const result: TnParseResult = { rows: [], events: readTnEvents(html) ?? [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const e of result.events) {
    const rowId = `tncpo-${e.number.replace(/[^0-9A-Za-z-]/g, "-")}`;
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    if (!e.title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const due = tnDateToIso(e.due);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    // Due at 12:00 AM: the row stays listed through its due date's start.
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const docs = [...new Set(e.documents)].slice(0, 8);
    const description = [
      `State of Tennessee ${e.kind} ${e.number}${e.start ? `, posted ${e.start}` : ""}, response due ${e.due}.`,
      docs.length ? `Posted documents: ${docs.join("; ")}.` : "",
      "The solicitation document is on the Central Procurement Office page (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.title,
      agency: "State of Tennessee",
      description,
      location: "Tennessee",
      category: mapCategory("", e.title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: e.link ?? TN_CPO_URL,
      set_aside: null,
      notice_type: e.kind,
      solicitation_number: e.number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${TN_CPO_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(TN_CPO_SOURCE, [detail]);
}

/** Fetch the CPO RFP opportunities page and return ingest rows. */
export async function fetchTnCpoBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let html: string;
  try {
    const resp = await fetch(TN_CPO_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, TN_CPO_URL));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const events = readTnEvents(html);
  if (!events || events.length === 0) fail(`page shape changed: no RFP table rows (${html.length} bytes)`);
  const { rows, skipped, skippedRows } = parseTnPage(html, now);
  console.log(
    `  ${TN_CPO_SOURCE}: ${rows.length} open events accepted (listed: ${events.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
