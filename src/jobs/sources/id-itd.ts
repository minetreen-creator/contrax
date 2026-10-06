/**
 * Idaho Transportation Department highway lettings — `id_itd`, ITD's list of
 * currently advertised highway construction and maintenance projects.
 *
 * WHY: Contrax had no Idaho feed (owner 2026-10-06 allowed *.idaho.gov).
 *
 * SOURCE (verified live 2026-10-06, no login, no CAPTCHA: 10 advertised
 * projects, bid openings Oct 6 – Oct 27): the public page
 *   https://itd.idaho.gov/contractor-bidding/
 * has two tables, "Currently Advertised Major Highways Projects" and
 * "Currently Advertised SIA/IRP Highways Projects" (the second may read "No
 * projects currently advertised"). Each row has Bid Opening (a date), Key
 * Number, Project (linked to its Notice to Contractors PDF), Funding and
 * District.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the project name without its "Call N:" prefix.
 *   - `agency` = "Idaho Transportation Department (ITD)".
 *   - `due_date` = the Bid Opening date. The page gives no time, so it is
 *     stored at 11:59 PM Mountain (the convention for date-only deadlines);
 *     the description says the time is in the Notice to Contractors.
 *   - `solicitation_number` = Key Number; `source_url` = the project's Notice
 *     to Contractors PDF (the page itself when a row has none).
 *   - The description names it a highway construction and maintenance
 *     project, as the page does, with funding and district.
 *   - `location` = "Idaho"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: bid opening passed (`closed`), unreadable date (`bad_date`), no
 * key number or name (`missing_fields`), repeated key (`duplicate`).
 *
 * IDENTITY: `external_id = iditd-<Key Number>` (spaces/dashes collapsed).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const ID_ITD_SOURCE = "id_itd";
export const ID_ITD_URL = "https://itd.idaho.gov/contractor-bidding/";
const AGENCY = "Idaho Transportation Department (ITD)";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface ItdProject {
  opening: string;
  key: string;
  name: string;
  noticeUrl: string | null;
  funding: string;
  district: string;
  program: string;
}

export interface ItdParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function text(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rows of the "Currently Advertised …" tables. */
export function parseItdPage(html: string): ItdProject[] {
  const out: ItdProject[] = [];
  for (const heading of ["Currently Advertised Major Highways Projects", "Currently Advertised SIA/IRP Highways Projects"]) {
    const at = html.indexOf(heading);
    if (at < 0) continue;
    const next = html.indexOf("Currently Advertised", at + heading.length);
    const tableStart = html.indexOf("<table", at);
    if (tableStart < 0 || (next > 0 && tableStart > next)) continue; // "No projects currently advertised"
    const table = html.slice(tableStart, html.indexOf("</table>", tableStart));
    for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (cells.length < 5 || /no projects currently advertised/i.test(text(cells[0]))) continue;
      const href = /href="([^"]+)"/.exec(cells[2])?.[1] ?? null;
      out.push({
        opening: text(cells[0]),
        key: text(cells[1]),
        name: text(cells[2]).replace(/^Call\s+\d+:\s*/i, ""),
        noticeUrl: href ? encodeURI(decodeURI(href)) : null,
        funding: text(cells[3]),
        district: text(cells[4]),
        program: heading.includes("SIA") ? "SIA/IRP" : "Major Highways",
      });
    }
  }
  return out;
}

/** "October 20, 2026" → 11:59 PM Mountain that day (MDT/MST by US rules), or NaN. */
export function itdDueMs(s: string): number {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  if (!m || mo < 1) return NaN;
  const [y, d] = [+m[3], +m[2]];
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const day = Date.UTC(y, mo - 1, d);
  const offset = day >= Date.UTC(y, 2, nthSunday(3, 2)) && day < Date.UTC(y, 10, nthSunday(11, 1)) ? 6 : 7;
  return Date.UTC(y, mo - 1, d, 23 + offset, 59);
}

function recordSkip(result: ItdParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function buildItdRows(projects: ItdProject[], now: number = Date.now()): ItdParseResult {
  const result: ItdParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const p of projects) {
    const key = p.key.replace(/\s*[–-]\s*/g, "-").replace(/\s+/g, "-");
    const rowId = `iditd-${key}`;
    if (!key || !p.name) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const dueMs = itdDueMs(p.opening);
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const district = /^\d+$/.test(p.district) ? `District ${p.district}` : p.district;
    const description = [
      `Idaho Transportation Department highway construction and maintenance project, key number ${p.key} (${p.program}${p.funding ? `, ${p.funding} funding` : ""}${district ? `, ${district}` : ""}).`,
      `Bid opening ${p.opening}; the opening time and bidding instructions are in the Notice to Contractors (see source link).`,
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title: p.name,
      agency: AGENCY,
      description,
      location: "Idaho",
      category: mapCategory("", p.name, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: p.noticeUrl ?? ID_ITD_URL,
      set_aside: null,
      notice_type: "Highway letting",
      solicitation_number: p.key,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${ID_ITD_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(ID_ITD_SOURCE, [detail]);
}

/** GET the contractor bidding page and return ingest rows. */
export async function fetchIdItdBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let html = "";
  try {
    const resp = await fetch(ID_ITD_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, ID_ITD_URL));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!html.includes("Currently Advertised Major Highways Projects")) fail("page shape changed: no advertised projects section");
  const projects = parseItdPage(html);
  const { rows, skipped, skippedRows } = buildItdRows(projects, now);
  console.log(
    `  ${ID_ITD_SOURCE}: ${rows.length} advertised projects accepted (listed: ${projects.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
