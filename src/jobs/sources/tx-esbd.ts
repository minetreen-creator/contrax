/**
 * Texas ESBD — Electronic State Business Daily (`tx_esbd`), the Texas
 * Comptroller's public solicitation board on txsmartbuy.gov.
 *
 * WHY: Contrax had no state or local Texas feed. Its Texas rows came from the
 * federal SAM.gov "tx" keyword pass and City of Austin award data (awards, not
 * open bids). ESBD carries the open solicitations of Texas state agencies
 * (TxDOT, TDCJ, DPS, …), universities and community colleges, ISDs, counties,
 * cities, river authorities and councils of governments (411 buyers on
 * 2026-10-01), which is where much of the state's trucking, hauling and
 * freight work is posted.
 *
 * SOURCE (verified live 2026-10-01, no auth, no CAPTCHA): the public
 * https://www.txsmartbuy.gov/esbd page is a NetSuite SuiteCommerce app that
 * loads its list by POSTing JSON to ESBD.Service.ss. This connector sends the
 * same request the page sends ({ page, urlRoot: "esbd", status }) and pages
 * through it (the service returns a fixed 24 rows per page). Open solicitations
 * are status "1" (Posted; this filter also returns "Addendum Posted" rows) plus
 * status "6" (Addendum Posted); they are merged and de-duplicated by
 * internalid. Status "4" (New) is not used: those are scheduled postings that
 * are not public yet.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`               = `title`, verbatim (HTML entities decoded).
 *   - `agency`              = `agencyName` without ESBD's trailing agency code
 *                             ("University Of Texas At Tyler - 750" → "University
 *                             Of Texas At Tyler").
 *   - `location`            = "Texas". ESBD has no place-of-performance field;
 *                             every ESBD buyer is a Texas public body.
 *   - `description`         = the solicitation's own NIGP commodity codes and
 *                             posting date (ESBD's list has no prose summary).
 *   - `due_date`            = `responseDue` + `responseTime`, read as Texas
 *                             (America/Chicago) local time and converted to UTC.
 *                             A date with no time is stored as 11:59 PM Central
 *                             that day, so it is never dropped early.
 *   - `solicitation_number` = `solicitationId`.
 *   - `notice_type`         = `statusName` ("Posted" / "Addendum Posted").
 *   - `source_url`          = the public ESBD detail page
 *                             https://www.txsmartbuy.gov/esbd/<solicitationId>.
 *   - `naics_code` / `psc` / `set_aside` stay NULL: ESBD's list has none.
 *
 * WHAT IS SKIPPED (reason-coded): any status other than Posted / Addendum
 * Posted, a response due date already past, and rows missing an id, title or
 * solicitation number.
 *
 * IDENTITY: `external_id = esbd-<internalid>` — an addendum keeps its
 * internalid, so the upsert key (source, external_id) refreshes the row.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const ESBD_ORIGIN = "https://www.txsmartbuy.gov";
export const ESBD_PUBLIC_PAGE = `${ESBD_ORIGIN}/esbd`;
export const ESBD_SERVICE = `${ESBD_ORIGIN}/app/extensions/CPA/CPAMain/1.0.0/services/ESBD.Service.ss`;

export const ESBD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Content-Type": "application/json; charset=UTF-8",
  Accept: "application/json",
  Referer: ESBD_PUBLIC_PAGE,
} as const;

/** The status filters that return open solicitations (see header). */
export const ESBD_OPEN_STATUS_FILTERS = ["1", "6"] as const;
const OPEN_STATUS_NAMES = new Set(["posted", "addendum posted"]);
/** Hard ceiling on pages per status filter (24 rows each). */
export const ESBD_MAX_PAGES = 80;
const ESBD_PAGE_DELAY_MS = 300;

/** One ESBD list row, as the service returns it. */
export interface EsbdLine {
  internalid?: string;
  title?: string;
  solicitationId?: string;
  responseDue?: string;
  responseTime?: string;
  agencyNumber?: string;
  agencyName?: string;
  status?: string;
  statusName?: string;
  postingDate?: string;
  nigpCodes?: string;
  url?: string;
}

export interface EsbdResponse {
  lines?: EsbdLine[];
  page?: number;
  recordsPerPage?: number;
  totalRecordsFound?: number;
}

export interface EsbdParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function clean(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "University Of Texas At Tyler - 750" → "University Of Texas At Tyler". */
export function esbdAgencyName(name: string | null | undefined): string {
  return clean(name).replace(/\s+-\s+[A-Z]{0,2}\d[A-Z0-9]*$/, "").trim();
}

/** Offset of America/Chicago from UTC, in minutes, at a given UTC instant. */
function chicagoOffsetMinutes(utcMs: number): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -360;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -mins : mins;
}

/**
 * "10/28/2026" + "3:00 PM" (Texas local time) → ISO UTC instant. A date with
 * no time becomes 11:59 PM Central. Anything unparseable → null.
 */
