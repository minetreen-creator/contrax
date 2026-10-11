/**
 * District of Columbia open solicitations (OCP's PASS) — `dc_pass`.
 *
 * WHY: DC had no source for the District government's own bids — only SAM.gov
 * federal notices filtered to DC (owner 2026-10-11: "lets do DC").
 *
 * SOURCE (verified live 2026-10-11, no login, no CAPTCHA): the Office of
 * Contracting and Procurement publishes "Solicitations from PASS" on DC Open
 * Data (opendata.dc.gov dataset b8b18bf60f214460a827f8da7e28daae, CC BY),
 * served by the District's own ArcGIS layer and refreshed daily (last modified
 * 2026-10-11 04:30 UTC when captured):
 *   GET https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/19/query
 *       ?where=CLOSEDATE > CURRENT_TIMESTAMP&outFields=*&f=json
 * 25,354 records in all; 32 rows (21 solicitations) with a future close date on 2026-10-11, every one
 * `EVENTDISPLAYSTATUS = "OPEN"`. Date fields are epoch milliseconds in true UTC
 * (CLOSEDATE 18:00Z = the District's usual 2:00 PM ET deadline).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = SOLICITATIONTITLE; `solicitation_number` = SOLICITATIONNUMBER.
 *   - `agency` = AGENCY_NAME, else AGENCYDESCRIPTION (PASS's own agency text,
 *     e.g. "DEPART OF YOUTH REHABILITATION SERVICES"), else the OCP itself.
 *   - `due_date` = CLOSEDATE (else DUE_DATE).
 *   - `description` = SYNOPSIS, plus the NIGP commodities (PASS repeats a
 *     solicitation once per commodity code; the rows are merged), procurement method,
 *     market type ("Open" / "Set Aside" as PASS states it) and work site.
 *     PASS stores curly quotes as the control character U+001A; those are
 *     written as a plain apostrophe.
 *   - `location` = "District of Columbia" (the buyer is the District government;
 *     "Washington, DC" would read as Washington State).
 *   - `category` = mapCategory over the title + NIGP commodity + synopsis.
 *   - `source_url` = OCP's public Solicitations page (the transparency portal
 *     has no per-solicitation page; bidding is in PASS, which needs an account).
 *   - `estimated_value` = "" and `naics_code` / `psc` / `set_aside` NULL — PASS's
 *     "Set Aside" market is the District's CBE program, not a federal set-aside,
 *     so it is stated in the description, never written to `set_aside`.
 * Skips: not OPEN (`not_open`), close time passed (`closed`), missing number /
 * title / close time.
 *
 * IDENTITY: `external_id = dcpass-<SOLICITATIONNUMBER>` — PASS's own number for
 * the solicitation (OBJECT_ID is a table row id and can change on refresh).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const DC_PASS_SOURCE = "dc_pass";
export const DC_PASS_LAYER_URL =
  "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/19";
export const DC_PASS_PAGE_URL = "https://contracts.ocp.dc.gov/solicitations";
const DC_OCP = "Office of Contracting and Procurement";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface DcPassAttributes {
  AGENCY_NAME?: string | null;
  AGENCYDESCRIPTION?: string | null;
  SOLICITATIONNUMBER?: string | null;
  SOLICITATIONTITLE?: string | null;
  EVENTDISPLAYSTATUS?: string | null;
  DUE_DATE?: number | null;
  CLOSEDATE?: number | null;
  NIGPCODEDESCRIPTION?: string | null;
  MARKETTYPE?: string | null;
  PROCUREMENTMETHOD?: string | null;
  WORKSITELOCATION?: string | null;
  SYNOPSIS?: string | null;
}
export interface DcPassParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** Collapse whitespace; PASS's U+001A (a lost curly quote) becomes an apostrophe. */
export function dcClean(s: unknown): string {
  return typeof s === "string" ? s.replace(/\u001a/g, "'").replace(/\s+/g, " ").trim() : "";
}

