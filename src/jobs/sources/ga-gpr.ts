/**
 * Georgia Procurement Registry — `ga_gpr`, the State of Georgia's public
 * bid board (ssl.doas.state.ga.us/gpr, run by the Department of
 * Administrative Services). State agencies, and the counties, cities, school
 * districts and authorities that post there ("Non-State Agency"), list their
 * bidding events on it.
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA): the registry's
 * own search table loads from
 *   POST https://ssl.doas.state.ga.us/gpr/eventSearch
 * (DataTables server-side parameters + the search form's fields). One request
 * with `eventStatus=OPEN` and `length=2000` returns every open event as JSON
 * (503 on 2026-10-01, `recordsTotal` in the body).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = title, verbatim.
 *   - `agency`      = agencyName (state agency, county, city, school system…).
 *   - `location`    = "Georgia" (the list has no place of performance).
 *   - `due_date`    = closingDateSort (epoch milliseconds, absolute).
 *   - `solicitation_number` = esourceNumber; `notice_type` = bidProcessType.
 *   - `description` = process type, number and government type (not the buyer).
 *   - `source_url`  = https://ssl.doas.state.ga.us/gpr/eventDetails?eSourceNumber=<key>&sourceSystemType=<sourceId>
 *                     (the registry's own public event page).
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Skipped with a reason code: status other than Open, sole-source events and
 * titles that announce a notice rather than a bid, and events already closed.
 *
 * IDENTITY: `external_id = gpr-<sourceId>-<esourceNumberKey>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const GPR_SOURCE = "ga_gpr";
export const GPR_ORIGIN = "https://ssl.doas.state.ga.us";
export const GPR_SEARCH_URL = `${GPR_ORIGIN}/gpr/eventSearch`;
export const GPR_MAX_ROWS = 2000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Titles that announce a decision, not an invitation to bid. */
const NOTICE_TITLE = /^\s*(sole|single)[\s-]source\b|notice of intent|intent to (award|contract)/i;

export interface GprEvent {
  sourceId?: string | null;
  esourceNumber?: string | null;
  esourceNumberKey?: string | null;
  title?: string | null;
  agencyName?: string | null;
  status?: string | null;
  governmentType?: string | null;
  bidProcessType?: string | null;
  closingDateSort?: number | null;
  postingDateSort?: number | null;
  soleSource?: boolean | null;
}

export interface GprParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const clean = (v: unknown) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const GOV_TYPE_LABEL: Record<string, string> = {
  state: "Georgia state government",
  county: "a Georgia county government",
  city: "a Georgia city",
  "k-12": "a Georgia school system",
  other: "a Georgia public authority",
};

export function gprEventUrl(sourceId: string, key: string): string {
  return `${GPR_ORIGIN}/gpr/eventDetails?eSourceNumber=${encodeURIComponent(key)}&sourceSystemType=${encodeURIComponent(sourceId)}`;
}

/** The registry's own search request body for every OPEN event. */
export function gprSearchBody(length: number = GPR_MAX_ROWS): URLSearchParams {
  return new URLSearchParams({
    draw: "1",
    "order[0][column]": "5",
    "order[0][dir]": "asc",
    start: "0",
    length: String(length),
    "search[value]": "",
    "search[regex]": "false",
    responseType: "ALL",
    eventStatus: "OPEN",
    eventIdTitle: "",
    govType: "ALL",
    govEntity: "",
    catType: "ALL",
    eventProcessType: "ALL",
    dateRangeType: "",
    rangeStartDate: "",
    rangeEndDate: "",
    isReset: "false",
    persisted: "false",
    refreshSearchData: "true",
  });
}

function epochIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

function recordSkip(result: GprParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseGprEvents(events: readonly GprEvent[], now: number = Date.now()): GprParseResult {
  const result: GprParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const [i, e] of events.entries()) {
    const sourceId = clean(e.sourceId);
    const key = clean(e.esourceNumberKey) || clean(e.esourceNumber);
    if (!sourceId || !key) {
      recordSkip(result, `gpr-row-${i}`, "missing_id");
      continue;
    }
    const rowId = `gpr-${sourceId}-${key}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    if (clean(e.status).toLowerCase() !== "open") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const title = clean(e.title);
    if (!title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    if (e.soleSource || NOTICE_TITLE.test(title)) {
      recordSkip(result, rowId, "notice_not_bid");
      continue;
    }
    const due = epochIso(e.closingDateSort);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const type = clean(e.bidProcessType);
    const number = clean(e.esourceNumber) || key;
    const posted = epochIso(e.postingDateSort);
    const gov = GOV_TYPE_LABEL[clean(e.governmentType).toLowerCase()] ?? "a Georgia public body";
    // The buyer is not repeated here: trade matching reads the description.
    const description =
      `${type ? `${type} ` : ""}bidding event ${number} from ${gov}, posted on the Georgia Procurement Registry` +
      `${posted ? ` on ${posted.slice(0, 10)}` : ""}. Documents and bidding instructions are on the event page (see source link).`;
    result.rows.push({
      external_id: rowId,
      title,
      agency: clean(e.agencyName) || "State of Georgia",
      description,
      location: "Georgia",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: gprEventUrl(sourceId, key),
      set_aside: null,
      notice_type: type || null,
      solicitation_number: number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${GPR_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(GPR_SOURCE, [detail]);
}

/** Fetch every open Georgia Procurement Registry event and return ingest rows. */
export async function fetchGaGprBids(now: number = Date.now()): Promise<FetchResult> {
  let body: any;
  try {
    const resp = await fetch(GPR_SEARCH_URL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*",
        Referer: `${GPR_ORIGIN}/gpr/`,
        Origin: GPR_ORIGIN,
      },
      body: gprSearchBody().toString(),
      signal: AbortSignal.timeout(60000),
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, GPR_SEARCH_URL));
    const text = await resp.text();
    try {
      body = JSON.parse(text);
    } catch {
      fail(`response was not JSON (${text.length} bytes)`);
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  }
  if (!body || !Array.isArray(body.data)) fail("response shape changed: no data array");
  const events = body.data as GprEvent[];
  const total = Number(body.recordsFiltered ?? body.recordsTotal ?? events.length);
  const { rows, skipped, skippedRows } = parseGprEvents(events, now);
  if (total > events.length) skipped.not_fetched = (skipped.not_fetched ?? 0) + (total - events.length);
  console.log(
    `  ${GPR_SOURCE}: ${rows.length} open events accepted (read ${events.length} of ${total}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