export function esbdDueToIso(date: string | null | undefined, time: string | null | undefined): string | null {
  const d = clean(date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!d) return null;
  const [month, day, year] = [Number(d[1]), Number(d[2]), Number(d[3])];
  let hour = 23;
  let minute = 59;
  const t = clean(time).match(/^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i);
  if (t) {
    hour = (Number(t[1]) % 12) + (t[3].toUpperCase() === "P" ? 12 : 0);
    minute = Number(t[2]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Wall-clock Central → UTC: subtract the offset in force at that moment.
  const utc = wall - chicagoOffsetMinutes(wall - chicagoOffsetMinutes(wall) * 60_000) * 60_000;
  const check = new Date(utc);
  return Number.isNaN(check.getTime()) ? null : check.toISOString();
}

export function esbdDetailUrl(solicitationId: string): string {
  return `${ESBD_PUBLIC_PAGE}/${encodeURIComponent(solicitationId)}`;
}

function recordSkip(result: EsbdParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of ESBD rows — no network, no DB; `now` is injected. */
export function parseEsbdLines(lines: readonly EsbdLine[], now: number = Date.now()): EsbdParseResult {
  const result: EsbdParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const line of lines) {
    const internal = clean(line.internalid);
    if (!internal) {
      recordSkip(result, "esbd-unknown", "missing_id");
      continue;
    }
    const rowId = `esbd-${internal}`;
    if (seen.has(rowId)) continue; // status filters overlap (Posted vs Addendum Posted)
    seen.add(rowId);

    if (!OPEN_STATUS_NAMES.has(clean(line.statusName).toLowerCase())) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const title = clean(line.title);
    if (!title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const solicitationId = clean(line.solicitationId);
    if (!solicitationId) {
      recordSkip(result, rowId, "missing_solicitation_id");
      continue;
    }
    const due = esbdDueToIso(line.responseDue, line.responseTime);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }

    const agency = esbdAgencyName(line.agencyName) || "State of Texas (ESBD)";
    const codes = String(line.nigpCodes ?? "")
      .split(/;\s*/)
      .map((c) => clean(c).replace(/^\*/, ""))
      .filter(Boolean);
    const posted = clean(line.postingDate);
    const description = [
      // The buyer is not repeated here (trade matching reads the description and
      // agency names contain trade words, e.g. "Department of Public Safety").
      `Open solicitation ${solicitationId} posted on the Texas Electronic State Business Daily${posted ? ` on ${posted}` : ""}.`,
      codes.length ? `Commodity codes (NIGP): ${codes.join("; ")}.` : "",
      "Full documents are on the ESBD notice (see source link).",
    ]
      .filter(Boolean)
      .join(" ");

    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Texas",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: esbdDetailUrl(solicitationId),
      set_aside: null,
      notice_type: clean(line.statusName) || null,
      solicitation_number: solicitationId,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(status: string, page: number): Promise<EsbdResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp: Response;
  try {
    resp = await fetch(ESBD_SERVICE, {
      method: "POST",
      headers: ESBD_HEADERS,
      body: JSON.stringify({ lines: [], page, urlRoot: "esbd", status }),
      signal: controller.signal,
    });
  } catch (e) {
    const detail = requestFailureDetail(e);
    console.error(`  tx_esbd: ${detail}`);
    throw new SourceUnreachableError("tx_esbd", [detail]);
  } finally {
    clearTimeout(timer);
  }
  if (resp.status !== 200) {
    const detail = httpFailureDetail(resp.status, ESBD_SERVICE);
    console.error(`  tx_esbd: ${detail}`);
    throw new SourceUnreachableError("tx_esbd", [detail]);
  }
  const text = await resp.text();
  let body: EsbdResponse & { errorCode?: string };
  try {
    body = JSON.parse(text);
  } catch {
    const detail = `response was not JSON (${text.length} bytes)`;
    console.error(`  tx_esbd: ${detail}`);
    throw new SourceUnreachableError("tx_esbd", [detail]);
  }
  if (!Array.isArray(body?.lines)) {
    const detail = body?.errorCode ? `service error ${body.errorCode}` : "response shape changed: no lines array";
    console.error(`  tx_esbd: ${detail}`);
    throw new SourceUnreachableError("tx_esbd", [detail]);
  }
  return body;
}

/**
 * Fetch every open ESBD solicitation and return ingest rows. Any failure
 * throws SourceUnreachableError (recorded per source as DEAD; the sync goes on).
 */
export async function fetchTxEsbdBids(now: number = Date.now()): Promise<FetchResult> {
  const lines: EsbdLine[] = [];
  let reported = 0;
  for (const status of ESBD_OPEN_STATUS_FILTERS) {
    for (let page = 1; page <= ESBD_MAX_PAGES; page++) {
      const body = await fetchPage(status, page);
      const pageLines = body.lines!;
      if (page === 1) reported += body.totalRecordsFound ?? 0;
      lines.push(...pageLines);
      const perPage = body.recordsPerPage || pageLines.length || 24;
      const total = body.totalRecordsFound ?? 0;
      if (pageLines.length === 0 || page * perPage >= total) break;
      await sleep(ESBD_PAGE_DELAY_MS);
    }
  }
  const { rows, skipped, skippedRows } = parseEsbdLines(lines, now);
  console.log(
    `  tx_esbd: ${rows.length} open solicitations accepted (read ${lines.length} rows; source reported ${reported}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
