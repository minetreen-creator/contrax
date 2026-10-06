/**
 * Oklahoma statewide bidding events — `ok_omes`, the public "Bidding Event
 * Information" list of the State of Oklahoma's PeopleSoft supplier portal,
 * run by the Office of Management and Enterprise Services (OMES).
 *
 * WHY: Contrax had no Oklahoma feed (owner 2026-10-06: "lets do oklahoma").
 *
 * SOURCE (verified live 2026-10-06, no login, no CAPTCHA: 10 open events from
 * OMES, Health, Commerce, Corrections, Rehabilitation Services and the
 * District Attorneys Council): the public page
 *   https://financials.ok.gov/psc/SOKLFP1DS/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL
 * answers a first GET with a 302 that sets its session cookie, then serves
 * the event grid as plain HTML. The connector follows that redirect with the
 * cookie and reads the grid. Event detail opens through the page's own
 * postback (no public per-event URL), so rows link to the list.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = Event Name as posted ("SW1043M- LIVESCAN"). The portal keeps
 *     at most 50 characters; a 50-character name may be cut or complete, so it
 *     is kept as posted.
 *   - `agency` = Business Unit with "Oklahoma " in front ("Department of
 *     Health" → "Oklahoma Department of Health"; "Mgmt and Enterprise
 *     Services" → "Oklahoma Office of Management and Enterprise Services").
 *   - `due_date` = End Date. The portal prints "03:00 PM CST" all year;
 *     PeopleSoft's "CST" zone is US Central with daylight time, so the time is
 *     read as Central local time.
 *   - `solicitation_number` = Event ID; `notice_type` = Event Type ("RFx").
 *   - `location` = "Oklahoma"; `naics_code` / `psc` / `set_aside` NULL.
 *   The Event Format column reads "Sell" on every procurement event, so it is
 *   not used.
 * Skipped: end date passed (`closed`), unreadable end date (`bad_date`), no
 * event id or name (`missing_fields`), repeated id (`duplicate`).
 *
 * IDENTITY: `external_id = okomes-<Event ID>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const OK_OMES_SOURCE = "ok_omes";
export const OK_OMES_URL = "https://financials.ok.gov/psc/SOKLFP1DS/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface OkEvent {
  id: string;
  name: string;
  businessUnit: string;
  type: string;
  start: string;
  end: string;
}

export interface OkParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** The event grid's rows, read from the page's span ids (FIELD$row). */
export function parseOkGrid(html: string): OkEvent[] {
  const byRow = new Map<number, Record<string, string>>();
  for (const m of html.matchAll(/<span[^>]*id=['"]([A-Z0-9_]+)\$(\d+)['"][^>]*>([\s\S]*?)<\/span>/g)) {
    const row = Number(m[2]);
    const cells = byRow.get(row) ?? {};
    cells[m[1]] = decode(m[3]);
    byRow.set(row, cells);
  }
  const out: OkEvent[] = [];
  for (const [, c] of [...byRow].sort((a, b) => a[0] - b[0])) {
    if (!c.SCP_PUB_AUC_VW_AUC_ID && !c.SCP_PUB_AUC_VW_AUC_NAME) continue;
    out.push({
      id: c.SCP_PUB_AUC_VW_AUC_ID ?? "",
      name: c.SCP_PUB_AUC_VW_AUC_NAME ?? "",
      businessUnit: c.BUS_UNIT_AUC_VW_DESCR ?? "",
      type: c.SCP_PUB_AUC_VW_AUC_TYPE ?? "",
      start: c.SCP_COSP_WK_FL_SCP_STRT_DATE_CHAR ?? "",
      end: c.SCP_COSP_WK_FL_SCP_END_DATE_CHAR ?? "",
    });
  }
  return out;
}

/** US Central offset (hours behind UTC) on a calendar day. */
function centralOffset(y: number, m: number, d: number): number {
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const day = Date.UTC(y, m - 1, d);
  return day >= Date.UTC(y, 2, nthSunday(3, 2)) && day < Date.UTC(y, 10, nthSunday(11, 1)) ? 5 : 6;
}

/** "10/06/2026 03:00 PM CST" (Central local) → epoch ms, or NaN. */
export function okDueMs(s: string | null | undefined): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s+C[SD]T)?$/i.exec(String(s ?? "").trim());
  if (!m) return NaN;
  const [mo, d, y] = [+m[1], +m[2], +m[3]];
  let hour = +m[4] % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  return Date.UTC(y, mo - 1, d, hour + centralOffset(y, mo, d), +m[5]);
}

/** Business unit → agency name. */
export function okAgencyName(unit: string): string {
  const name = unit.replace(/\s+/g, " ").trim();
  if (!name) return "State of Oklahoma";
  if (/^mgmt and enterprise services$/i.test(name)) return "Oklahoma Office of Management and Enterprise Services";
  return /^oklahoma\b/i.test(name) ? name : `Oklahoma ${name}`;
}

function recordSkip(result: OkParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseOkEvents(events: OkEvent[], now: number = Date.now()): OkParseResult {
  const result: OkParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const e of events) {
    const rowId = `okomes-${e.id}`;
    if (!e.id || !e.name) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const dueMs = okDueMs(e.end);
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = okAgencyName(e.businessUnit);
    const description = [
      `State of Oklahoma ${e.type || "bidding"} event ${e.id} posted by ${agency}${e.start ? ` (opened ${e.start})` : ""}.`,
      "Event documents and responses through the Oklahoma supplier portal; open the event from the public Bidding Event Information list (see source link).",
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.name,
      agency,
      description,
      location: "Oklahoma",
      category: mapCategory("", e.name, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: OK_OMES_URL,
      set_aside: null,
      notice_type: e.type || null,
      solicitation_number: e.id,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${OK_OMES_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(OK_OMES_SOURCE, [detail]);
}

/**
 * GET a PeopleSoft public bid list, following its cookie-setting redirect.
 * Shared with other states on the same PeopleSoft page (ks_sok).
 */
export async function fetchPeopleSoftBidList(listUrl: string, failWith: (detail: string) => never): Promise<string> {
  const cookies = new Map<string, string>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let html = "";
  try {
    let url = listUrl;
    for (let hop = 0; ; hop++) {
      const resp = await fetch(url, {
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          Accept: "text/html",
          ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        },
        signal: controller.signal,
      });
      const set: string[] = typeof (resp.headers as any).getSetCookie === "function" ? (resp.headers as any).getSetCookie() : [];
      for (const c of set) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location") && hop < 5) {
        url = new URL(resp.headers.get("location")!, url).toString();
        await resp.text();
        continue;
      }
      if (resp.status !== 200) failWith(httpFailureDetail(resp.status, url));
      html = await resp.text();
      break;
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    failWith(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!/SCP_PUB_AUC_VW/.test(html)) failWith("page shape changed: no event grid");
  return html;
}

/** GET the list, following its cookie-setting redirect, and return ingest rows. */
export async function fetchOkOmesBids(now: number = Date.now()): Promise<FetchResult> {
  const html = await fetchPeopleSoftBidList(OK_OMES_URL, fail);
  const events = parseOkGrid(html);
  const { rows, skipped, skippedRows } = parseOkEvents(events, now);
  console.log(
    `  ${OK_OMES_SOURCE}: ${rows.length} open events accepted (listed: ${events.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
