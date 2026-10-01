/**
 * California Cal eProcure — `ca_eprocure`, the State of California's public
 * bid-event board (caleprocure.ca.gov, run by the Department of General
 * Services on PeopleSoft).
 *
 * WHY: Contrax had no state California feed; its California rows came from
 * the federal SAM.gov "ca" keyword pass and Los Angeles open data. State
 * departments (Caltrans, CDCR, DGS, CHP, CAL FIRE, …) post their solicitations
 * on Cal eProcure.
 *
 * SOURCE (verified live 2026-10-01, no login): the public "Find
 * Solicitations" page (/pages/Events-BS3/event-search.aspx) frames the
 * PeopleSoft component AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC ("Response Bid
 * Inquiry"). A single GET of that component returns every posted event in one
 * HTML grid (354 rows on 2026-10-01), so this connector reads that grid with
 * string anchors + regex (the house style: there is no HTML parser in the
 * ingest path). Per row i the grid carries:
 *   AUC_ID_COL$i                      event id (link text)
 *   RESP_INQA1_WK_ZZ_AUC_NAME$i       event name
 *   RESP_INQA1_WK_BUSINESS_UNIT$i     department code (e.g. 2660)
 *   BUS_UNIT_TBL_FS_DESCR$201$$i      department name ("Department of Transportation")
 *   ZZ_DERIVED_DESCR254$i             status ("Posted")
 *   RESP_INQA1_WK_AUC_TYPE$i          event type ("RFx")
 *   RESP_INQA1_WK_AUC_DTTM_FINISH$i   end date/time with zone ("10/07/2026  1:00PM PDT")
 * If the page is not the inquiry page or the grid anchors are missing, the run
 * fails loudly (SourceUnreachableError) instead of ingesting a partial guess.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = event name, verbatim (HTML entities decoded; the source's own
 *     characters, including its "¿" stand-ins for dashes, are left as is).
 *   - `agency` = the row's department name; `location` = "California" (the
 *     grid has no place of performance; every buyer is a California state
 *     department).
 *   - `due_date` = the end date/time in the zone it states (PDT/PST), as UTC.
 *   - `solicitation_number` = event id; `notice_type` = event type.
 *   - `source_url` = https://caleprocure.ca.gov/event/<department code>/<event id>
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Rows whose status is not "Posted", or whose end date has passed, are skipped
 * with a reason code.
 *
 * IDENTITY: `external_id = caeprocure-<department code>-<event id>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const CAEP_ORIGIN = "https://caleprocure.ca.gov";
export const CAEP_INQUIRY_URL =
  `${CAEP_ORIGIN}/psc/psfpd1/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL?Page=AUC_RESP_INQ_AUC&Action=U`;

export const CAEP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${CAEP_ORIGIN}/pages/Events-BS3/event-search.aspx`,
} as const;

/** Upper bound on grid rows read, so a broken page can never loop. */
export const CAEP_MAX_ROWS = 5000;

export interface CaepRow {
  eventId: string;
  name: string;
  businessUnit: string;
  department: string;
  status: string;
  type: string;
  end: string;
}

export interface CaepParseResult {
  rows: RawBid[];
  parsed: CaepRow[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text of the element with this exact id (span/a/div), or "" if absent. */
function cell(html: string, id: string): string {
  const m = html.match(new RegExp(`id='${escapeRe(id)}'[^>]*>([\\s\\S]*?)</(?:span|a|div)>`));
  return m ? decode(m[1]) : "";
}

const ZONE_OFFSET_HOURS: Record<string, number> = { PDT: -7, PST: -8 };

/**
 * "10/07/2026  1:00PM PDT" → UTC ISO. Uses the zone the source states (PDT or
 * PST); with no zone it falls back to Pacific standard/daylight by date. A
 * date with no time becomes 11:59 PM that day. Unparseable → null.
 */
export function caepEndToIso(text: string | null | undefined): string | null {
  const t = decode(text);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP])M)?(?:\s+([A-Z]{3}))?$/i);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hour = 23;
  let minute = 59;
  if (m[4]) {
    hour = (Number(m[4]) % 12) + (m[6].toUpperCase() === "P" ? 12 : 0);
    minute = Number(m[5]);
  }
  const zone = (m[7] ?? "").toUpperCase();
  let offset = ZONE_OFFSET_HOURS[zone];
  if (offset === undefined) {
    // No (or unknown) zone: Pacific time, DST by date (2nd Sun Mar – 1st Sun Nov).
    const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
    const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
    const day0 = Date.UTC(year, month - 1, day);
    offset = day0 >= dstStart && day0 < dstEnd ? -7 : -8;
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute) - offset * 3_600_000;
  return new Date(utc).toISOString();
}

export function caepEventUrl(businessUnit: string, eventId: string): string {
  return `${CAEP_ORIGIN}/event/${encodeURIComponent(businessUnit)}/${encodeURIComponent(eventId)}`;
}