function recordSkip(result: DcPassParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of the layer's feature attributes — no network, no DB; `now` is injected. */
export function parseDcPass(items: readonly DcPassAttributes[], now: number = Date.now()): DcPassParseResult {
  const result: DcPassParseResult = { rows: [], skipped: {}, skippedRows: [] };
  // PASS lists a solicitation once per NIGP commodity code: group by number,
  // keep the first row's fields and every commodity, in order.
  const groups = new Map<string, { first: DcPassAttributes; nigp: string[] }>();
  for (const [i, a] of items.entries()) {
    const number = dcClean(a.SOLICITATIONNUMBER);
    if (!number) {
      recordSkip(result, `dcpass-row-${i}`, "missing_id");
      continue;
    }
    const g = groups.get(number) ?? { first: a, nigp: [] };
    const commodity = dcClean(a.NIGPCODEDESCRIPTION);
    if (commodity && !g.nigp.includes(commodity)) g.nigp.push(commodity);
    groups.set(number, g);
  }
  for (const [number, { first: a, nigp: commodities }] of groups) {
    const rowId = `dcpass-${number}`;
    if (dcClean(a.EVENTDISPLAYSTATUS).toUpperCase() !== "OPEN") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const title = dcClean(a.SOLICITATIONTITLE);
    if (!title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const closeMs = typeof a.CLOSEDATE === "number" ? a.CLOSEDATE : typeof a.DUE_DATE === "number" ? a.DUE_DATE : NaN;
    if (!Number.isFinite(closeMs)) {
      recordSkip(result, rowId, "missing_due");
      continue;
    }
    if (closeMs <= now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = dcClean(a.AGENCY_NAME) || dcClean(a.AGENCYDESCRIPTION) || DC_OCP;
    const synopsis = dcClean(a.SYNOPSIS);
    const nigp = commodities.join("; ");
    const method = dcClean(a.PROCUREMENTMETHOD);
    const market = dcClean(a.MARKETTYPE);
    const site = dcClean(a.WORKSITELOCATION);
    const description = [
      synopsis,
      nigp ? `${commodities.length > 1 ? "Commodities" : "Commodity"}: ${nigp}.` : "",
      method ? `Procurement method: ${method}.` : "",
      market ? `Market: ${market}${/set aside/i.test(market) ? " (District of Columbia CBE set-aside)" : ""}.` : "",
      site ? `Work site: ${site}.` : "",
      "Bids are submitted in DC's PASS system (vendor account required).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "District of Columbia",
      category: mapCategory("", title, `${nigp} ${synopsis}`),
      due_date: new Date(closeMs).toISOString(),
      estimated_value: "",
      source_url: DC_PASS_PAGE_URL,
      set_aside: null,
      notice_type: method || null,
      solicitation_number: number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${DC_PASS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(DC_PASS_SOURCE, [detail]);
}

/** Fetch the District's open PASS solicitations and return one bid per listing. */
export async function fetchDcPassBids(now: number = Date.now()): Promise<FetchResult> {
  const url =
    `${DC_PASS_LAYER_URL}/query?where=${encodeURIComponent("CLOSEDATE > CURRENT_TIMESTAMP")}` +
    `&outFields=*&orderByFields=OBJECT_ID&resultRecordCount=2000&f=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: any;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, DC_PASS_LAYER_URL));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (body?.error) fail(`layer query error: ${dcClean(body.error.message) || "unknown"}`);
  if (!Array.isArray(body?.features)) fail("page shape changed: no features array in the layer response");
  if (body.exceededTransferLimit) fail("more open solicitations than one page holds (2000) — pagination needed");
  const items = (body.features as { attributes?: DcPassAttributes }[]).map((f) => f?.attributes ?? {});
  const r = parseDcPass(items, now);
  console.log(
    `  ${DC_PASS_SOURCE}: ${r.rows.length} open solicitations accepted (read ${items.length}; skips: ${
      Object.entries(r.skipped)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows: r.rows, skipped: r.skipped, skippedRows: r.skippedRows };
}
