/**
 * Idaho IPRO open sourcing events — `id_ipro`, the State of Idaho's statewide
 * supplier portal (IPRO, "Powered by Luma", Infor Supply Management), where
 * the Division of Purchasing and state agencies post their solicitations.
 *
 * WHY: Contrax had no Idaho feed (owner 2026-10-06 allowed *.idaho.gov and
 * *.inforgov.com).
 *
 * SOURCE (verified live 2026-10-06, no login, no CAPTCHA: 15 open events):
 * the public supplier home page
 *   https://sms-idaho-prd.tam.inforgov.com/fsm/SupplyManagementSupplier/page/XiSupplyManagementSupplierPage?csk.SupplierGroup=LUMA
 * shows "Browse Open Events" to anonymous visitors. That panel loads from the
 * page's own call
 *   GET …/fsm/SupplyManagementSupplier/list/SourcingEvent.HomeEvents?pageop=load&pagesize=…&pagepanel=XiSupplyManagementSupplierPage.Main.OpenEvents&csk.SupplierGroup=LUMA
 * after a cookie-setting SSO redirect on the page itself. The connector GETs
 * the page (following its redirects with the cookies) and then that list.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the event Name; `solicitation_number` = the event number.
 *   - `agency` = "State of Idaho": the list carries only an internal company
 *     number, not the posting agency's name, so no agency is guessed.
 *   - `due_date` = DerivedCloseDate, a UTC timestamp (YYYYMMDDHHMMSS00); the
 *     portal shows it in the viewer's time zone (e.g. 23:00 UTC = 5:00 PM MDT).
 *   - `source_url` = the public supplier home page (events open in the app).
 *   - `location` = "Idaho"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: status other than "Open" (`not_open`), close passed (`closed`),
 * unreadable close (`bad_date`), no number or name (`missing_fields`),
 * repeated number (`duplicate`).
 *
 * IDENTITY: `external_id = idipro-<event number>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const ID_IPRO_SOURCE = "id_ipro";
const BASE = "https://sms-idaho-prd.tam.inforgov.com/fsm/SupplyManagementSupplier";
export const ID_IPRO_PAGE_URL = `${BASE}/page/XiSupplyManagementSupplierPage?csk.SupplierGroup=LUMA`;
export const ID_IPRO_LIST_URL = `${BASE}/list/SourcingEvent.HomeEvents?pageop=load&pagesize=500&pagepanel=XiSupplyManagementSupplierPage.Main.OpenEvents&csk.SupplierGroup=LUMA`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface IproEvent {
  number: string;
  name: string;
  status: string;
  close: string;
  open: string;
}

export interface IproParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** Events from the list response (`dataViewSet.data[].fields`). */
export function parseIproList(body: any): IproEvent[] {
  const data: any[] = body?.dataViewSet?.data ?? [];
  return data.map((r) => {
    const f = r?.fields ?? {};
    const v = (k: string) => (f[k]?.value == null ? "" : String(f[k].value));
    return {
      number: v("SourcingEvent"),
      name: v("_op_Name_spc_translation_cp_").replace(/\s+/g, " ").trim(),
      status: v("_op_DerivedStatusForSupplier_spc_translation_cp_"),
      close: v("DerivedCloseDate"),
      open: v("_op_OpenDate_spc_date_cp_"),
    };
  });
}

/** "2026101623000000" (UTC) → epoch ms, or NaN. */
export function iproUtcMs(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s.trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

function recordSkip(result: IproParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function buildIproRows(events: IproEvent[], now: number = Date.now()): IproParseResult {
  const result: IproParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const e of events) {
    const rowId = `idipro-${e.number}`;
    if (!e.number || !e.name) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    if (e.status.toLowerCase() !== "open") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const dueMs = iproUtcMs(e.close);
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const opened = /^(\d{4})(\d{2})(\d{2})$/.exec(e.open);
    const description = [
      `State of Idaho sourcing event ${e.number} on IPRO${opened ? `, opened ${+opened[2]}/${+opened[3]}/${opened[1]}` : ""}.`,
      "Event documents and responses through the IPRO supplier portal (free supplier registration); find the event under Browse Open Events (see source link).",
    ].join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.name,
      agency: "State of Idaho",
      description,
      location: "Idaho",
      category: mapCategory("", e.name, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: ID_IPRO_PAGE_URL,
      set_aside: null,
      notice_type: null,
      solicitation_number: e.number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${ID_IPRO_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(ID_IPRO_SOURCE, [detail]);
}

/** GET the page (following its SSO redirects with cookies), then the open-events list. */
export async function fetchIdIproBids(now: number = Date.now()): Promise<FetchResult> {
  const cookies = new Map<string, string>();
  const keep = (resp: Response) => {
    const set: string[] = typeof (resp.headers as any).getSetCookie === "function" ? (resp.headers as any).getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const cookie = (): Record<string, string> => (cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: any;
  try {
    let url = ID_IPRO_PAGE_URL;
    for (let hop = 0; ; hop++) {
      const resp = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html", ...cookie() }, signal: controller.signal });
      keep(resp);
      const location = resp.headers.get("location");
      if (resp.status >= 300 && resp.status < 400 && location && hop < 6) {
        url = new URL(location, url).toString();
        await resp.text();
        continue;
      }
      if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
      await resp.text();
      break;
    }
    const resp = await fetch(ID_IPRO_LIST_URL, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: ID_IPRO_PAGE_URL, ...cookie() },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, ID_IPRO_LIST_URL));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(body?.dataViewSet?.data)) fail("response shape changed: no dataViewSet.data");
  if (body.dataViewSet.pagingInfo?.hasNext) fail("more open events than one page returned");
  const events = parseIproList(body);
  const { rows, skipped, skippedRows } = buildIproRows(events, now);
  console.log(
    `  ${ID_IPRO_SOURCE}: ${rows.length} open events accepted (listed: ${events.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
