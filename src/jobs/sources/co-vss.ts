/**
 * Colorado Vendor Self Service (VSS) — `co_vss`, the State of Colorado's
 * public solicitation board (CGI Advantage 4, run by the Department of
 * Personnel & Administration, State Purchasing & Contracts Office).
 *
 * WHY: Contrax had no state Colorado feed; its Colorado rows came from the
 * federal SAM.gov "co" keyword pass. State departments and colleges (CDOT,
 * Corrections, CDPHE, CDHS, DOLA, community colleges, …) post on VSS.
 *
 * SOURCE (verified live 2026-10-01, no login): the VSS home page
 * (prd.co.cgiadvantage.com/PRDVSS1X1/Advantage4) embeds a `session_info`
 * object ({session_id, page_id, csrf_token}). The "View Published
 * Solicitations" tile then POSTs JSON actions back to the same URL:
 *   1. pageOpen of `vss.page.VVSSX10019` (the solicitation inquiry, default
 *      filter "Open") → 20 rows, plus the page's own `session_info`,
 *      `checksum` and `viewState`;
 *   2. the grid's `show_lines` action echoing those three, with 500 rows per
 *      page → every open solicitation (56 on 2026-10-01).
 * The VSS firewall blocks requests without a browser User-Agent. If the grid
 * says more rows exist than were sent, the run logs it and ingests what it
 * has (skip reason `not_fetched`); a missing grid fails loudly.
 *
 * WHAT IS KEPT: document types a business can respond to — Invitation for
 * Bids (IFB1), Documented Quote (DQ1), Request for Proposals (RFP), Request
 * for Quotes (RFQ), Request for Qualifications (RFQ1), Request for
 * Information (RFI), Invitation to Negotiate (ITN). Contractor-settlement
 * notices (NCS1), sole-source notices (NPSS1), Best and Final Offer rounds
 * (BAFO, shortlisted offerors only) and Grant Funding Opportunities (GFO)
 * are skipped with a reason code, as are statuses other than Open, Amended
 * and Reopened, and rows whose closing time has passed.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = DOC_DSCR, verbatim.
 *   - `agency`      = DEPT_NM (e.g. "DOC - Corrections Administration").
 *   - `location`    = "Colorado" (the grid has no place of performance; every
 *                     buyer is a Colorado state entity).
 *   - `due_date`    = SO_CLSNG_DT_TM (epoch milliseconds, absolute).
 *   - `solicitation_number` = the displayed reference (e.g.
 *                     "RFP-IHFA-2027000022-3", whose last part is the version);
 *                     `notice_type` = DOC_CD_CONCAT.
 *   - `description` = type, number and publish date (not the buyer: trade
 *                     matching reads the description).
 *   - `source_url`  = the VSS home page. VSS has no per-solicitation link
 *                     (rows open inside the app), so the description says to
 *                     find the number under "View Published Solicitations".
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 *
 * IDENTITY: `external_id = covss-<code>-<dept>-<number>` (the reference
 * without its version), so an amendment refreshes the same row.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const COVSS_SOURCE = "co_vss";
export const COVSS_ORIGIN = "https://prd.co.cgiadvantage.com";
export const COVSS_URL = `${COVSS_ORIGIN}/PRDVSS1X1/Advantage4`;
export const COVSS_ROWS = 500;
const COVSS_DS = "T1SO_SRCH_QRY";
const COVSS_PAGE = "vss.page.VVSSX10019";
/** The inquiry's "Show Me" filter value for Open solicitations. */
const COVSS_SHOW_OPEN = "3";

export const COVSS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Document types a business can respond to. */
export const COVSS_BIDDABLE_TYPES = new Set(["IFB1", "DQ1", "RFP", "RFQ", "RFQ1", "RFI", "ITN"]);
/** Open (O), Amended (M), Reopened (R). */
const OPEN_STATUSES = new Set(["O", "M", "R"]);

export interface CoVssRow {
  SO_STA?: string;
  DOC_CD?: string;
  DOC_DSCR?: string;
  DEPT_NM?: string;
  DOC_REF?: string;
  DOC_CD_CONCAT?: string;
  SO_CLSNG_DT_TM?: number | string | null;
  PUB_DT?: number | string | null;
}

export interface CoVssGrid {
  row_data?: CoVssRow[];
  rows_total?: number;
  rows_sent?: number;
  total_count_suffix?: string;
}

export interface CoVssParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const clean = (v: unknown) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * "[RFP,IHFA,2027000022,3][RFP-IHFA-2027000022-3]" → parts + display number.
 * Null when the shape is not recognised.
 */
export function parseCoVssDocRef(ref: string | null | undefined): {
  code: string;
  dept: string;
  id: string;
  version: string;
  display: string;
} | null {
  const m = clean(ref).match(/^\[([^,\]]+),([^,\]]+),([^,\]]+),([^\]]*)\]\[([^\]]+)\]$/);
  if (!m) return null;
  return { code: m[1].trim(), dept: m[2].trim(), id: m[3].trim(), version: m[4].trim(), display: m[5].trim() };
}

function epochIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : /^\d+$/.test(clean(v)) ? Number(clean(v)) : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

