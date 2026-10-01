/**
 * Delaware Bid Solicitation Directory — `de_mmp`, the State of Delaware's
 * central list of open solicitations (mmp.delaware.gov, run by OMB
 * Government Support Services).
 *
 * WHY: Contrax had no state Delaware feed. The directory carries every
 * agency's RFIs, RFQs, ITBs and RFPs in one place: OMB Facilities
 * Management, DelDOT, DNREC, Health and Social Services, Education, school
 * districts, Delaware Tech, Delaware State University, …
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA: 52 open bids):
 *   1. GET  /Bids                         — session cookie for the grid.
 *   2. POST /Bids/GetBids?status=Open     — the page's own jqGrid request
 *      (JSON body `{rows, page, sidx, sord}`), answered with
 *      `{records, rows: [{Id, ContractNumber, Title, OpenDate, DeadlineDate,
 *      AgencyCode, BidUnspscCodesString}]}`. One request with rows=1000
 *      returns them all (`records` is checked so nothing is silently cut).
 *   3. GET  /Agency/Index                 — acronym → agency name table.
 *   4. GET  /Bids/GetBidDetail?id=<Id>    — per bid, for the deadline TIME
 *      ("11/20/2026 at 1:00 PM Local Time"); the list only has the date.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the bid title; `solicitation_number` = the contract number.
 *   - `agency` = the directory's agency name for the acronym ("Agriculture,
 *     Department of" → "Department of Agriculture"); the acronym itself when
 *     the table has no entry.
 *   - `location` = "Delaware" (every buyer is a Delaware public body).
 *   - `due_date` = the detail page's deadline in Eastern time. When a detail
 *     page cannot be read, 12:00 AM Eastern on the deadline date, so a bid is
 *     never shown as open later than it really is.
 *   - `description` is constructed (never the agency name — agency words
 *     cause false trade matches) and names the UNSPSC classes the bid lists.
 *   - `source_url` = the bid's bookmarkable page, /Bids/Details/<Id>.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Bids whose deadline has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = demmp-<Id>` (the directory's own bid id).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const DE_MMP_SOURCE = "de_mmp";
export const DE_MMP_ORIGIN = "https://mmp.delaware.gov";
const PAGE_ROWS = 1000;
const DETAIL_CONCURRENCY = 4;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface DeMmpListRow {
  Id: number;
  ContractNumber?: string | null;
  Title?: string | null;
  OpenDate?: string | null; // "2026-10-01"
  DeadlineDate?: string | null; // "2026-11-20"
  AgencyCode?: string | null;
  BidUnspscCodesString?: string | null;
}

export interface DeMmpList {
  records?: number;
  rows?: DeMmpListRow[];
}

export interface DeMmpParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
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

function easternIso(year: number, month: number, day: number, hour = 0, minute = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - easternOffset(year, month, day) * 3_600_000).toISOString();
}

/** "2026-11-20" → 12:00 AM Eastern that day. Invalid → null. */
export function deDateToIso(text: string | null | undefined): string | null {
  const m = String(text ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return easternIso(year, month, day);
}

/** The deadline on a GetBidDetail page ("11/20/2026 at 1:00 PM Local Time") in Eastern time; null when absent. */
export function deDetailDeadline(html: string): string | null {
  const block = html.match(/Deadline for Bid Responses[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  const text = block ? decode(block[1]!) : "";
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (m[6]!.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (m[6]!.toUpperCase() === "AM" && hour === 12) hour = 0;
  return easternIso(year, month, day, hour, minute);
}

/** The /Agency/Index table as acronym → readable name. */
export function readDeAgencies(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => decode(c[1]!));
    if (cells.length < 2 || !cells[0] || !cells[1]) continue;
    out[cells[0].toUpperCase()] = cells[1].replace(/^(.+?),\s*((?:Department|Office|Division|Board|Commission) of(?: the)?)$/i, "$2 $1");
  }
  return out;
}

function recordSkip(result: DeMmpParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/**
 * PURE parse — no network, no DB; `now` is injected. `deadlines` maps a bid
 * Id to the detail page's deadline (missing → 12:00 AM on the list's date).
 */
export function parseDeMmpBids(
  list: DeMmpList,
  agencies: Record<string, string>,
  deadlines: Record<string, string | null>,
  now: number = Date.now(),
): DeMmpParseResult {
  const result: DeMmpParseResult = { rows: [], skipped: {}, skippedRows: [] };
  for (const r of list.rows ?? []) {
    const rowId = `demmp-${r.Id}`;
    const title = decode(String(r.Title ?? ""));
    const number = decode(String(r.ContractNumber ?? ""));
    if (!Number.isInteger(r.Id) || !title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const due = deadlines[String(r.Id)] ?? deDateToIso(r.DeadlineDate);
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const code = String(r.AgencyCode ?? "").trim().toUpperCase();
    const agency = agencies[code] ?? (code || "State of Delaware");
    const unspsc = String(r.BidUnspscCodesString ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => /^\d{2,8}$/.test(c));
    const description = [
      `State of Delaware solicitation ${number || r.Id}, advertised ${r.OpenDate ?? "on the Bid Solicitation Directory"}.`,
      unspsc.length ? `UNSPSC classes: ${unspsc.join(", ")}.` : "",
      "Solicitation documents, amendments and the contract officer's contact are on the bid's directory page (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Delaware",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: `${DE_MMP_ORIGIN}/Bids/Details/${r.Id}`,
      set_aside: null,
      notice_type: "Solicitation",
      solicitation_number: number || String(r.Id),
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${DE_MMP_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(DE_MMP_SOURCE, [detail]);
}

/** Fetch the open Delaware directory and return ingest rows. */
export async function fetchDeMmpBids(now: number = Date.now()): Promise<FetchResult> {
  const jar = new Map<string, string>();
  const keep = (resp: Response) => {
    for (const c of resp.headers.getSetCookie()) {
      const pair = c.split(";")[0]!;
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const request = async (path: string, init: RequestInit = {}): Promise<string> => {
    const url = `${DE_MMP_ORIGIN}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const resp = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": UA,
          Referer: `${DE_MMP_ORIGIN}/Bids`,
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
        redirect: "manual",
      });
      keep(resp);
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
      return await resp.text();
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
  };

  await request("/Bids", { headers: { Accept: "text/html" } });
  const body = await request("/Bids/GetBids?status=Open", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ _search: false, nd: now, rows: PAGE_ROWS, page: 1, sidx: "OpenDate", sord: "desc" }),
  });
  let list: DeMmpList;
  try {
    list = JSON.parse(body) as DeMmpList;
  } catch {
    fail(`page shape changed: GetBids did not return JSON (${body.length} bytes)`);
  }
  if (!Array.isArray(list.rows)) fail("page shape changed: GetBids has no rows array");
  if (typeof list.records === "number" && list.records > list.rows.length) {
    fail(`list truncated: ${list.rows.length} of ${list.records} rows returned`);
  }

  let agencies: Record<string, string> = {};
  try {
    agencies = readDeAgencies(await request("/Agency/Index", { headers: { Accept: "text/html" } }));
  } catch (e) {
    console.warn(`  ${DE_MMP_SOURCE}: agency table unavailable, using acronyms (${String(e)})`);
  }

  const deadlines: Record<string, string | null> = {};
  const ids = list.rows.map((r) => r.Id).filter((id) => Number.isInteger(id));
  let missing = 0;
  for (let i = 0; i < ids.length; i += DETAIL_CONCURRENCY) {
    await Promise.all(
      ids.slice(i, i + DETAIL_CONCURRENCY).map(async (id) => {
        try {
          deadlines[String(id)] = deDetailDeadline(await request(`/Bids/GetBidDetail?id=${id}`, { headers: { Accept: "text/html" } }));
        } catch {
          deadlines[String(id)] = null;
        }
        if (!deadlines[String(id)]) missing++;
      }),
    );
  }

  const { rows, skipped, skippedRows } = parseDeMmpBids(list, agencies, deadlines, now);
  console.log(
    `  ${DE_MMP_SOURCE}: ${rows.length} open bids accepted (listed: ${list.rows.length}; deadline time unread for ${missing}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