/** True when the HTML is the PeopleSoft Response Bid Inquiry page. */
export function isCaepInquiryPage(html: string): boolean {
  return /<title>\s*Response Bid Inquiry/i.test(html) && html.includes("RESP_INQA1_WK_ZZ_AUC_NAME");
}

function recordSkip(result: CaepParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of the inquiry grid — no network, no DB; `now` is injected. */
export function parseCaepInquiry(html: string, now: number = Date.now()): CaepParseResult {
  const result: CaepParseResult = { rows: [], parsed: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (let i = 0; i < CAEP_MAX_ROWS; i++) {
    if (!html.includes(`id='AUC_ID_COL$${i}'`)) break;
    const row: CaepRow = {
      eventId: cell(html, `AUC_ID_COL$${i}`),
      name: cell(html, `RESP_INQA1_WK_ZZ_AUC_NAME$${i}`),
      businessUnit: cell(html, `RESP_INQA1_WK_BUSINESS_UNIT$${i}`),
      department: cell(html, `BUS_UNIT_TBL_FS_DESCR$201$$${i}`),
      status: cell(html, `ZZ_DERIVED_DESCR254$${i}`),
      type: cell(html, `RESP_INQA1_WK_AUC_TYPE$${i}`),
      end: cell(html, `RESP_INQA1_WK_AUC_DTTM_FINISH$${i}`),
    };
    result.parsed.push(row);
    if (!row.eventId || !row.businessUnit) {
      recordSkip(result, `caeprocure-row-${i}`, "missing_id");
      continue;
    }
    const rowId = `caeprocure-${row.businessUnit}-${row.eventId}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    if (row.status.toLowerCase() !== "posted") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (!row.name) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const due = caepEndToIso(row.end);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = row.department || `California state department ${row.businessUnit}`;
    // The buyer is NOT repeated here: trade matching reads the description, and
    // department names contain trade words ("California Highway Patrol" would
    // match "patrol" for security guards). The buyer is in `agency`.
    const description =
      `Event ${row.eventId} posted on Cal eProcure, California's state procurement portal. ` +
      "Full details and documents are on the Cal eProcure event page (see source link).";
    result.rows.push({
      external_id: rowId,
      title: row.name,
      agency,
      description,
      location: "California",
      category: mapCategory("", row.name, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: caepEventUrl(row.businessUnit, row.eventId),
      set_aside: null,
      notice_type: row.type || null,
      solicitation_number: row.eventId,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** Max redirects followed while PeopleSoft sets up the guest session. */
const CAEP_MAX_REDIRECTS = 6;

/**
 * GET with the PeopleSoft session handshake: the first request answers 302 and
 * sets session cookies (load balancer + InFlightSessionID) that the next
 * request must send back, which fetch's automatic redirect does not do. So
 * redirects are followed by hand, carrying the cookies.
 */
async function getWithSession(url: string, signal: AbortSignal): Promise<Response> {
  const jar = new Map<string, string>();
  let next = url;
  for (let hop = 0; hop <= CAEP_MAX_REDIRECTS; hop++) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const resp = await fetch(next, {
      headers: cookie ? { ...CAEP_HEADERS, Cookie: cookie } : CAEP_HEADERS,
      redirect: "manual",
      signal,
    });
    const setCookies =
      typeof (resp.headers as any).getSetCookie === "function"
        ? ((resp.headers as any).getSetCookie() as string[])
        : (resp.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    for (const c of setCookies) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const location = resp.headers.get("location");
    if (resp.status >= 300 && resp.status < 400 && location) {
      next = new URL(location, next).toString();
      continue;
    }
    return resp;
  }
  throw new Error(`too many redirects (> ${CAEP_MAX_REDIRECTS})`);
}

/** Fetch every posted Cal eProcure event (one page) and return ingest rows. */
export async function fetchCaEprocureBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let resp: Response;
  let html: string;
  try {
    resp = await getWithSession(CAEP_INQUIRY_URL, controller.signal);
    html = resp.status === 200 ? await resp.text() : "";
  } catch (e) {
    const detail = requestFailureDetail(e);
    console.error(`  ca_eprocure: ${detail}`);
    throw new SourceUnreachableError("ca_eprocure", [detail]);
  } finally {
    clearTimeout(timer);
  }
  if (resp.status !== 200) {
    const detail = httpFailureDetail(resp.status, CAEP_INQUIRY_URL);
    console.error(`  ca_eprocure: ${detail}`);
    throw new SourceUnreachableError("ca_eprocure", [detail]);
  }
  if (!isCaepInquiryPage(html)) {
    const detail = `page shape changed: not the Response Bid Inquiry grid (${html.length} bytes)`;
    console.error(`  ca_eprocure: ${detail}`);
    throw new SourceUnreachableError("ca_eprocure", [detail]);
  }
  const { rows, parsed, skipped, skippedRows } = parseCaepInquiry(html, now);
  console.log(
    `  ca_eprocure: ${rows.length} open events accepted (grid rows: ${parsed.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