function recordSkip(result: CoVssParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** The inquiry grid inside a VSS action response, or null. */
export function coVssGrid(response: unknown): CoVssGrid | null {
  const grid = (response as any)?.data?.ds_data?.[COVSS_DS];
  return grid && Array.isArray(grid.row_data) ? (grid as CoVssGrid) : null;
}

/** PURE parse of the grid rows — no network, no DB; `now` is injected. */
export function parseCoVssGrid(grid: CoVssGrid, now: number = Date.now()): CoVssParseResult {
  const result: CoVssParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const [i, r] of (grid.row_data ?? []).entries()) {
    const ref = parseCoVssDocRef(r.DOC_REF);
    if (!ref) {
      recordSkip(result, `covss-row-${i}`, "missing_id");
      continue;
    }
    const rowId = `covss-${ref.code}-${ref.dept}-${ref.id}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    if (!OPEN_STATUSES.has(clean(r.SO_STA).toUpperCase())) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const code = clean(r.DOC_CD) || ref.code;
    if (!COVSS_BIDDABLE_TYPES.has(code.toUpperCase())) {
      recordSkip(result, rowId, "not_biddable_type");
      continue;
    }
    const title = clean(r.DOC_DSCR);
    if (!title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const due = epochIso(r.SO_CLSNG_DT_TM);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const type = clean(r.DOC_CD_CONCAT) || code;
    const published = epochIso(r.PUB_DT);
    // The buyer is not repeated here: trade matching reads the description and
    // department names contain trade words ("CDPS - Colorado State Patrol").
    const description =
      `${type} ${ref.display} posted on Colorado Vendor Self Service (VSS)${published ? ` on ${published.slice(0, 10)}` : ""}. ` +
      `To read it, open VSS, choose "View Published Solicitations" and search for ${ref.display}.`;
    result.rows.push({
      external_id: rowId,
      title,
      agency: clean(r.DEPT_NM) || "State of Colorado",
      description,
      location: "Colorado",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: COVSS_URL,
      set_aside: null,
      notice_type: type || null,
      solicitation_number: ref.display,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

/** The `session_info` object embedded in the VSS home page, or null. */
export function coVssSessionInfo(html: string): Record<string, string> | null {
  const m = html.match(/"session_info":(\{[^{}]*\})/);
  if (!m) return null;
  try {
    const info = JSON.parse(m[1]);
    return info && typeof info.session_id === "string" && typeof info.csrf_token === "string" ? info : null;
  } catch {
    return null;
  }
}

/** Action 1: open the solicitation inquiry (default filter: Open). */
export function coVssOpenBody(session: Record<string, string>) {
  return {
    action: {
      params: { targetLocation: "noDisplay", targetComponentType: "SystemInquiryPage" },
      actionType: "pageOpen",
      targetQualifiedName: COVSS_PAGE,
    },
    session_info: { session_id: session.session_id, csrf_token: session.csrf_token },
    key: "vss.page.VAXXX03153.carouselView.carousel.solicitations",
  };
}

/** Action 2: the grid's rows-per-page action, echoing the page's state. */
export function coVssShowLinesBody(opened: any, rows: number = COVSS_ROWS) {
  return {
    action: {
      key: `${COVSS_PAGE}.gridView1.group1.cardGrid.grid1pagination`,
      actionType: "dsAction",
      actionCode: "show_lines",
      dsNameList: COVSS_DS,
      genericParam_1: String(rows),
      bypassPopupClose: false,
      isCarouselNavigation: true,
    },
    checksum: opened?.checksum,
    viewState: opened?.viewState,
    data: { page_data: {}, ds_query_data: { [COVSS_DS]: { SHOW_TXT: COVSS_SHOW_OPEN } } },
    session_info: opened?.session_info,
  };
}

function fail(detail: string): never {
  console.error(`  ${COVSS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(COVSS_SOURCE, [detail]);
}

/** Fetch every open VSS solicitation and return ingest rows. */
export async function fetchCoVssBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const jar = new Map<string, string>();
  const keepCookies = (resp: Response) => {
    const set =
      typeof (resp.headers as any).getSetCookie === "function"
        ? ((resp.headers as any).getSetCookie() as string[])
        : (resp.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_.-]+=)/);
    for (const c of set) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const headers = (json: boolean): Record<string, string> => ({
    "User-Agent": COVSS_USER_AGENT,
    Accept: json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,*/*;q=0.8",
    ...(json ? { "Content-Type": "application/json", Origin: COVSS_ORIGIN, Referer: COVSS_URL } : {}),
    ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
  });
  const postAction = async (body: unknown): Promise<any> => {
    const resp = await fetch(COVSS_URL, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    keepCookies(resp);
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, COVSS_URL));
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      fail(`response was not JSON (${text.length} bytes)`);
    }
  };

  let grid: CoVssGrid | null;
  try {
    const home = await fetch(COVSS_URL, { headers: headers(false), signal: controller.signal });
    keepCookies(home);
    if (home.status !== 200) fail(httpFailureDetail(home.status, COVSS_URL));
    const html = await home.text();
    const session = coVssSessionInfo(html);
    if (!session) fail(`page shape changed: no session_info on the VSS home page (${html.length} bytes)`);
    const opened = await postAction(coVssOpenBody(session));
    if (!coVssGrid(opened)) fail("page shape changed: the solicitation inquiry returned no grid");
    grid = coVssGrid(await postAction(coVssShowLinesBody(opened)));
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!grid) fail("page shape changed: the rows-per-page action returned no grid");

  const { rows, skipped, skippedRows } = parseCoVssGrid(grid, now);
  const sent = grid.row_data?.length ?? 0;
  const total = Number(grid.rows_total ?? sent);
  if (grid.total_count_suffix === "+" || total > sent) {
    const missing = Math.max(total - sent, 1);
    console.warn(`  ${COVSS_SOURCE}: grid holds more than ${sent} open rows; ingesting the first ${sent}`);
    skipped.not_fetched = (skipped.not_fetched ?? 0) + missing;
  }
  console.log(
    `  ${COVSS_SOURCE}: ${rows.length} open solicitations accepted (grid rows: ${sent}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
