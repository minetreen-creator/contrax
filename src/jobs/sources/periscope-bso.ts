/**
 * Periscope S2G (BuySpeed "bso") public bid search — the shared reader behind
 * the state marketplaces that run it. Each state is a `BsoConfig`; the
 * registered sources live in periscope-states.ts.
 *
 * SOURCE (verified live 2026-10-01 on COMMBUYS, NJSTART, BidBuy Illinois,
 * OregonBuys, NevadaEPro and ARBuy; no login): the public "open bids" search
 *   GET <origin>/bso/view/search/external/advancedSearchBid.xhtml?openBids=true
 * renders the first 25 open bid solicitations in a PrimeFaces DataTable
 * (`bidSearchResultsForm:bidResultId`, `rowCount:<total>` in its config), with
 * a `_csrf` hidden field and a `javax.faces.ViewState`. The table's own paging
 * request — a partial/ajax POST of `_first=<n>&_rows=25` echoing both tokens
 * and `openBids=true` — returns the next 25 rows. 25 is the only page size the
 * server accepts. The reCAPTCHA on these sites guards the login form only.
 *
 * Columns differ slightly per state (NJ adds "Bid Holder List"), so cells are
 * read by their header name, never by position.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = Description, verbatim.
 *   - `agency`      = Organization Name (state agencies, and the towns, school
 *                     districts and authorities that buy through the site).
 *   - `location`    = the state's name (the list has no place of performance).
 *   - `due_date`    = Bid Opening Date ("10/28/2026 12:00 PM") in the state's
 *                     time zone, as UTC.
 *   - `solicitation_number` = Bid Solicitation #; `notice_type` = "Bid Solicitation".
 *   - `description`  = the number and marketplace (not the buyer, and not the
 *                     alternate id, which often carries the buyer's initials).
 *   - `source_url`  = <origin>/bso/external/bidDetail.sda?docId=<#>&external=true
 *                     (the site's own public bid page).
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Rows whose status is not an open one ("Sent"; "Opened", "Evaluated" and
 * "Approved" mean bidding has closed), whose opening date has passed, or whose
 * title says it is a notice rather than a bid (sole-source notices, intents to
 * award/contract, cooperative "contract notices") are skipped with a reason code.
 *
 * IDENTITY: `external_id = <idPrefix>-<Bid Solicitation #>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export interface BsoConfig {
  /** Contrax source label (e.g. "ma_commbuys"). */
  source: string;
  /** Marketplace origin (e.g. "https://www.commbuys.com"). */
  origin: string;
  /** external_id prefix (e.g. "commbuys"). */
  idPrefix: string;
  /** The state's name, used as `location`. */
  stateName: string;
  /** The marketplace's name, used in descriptions (e.g. "COMMBUYS"). */
  portalName: string;
  /** Standard-time UTC offset in hours (ET -5, CT -6, MT -7, PT -8); US DST applies. */
  standardOffsetHours: number;
}

export const BSO_PAGE_SIZE = 25;
export const BSO_MAX_PAGES = 120;
const BSO_PAGE_DELAY_MS = 300;
const TABLE = "bidSearchResultsForm:bidResultId";

export const BSO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Titles that announce a decision, not an invitation to bid. */
const NOTICE_TITLE = /^\s*(sole|single)[\s-]source\b|notice of intent|intent to (award|contract)|\bcontract notice\b/i;

/** Statuses that mean the solicitation is out for bid. */
const OPEN_STATUSES = new Set(["sent", "open", "posted", "issued", "released", "bid open"]);

export function bsoSearchUrl(config: Pick<BsoConfig, "origin">): string {
  return `${config.origin}/bso/view/search/external/advancedSearchBid.xhtml?openBids=true`;
}

export function bsoBidUrl(config: Pick<BsoConfig, "origin">, bidNumber: string): string {
  return `${config.origin}/bso/external/bidDetail.sda?docId=${encodeURIComponent(bidNumber)}&external=true`;
}

export interface BsoRow {
  number: string;
  organization: string;
  description: string;
  opening: string;
  status: string;
  alternateId: string;
}

export interface BsoParseResult {
  rows: RawBid[];
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
    .replace(/\s+/g, " ")
    .trim();
}

/** The header names of the results table, in column order. */
export function bsoHeaders(html: string): string[] {
  const start = html.indexOf("<thead", html.indexOf(`id="${TABLE}"`));
  if (start < 0) return [];
  const thead = html.slice(start, html.indexOf("</thead>", start));
  return [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => {
    const title = m[1].match(/<span class="ui-column-title">([\s\S]*?)<\/span>/);
    return decode(title ? title[1] : m[1]);
  });
}

/** Total rows the table reports (`rowCount:<n>`), or null. */
export function bsoRowCount(html: string): number | null {
  const m = html.match(/rowCount:(\d+)/);
  return m ? Number(m[1]) : null;
}

/** True when the HTML is the public open-bid search with its results table. */
export function isBsoSearchPage(html: string): boolean {
  return html.includes(`"${TABLE}"`) && /rowCount:\d+/.test(html);
}

/** Read the `<tr data-ri=…>` rows using the given header order. */
export function readBsoRows(fragment: string, headers: readonly string[]): BsoRow[] {
  const col = (name: string) => headers.indexOf(name);
  const iNumber = col("Bid Solicitation #");
  const iOrg = col("Organization Name");
  const iDesc = col("Description");
  const iOpen = col("Bid Opening Date");
  const iStatus = col("Status");
  const iAlt = col("Alternate Id");
  const rows: BsoRow[] = [];
  for (const m of fragment.matchAll(/<tr data-ri="\d+"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1]));
    const at = (i: number) => (i >= 0 && i < cells.length ? cells[i] : "");
    rows.push({
      number: at(iNumber),
      organization: at(iOrg),
      description: at(iDesc),
      opening: at(iOpen),
      status: at(iStatus),
      alternateId: at(iAlt),
    });
  }
  return rows;
}

