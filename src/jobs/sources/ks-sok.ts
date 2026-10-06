/**
 * Kansas statewide bidding events — `ks_sok`, the public "Bidding Event
 * Information" list of the State of Kansas's PeopleSoft supplier portal
 * (SMART / Procurement and Contracts, Department of Administration).
 *
 * WHY: Contrax had no Kansas feed (owner 2026-10-06 allowed *.ks.gov).
 *
 * SOURCE (verified live 2026-10-06, no login, no CAPTCHA: 25 open events from
 * the Judicial Branch, KDOT, KDHE, Wildlife & Parks, Revenue, Commerce, KBI
 * and others): the public page
 *   https://supplier.sok.ks.gov/psc/sokfsprdsup/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL
 * is the same PeopleSoft page Oklahoma uses (`ok_omes`): a first GET answers
 * with a cookie-setting 302, then the grid comes as plain HTML. Fetching and
 * grid parsing are shared with ok-omes.ts. The page lists every open event
 * on one screen (no paging). Event detail opens through the page's own
 * postback, so rows link to the list.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = Event Name as posted (at most 50 characters, as in ok_omes).
 *   - `agency` = Business Unit with "Kansas " in front, "KS " spelled out
 *     ("KS Wildlife & Parks" → "Kansas Wildlife & Parks"; "Judicial Branch" →
 *     "Kansas Judicial Branch").
 *   - `due_date` = End Date, read as US Central local time (PeopleSoft's
 *     "CST" zone observes daylight time).
 *   - `solicitation_number` = Event ID. Kansas's list has no Event Type
 *     column, so `notice_type` stays NULL.
 *   - `location` = "Kansas"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: end date passed (`closed`), unreadable end date (`bad_date`), no
 * event id or name (`missing_fields`), repeated id (`duplicate`).
 *
 * IDENTITY: `external_id = kssok-<Event ID>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import { fetchPeopleSoftBidList, okDueMs, parseOkGrid, type OkEvent } from "./ok-omes";
import type { RawBid } from "./sam-gov";

export const KS_SOK_SOURCE = "ks_sok";
export const KS_SOK_URL = "https://supplier.sok.ks.gov/psc/sokfsprdsup/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL";

export interface KsParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** Business unit → agency name. */
export function ksAgencyName(unit: string): string {
  const name = unit.replace(/\s+/g, " ").trim().replace(/^KS\s+/, "Kansas ");
  if (!name) return "State of Kansas";
  return /^kansas\b/i.test(name) ? name : `Kansas ${name}`;
}

function recordSkip(result: KsParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseKsEvents(events: OkEvent[], now: number = Date.now()): KsParseResult {
  const result: KsParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const e of events) {
    const rowId = `kssok-${e.id}`;
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
    const agency = ksAgencyName(e.businessUnit);
    const description = [
      `State of Kansas bidding event ${e.id} posted by ${agency}${e.start ? ` (opened ${e.start})` : ""}.`,
      "Event documents and responses through the Kansas supplier portal; open the event from the public Bidding Event Information list (see source link).",
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.name,
      agency,
      description,
      location: "Kansas",
      category: mapCategory("", e.name, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: KS_SOK_URL,
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
  console.error(`  ${KS_SOK_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(KS_SOK_SOURCE, [detail]);
}

/** GET the list, following its cookie-setting redirect, and return ingest rows. */
export async function fetchKsSokBids(now: number = Date.now()): Promise<FetchResult> {
  const html = await fetchPeopleSoftBidList(KS_SOK_URL, fail);
  const events = parseOkGrid(html);
  const { rows, skipped, skippedRows } = parseKsEvents(events, now);
  console.log(
    `  ${KS_SOK_SOURCE}: ${rows.length} open events accepted (listed: ${events.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
