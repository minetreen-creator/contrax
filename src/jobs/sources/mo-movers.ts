/**
 * Missouri MissouriBUYS (powered by MOVERS) solicitations — `mo_movers`, the
 * State of Missouri's statewide bid board for solicitations issued on or
 * after 2024-09-18 (missouribuys.mo.gov/bid-board → "NEW MissouriBUYS, powered
 * by MOVERS Bid Board").
 *
 * WHY: Contrax had no Missouri state feed (owner 2026-10-04: "one big state we
 * can add today"). Every state agency posts here: Office of Administration,
 * MoDOT, Corrections, Conservation, Mental Health, Facilities Management, …
 *
 * SOURCE (verified live 2026-10-04, no login, no CAPTCHA: 76 rows closing
 * after today): the bid board is an Oracle Fusion "negotiation abstracts"
 * page; its public REST resource answers without authentication:
 *   GET https://ewqg.fa.us8.oraclecloud.com/fscmRestApi/resources/latest/
 *       supplierNegotiationAbstracts?finder=RowFinderByBU;ProcurementBUId=
 *       300000005255687&q=CloseDate>'<now>'&limit=500&onlyData=true
 * (the finder is required; ProcurementBUId 300000005255687 is the business
 * unit the public bid board itself uses, and it returns every agency's rows).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = NegotiationTitle; `solicitation_number` = Negotiation
 *     ("STATE PURCHASE-FY27-0123-SL"); `notice_type` = NegotiationType.
 *   - `agency` = the procurement BU name without its numeric code
 *     ("31-MODOT TRANSPORTATION" → "MoDOT Transportation").
 *   - `location` = "Missouri"; `due_date` = CloseDate (a full timestamp).
 *   - `description` = the Synopsis plus type, number, posting date and buyer.
 *   - `source_url` = the public bid board listing (the state's own page).
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Skipped: Canceled/Closed status (`not_open`), close date passed (`closed`),
 * and notices that are not open competitions — Single Feasible Source and
 * Special Delegation of Authority (`not_competitive`).
 *
 * IDENTITY: `external_id = momovers-<AuctionHeaderId>` (Oracle's own id).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const MO_MOVERS_SOURCE = "mo_movers";
export const MO_MOVERS_HOST = "https://ewqg.fa.us8.oraclecloud.com";
export const MO_MOVERS_BU = "300000005255687";
export const MO_MOVERS_BOARD_URL = `${MO_MOVERS_HOST}/fscmUI/redwood/negotiation-abstracts/view/abstractlisting?prcBuId=${MO_MOVERS_BU}&ojSpLang=en`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

export interface MoAbstract {
  AuctionHeaderId: number;
  NegotiationTitle: string | null;
  Negotiation: string | null;
  NegotiationType: string | null;
  CloseDate: string | null;
  PostingDate: string | null;
  ProcurementBUName: string | null;
  BuyerName: string | null;
  BuyerEmailAddress: string | null;
  Synopsis: string | null;
  NegotiationStatus: string | null;
}

export interface MoParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** The REST query URL for open abstracts (closing after `now`). */
export function moMoversUrl(now: number, offset = 0): string {
  const since = new Date(now).toISOString().slice(0, 19);
  const q = encodeURIComponent(`CloseDate>'${since}'`);
  return `${MO_MOVERS_HOST}/fscmRestApi/resources/latest/supplierNegotiationAbstracts?finder=RowFinderByBU;ProcurementBUId=${MO_MOVERS_BU}&q=${q}&limit=${PAGE_SIZE}&offset=${offset}&onlyData=true`;
}

const AGENCY_ACRONYMS: Record<string, string> = {
  MODOT: "MoDOT",
  OA: "OA",
  DOC: "DOC",
  DMH: "DMH",
  MDC: "MDC",
  DESE: "DESE",
  DHSS: "DHSS",
  DNR: "DNR",
  DSS: "DSS",
  DPS: "DPS",
  MSHP: "MSHP",
  DOR: "DOR",
  DOLIR: "DOLIR",
};
const SMALL = new Set(["of", "and", "for", "the", "to", "on", "in"]);

/** "31-MODOT TRANSPORTATION" → "MoDOT Transportation"; "34-PROC OA DIVISION OF PURCHASING PROCUREMENTS" → "OA Division of Purchasing". */
export function moAgencyName(bu: string | null | undefined): string {
  const raw = String(bu ?? "")
    .replace(/^\s*\d+\s*-\s*/, "")
    .replace(/^PROC\s+/i, "") // "PROC OA DIVISION OF PURCHASING PROCUREMENTS"
    .replace(/\s+PROCUREMENTS?$/i, "")
    .trim();
  if (!raw) return "State of Missouri";
  return raw
    .split(/\s+/)
    .map((w, i) => {
      const up = w.toUpperCase();
      if (AGENCY_ACRONYMS[up]) return AGENCY_ACRONYMS[up];
      const lower = w.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function recordSkip(result: MoParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseMoAbstracts(items: MoAbstract[], now: number = Date.now()): MoParseResult {
  const result: MoParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const a of items) {
    const rowId = `momovers-${a.AuctionHeaderId}`;
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const status = String(a.NegotiationStatus ?? "").toLowerCase();
    if (status !== "active" && status !== "amended") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const type = String(a.NegotiationType ?? "").trim();
    if (/single feasible source|special delegation/i.test(type)) {
      recordSkip(result, rowId, "not_competitive");
      continue;
    }
    const title = String(a.NegotiationTitle ?? "").replace(/\s+/g, " ").trim();
    if (!title || !a.AuctionHeaderId) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const closeMs = a.CloseDate ? Date.parse(a.CloseDate) : NaN;
    if (!Number.isFinite(closeMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (closeMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = moAgencyName(a.ProcurementBUName);
    const number = String(a.Negotiation ?? "").trim() || null;
    const synopsis = String(a.Synopsis ?? "").replace(/\s+/g, " ").trim();
    const description = [
      synopsis ? `${synopsis}.`.replace(/\.\.$/, ".") : "",
      `State of Missouri ${type || "solicitation"}${number ? ` ${number}` : ""}${a.PostingDate ? `, posted ${a.PostingDate}` : ""}${status === "amended" ? " (amended)" : ""}.`,
      a.BuyerName ? `Buyer: ${a.BuyerName}${a.BuyerEmailAddress ? ` (${String(a.BuyerEmailAddress).toLowerCase()})` : ""}.` : "",
      "Respond through MissouriBUYS, powered by MOVERS (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Missouri",
      category: mapCategory("", title, description),
      due_date: new Date(closeMs).toISOString(),
      estimated_value: "Not specified",
      source_url: MO_MOVERS_BOARD_URL,
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
  console.error(`  ${MO_MOVERS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(MO_MOVERS_SOURCE, [detail]);
}

/** Fetch every open abstract (paged) and return ingest rows. */
export async function fetchMoMoversBids(now: number = Date.now()): Promise<FetchResult> {
  const items: MoAbstract[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = moMoversUrl(now, page * PAGE_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let body: any;
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: controller.signal });
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
      body = await resp.json();
    } catch (e) {
      if (e instanceof SourceUnreachableError) throw e;
      fail(requestFailureDetail(e));
    } finally {
      clearTimeout(timer);
    }
    if (!body || !Array.isArray(body.items)) fail("response shape changed: no items array");
    items.push(...(body.items as MoAbstract[]));
    if (!body.hasMore) break;
  }
  const { rows, skipped, skippedRows } = parseMoAbstracts(items, now);
  console.log(
    `  ${MO_MOVERS_SOURCE}: ${rows.length} open solicitations accepted (listed: ${items.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