/** "10/28/2026 12:00 PM" in a US zone (standard offset, US DST rules) → UTC ISO. */
export function bsoDateToIso(text: string, standardOffsetHours: number): string | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])M)?$/i);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hour = 23;
  let minute = 59;
  if (m[4]) {
    hour = (Number(m[4]) % 12) + (m[6].toUpperCase() === "P" ? 12 : 0);
    minute = Number(m[5]);
  }
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  const offset = standardOffsetHours + (day0 >= dstStart && day0 < dstEnd ? 1 : 0);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 3_600_000).toISOString();
}

function recordSkip(result: BsoParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of the read rows — no network, no DB; `now` is injected. */
export function parseBsoRows(config: BsoConfig, rows: readonly BsoRow[], now: number = Date.now()): BsoParseResult {
  const result: BsoParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (!r.number) {
      recordSkip(result, `${config.idPrefix}-row-${i}`, "missing_id");
      continue;
    }
    const rowId = `${config.idPrefix}-${r.number}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    if (!OPEN_STATUSES.has(r.status.toLowerCase())) {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (!r.description) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    if (NOTICE_TITLE.test(r.description)) {
      recordSkip(result, rowId, "notice_not_bid");
      continue;
    }
    const due = bsoDateToIso(r.opening, config.standardOffsetHours);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    // The buyer is not repeated here: trade matching reads the description.
    const description =
      `Bid Solicitation ${r.number} on ${config.portalName}, ` +
      `the ${config.stateName} public procurement marketplace. Specifications and documents are on the bid page (see source link).`;
    result.rows.push({
      external_id: rowId,
      title: r.description,
      agency: r.organization || `State of ${config.stateName}`,
      description,
      location: config.stateName,
      category: mapCategory("", r.description, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: bsoBidUrl(config, r.number),
      set_aside: null,
      notice_type: "Bid Solicitation",
      solicitation_number: r.number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The table's paging request body (same fields the page's own paginator sends). */
export function bsoPageBody(first: number, csrf: string, viewState: string): URLSearchParams {
  return new URLSearchParams({
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": TABLE,
    "javax.faces.partial.execute": TABLE,
    "javax.faces.partial.render": TABLE,
    [TABLE]: TABLE,
    [`${TABLE}_pagination`]: "true",
    [`${TABLE}_first`]: String(first),
    [`${TABLE}_rows`]: String(BSO_PAGE_SIZE),
    [`${TABLE}_skipChildren`]: "true",
    [`${TABLE}_encodeFeature`]: "true",
    bidSearchResultsForm: "bidSearchResultsForm",
    _csrf: csrf,
    openBids: "true",
    "javax.faces.ViewState": viewState,
  });
}

/** Fetch every open bid on one Periscope marketplace and return ingest rows. */
export async function fetchBsoBids(config: BsoConfig, now: number = Date.now()): Promise<FetchResult> {
  const url = bsoSearchUrl(config);
  const fail = (detail: string): never => {
    console.error(`  ${config.source}: ${detail}`);
    throw new SourceUnreachableError(config.source, [detail]);
  };
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
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  const rows: BsoRow[] = [];
  let total = 0;
  try {
    const first = await fetch(url, { headers: { "User-Agent": BSO_USER_AGENT, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(60000) });
    keepCookies(first);
    if (first.status !== 200) fail(httpFailureDetail(first.status, url));
    const html = await first.text();
    if (!isBsoSearchPage(html)) fail(`page shape changed: no open-bid results table (${html.length} bytes)`);
    const headers = bsoHeaders(html);
    if (!headers.includes("Bid Solicitation #") || !headers.includes("Bid Opening Date")) {
      fail(`page shape changed: unexpected columns [${headers.join(", ")}]`);
    }
    total = bsoRowCount(html) ?? 0;
    rows.push(...readBsoRows(html, headers));
    const csrf = html.match(/name="_csrf"[^>]*value="([^"]+)"/)?.[1] ?? "";
    const viewState = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1] ?? "";
    if (total > rows.length && (!csrf || !viewState)) fail("page shape changed: no _csrf / ViewState for paging");
    const postUrl = url.split("?")[0];
    for (let page = 1; page < BSO_MAX_PAGES && rows.length < total; page++) {
      await sleep(BSO_PAGE_DELAY_MS);
      const resp = await fetch(postUrl, {
        method: "POST",
        headers: {
          "User-Agent": BSO_USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Faces-Request": "partial/ajax",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/xml, text/xml, */*",
          Origin: config.origin,
          Referer: url,
          ...(jar.size ? { Cookie: cookie() } : {}),
        },
        body: bsoPageBody(page * BSO_PAGE_SIZE, csrf, viewState).toString(),
        signal: AbortSignal.timeout(60000),
      });
      keepCookies(resp);
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, postUrl));
      const xml = await resp.text();
      if (xml.includes("<error>")) fail(`paging request rejected at row ${page * BSO_PAGE_SIZE}`);
      const pageRows = readBsoRows(xml, headers);
      if (pageRows.length === 0) break;
      rows.push(...pageRows);
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  }

  const { rows: bids, skipped, skippedRows } = parseBsoRows(config, rows, now);
  if (rows.length < total) skipped.not_fetched = (skipped.not_fetched ?? 0) + (total - rows.length);
  console.log(
    `  ${config.source}: ${bids.length} open bids accepted (read ${rows.length} of ${total}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows: bids, skipped, skippedRows };
}
