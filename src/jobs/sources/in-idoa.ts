/**
 * Indiana IDOA Current Business Opportunities — `in_idoa`, the State of
 * Indiana's public list of open bid events (www.in.gov/idoa/procurement,
 * run by the Indiana Department of Administration).
 *
 * WHY: Contrax had no state Indiana feed. Every executive agency's sourcing
 * event (Natural Resources, State Police, Health, FSSA, Correction,
 * Correctional Industries, Veterans Home, Technology, …) is listed there.
 *
 * SOURCE (verified live 2026-10-02, no login, no CAPTCHA: 55 open events):
 *   GET /idoa/procurement/current-business-opportunities/
 * The page's open-events table has the header row
 *   Event Name | Agency | Event ID | Event Description | Response Due By | Contact
 * (other tables on the page are pre-proposal conference schedules and are
 * ignored). Each event row links its bid package as
 * /idoa/proc/solicitations/files/<Event ID>.zip.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the event name; `solicitation_number` = the Event ID.
 *   - `agency` = the Agency column ("Natural Resources", "State Police", …).
 *   - `location` = "Indiana" (every buyer is an Indiana state agency).
 *   - `due_date` = "Response Due By" ("10/02/2026 8:30:00AM EST"). IDOA prints
 *     "EST" all year; it is read as Indianapolis local time (EDT in summer),
 *     the earlier of the two readings, so a bid is never shown as open later
 *     than it really is.
 *   - `description` = the event description with emails, phone numbers and
 *     the agency's name (whole words, exact case, with any "Indiana
 *     Department of" before it) replaced (contacts are not ingested; agency
 *     words cause false trade matches).
 *   - `source_url` = the Current Business Opportunities page (the bid package
 *     zip is named in the description). There is no per-event page.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Events whose due time has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = inidoa-<Event ID>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const IN_IDOA_SOURCE = "in_idoa";
export const IN_IDOA_URL = "https://www.in.gov/idoa/procurement/current-business-opportunities/";
const MAX_DESCRIPTION = 1500;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

export interface IdoaEvent {
  name: string;
  agency: string;
  id: string;
  description: string;
  due: string;
  packageUrl: string | null;
}

export interface IdoaParseResult {
  rows: RawBid[];
  events: IdoaEvent[];
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** US Eastern offset (hours) for a calendar date: EDT 2nd Sun Mar – 1st Sun Nov. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "10/02/2026  8:30:00AM EST" → ISO, Indianapolis local time. Invalid → null. */
export function idoaDateToIso(text: string): string | null {
  const m = decode(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)(?:\s+E[SD]?T)?$/i);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (m[6]!.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (m[6]!.toUpperCase() === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - easternOffset(year, month, day) * 3_600_000).toISOString();
}

/** The open-events table (found by its header), one entry per event row. */
export function readIdoaEvents(html: string): IdoaEvent[] | null {
  const table = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)]
    .map((m) => m[0])
    .find((t) => /Event Name[\s\S]*?Event ID[\s\S]*?Response Due By/i.test(t));
  if (!table) return null;
  const events: IdoaEvent[] = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!);
    if (cells.length < 5) continue;
    const nameCell = cells[0]!;
    const name = decode(nameCell.replace(/<a[^>]*>\s*Bid Documents\s*<\/a>/gi, ""));
    const pkg = nameCell.match(/href="([^"]*\/solicitations\/files\/[^"]+)"/i)?.[1] ?? null;
    events.push({
      name,
      agency: decode(cells[1]!),
      id: decode(cells[2]!),
      description: decode(cells[3]!),
      due: decode(cells[4]!),
      packageUrl: pkg ? new URL(pkg, IN_IDOA_URL).toString() : null,
    });
  }
  return events;
}

function recordSkip(result: IdoaParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseIdoaPage(html: string, now: number = Date.now()): IdoaParseResult {
  const result: IdoaParseResult = { rows: [], events: readIdoaEvents(html) ?? [], skipped: {}, skippedRows: [] };
  for (const e of result.events) {
    const rowId = `inidoa-${e.id}`;
    if (!e.id || !e.name || !e.agency) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const due = idoaDateToIso(e.due);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    let text = e.description
      .replace(EMAIL_RE, "(email on the IDOA page)")
      .replace(PHONE_RE, "(phone on the IDOA page)")
      .replace(
        // Whole words, exact case: "our natural resources" is ordinary text.
        new RegExp(`(?:\\b[Tt]he\\s+)?(?:Indiana\\s+)?(?:State\\s+)?(?:(?:Department|Dept\\.?|Office) of\\s+(?:the\\s+)?)?\\b${escapeRegExp(e.agency)}\\b`, "g"),
        "the buyer",
      );
    if (text.length > MAX_DESCRIPTION) text = `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
    const description = [
      text,
      e.packageUrl ? `Bid package: ${e.packageUrl}` : "",
      "Listed on Indiana IDOA Current Business Opportunities.",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.name,
      agency: e.agency,
      description,
      location: "Indiana",
      category: mapCategory("", e.name, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: IN_IDOA_URL,
      set_aside: null,
      notice_type: "Solicitation",
      solicitation_number: e.id,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${IN_IDOA_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(IN_IDOA_SOURCE, [detail]);
}

/** Fetch Indiana's current business opportunities and return ingest rows. */
export async function fetchInIdoaBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let html: string;
  try {
    const resp = await fetch(IN_IDOA_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, IN_IDOA_URL));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!readIdoaEvents(html)) fail(`page shape changed: no open-events table (${html.length} bytes)`);
  const { rows, events, skipped, skippedRows } = parseIdoaPage(html, now);
  console.log(
    `  ${IN_IDOA_SOURCE}: ${rows.length} open events accepted (listed: ${events.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
