/**
 * New Mexico state solicitations — `nm_epronm`, the State Purchasing
 * Division's public eProNM event list (General Services Department), hosted
 * on JAGGAER (bids.sciquest.com).
 *
 * WHY: Contrax had no New Mexico feed (owner 2026-10-06: "the New Mexico").
 *
 * SOURCE (verified live 2026-10-06, no login, no CAPTCHA: 10 open events):
 *   https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfNewMexico
 * is plain server-rendered HTML ("Open for Bid", 10 results). Each event
 * shows its name, a short description, Open and Close with their time zone,
 * Type, Number and the State Purchasing contact. The per-event links carry
 * expiring tokens, so rows link to the public list; the event's own id comes
 * from its "View as PDF" document name (Sourcingevent/<id>-event.pdf).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the event name; `description` = its description plus type,
 *     number and the State Purchasing contact.
 *   - `agency` = "New Mexico General Services Department, State Purchasing
 *     Division" (every event is issued through State Purchasing; the
 *     requesting agency, when named, stays in the description text).
 *   - `due_date` = Close, with the zone the page prints (MDT/MST).
 *   - `solicitation_number` = Number; `notice_type` = Type.
 *   - `location` = "New Mexico"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: not "Open" (`not_open`), close passed (`closed`), unreadable close
 * (`bad_date`), no id or name (`missing_fields`), repeated id (`duplicate`).
 *
 * IDENTITY: `external_id = nmepronm-<event id>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const NM_EPRONM_SOURCE = "nm_epronm";
export const NM_EPRONM_URL = "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfNewMexico";
const AGENCY = "New Mexico General Services Department, State Purchasing Division";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface NmEvent {
  id: string;
  status: string;
  name: string;
  summary: string;
  open: string;
  close: string;
  type: string;
  number: string;
  contact: string;
}

export interface NmParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function text(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** The value printed after a field label ("Number" → "70-00000-26-00008"). */
function field(block: string, label: string): string {
  const re = new RegExp(`>\\s*${label}\\s*</div>[\\s\\S]*?class="phx data-row-content">([\\s\\S]*?)</div>`);
  return text(re.exec(block)?.[1] ?? "");
}

/** Events from the public list's HTML. */
export function parseNmEvents(html: string): NmEvent[] {
  const parts = html.split(/<span class="mosaic status-badge[^"]*">/).slice(1);
  return parts.map((block) => {
    const status = text(block.slice(0, block.indexOf("</span>")));
    const name = text(/btn-link-header"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "");
    const summary = text(/class="phx display-block phxText label-mini">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? "");
    const contactCell = /SourcingPublicSite_LABEL_CONTACT[\s\S]*?class="phx data-row-content">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/.exec(block)?.[1] ?? "";
    return {
      id: /Sourcingevent\/(\d+)-event\.pdf/.exec(block)?.[1] ?? "",
      status,
      name,
      summary,
      open: field(block, "Open"),
      close: field(block, "Close"),
      type: field(block, "Type"),
      number: field(block, "Number"),
      contact: text(contactCell.replace(/<br\s*\/?>/gi, " · ")),
    };
  });
}

/** "10/27/2026, 2:00 PM MDT" → epoch ms, or NaN. */
export function nmCloseMs(s: string | null | undefined): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s+(MDT|MST)$/i.exec(String(s ?? "").trim());
  if (!m) return NaN;
  let hour = +m[4] % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  const offset = m[7].toUpperCase() === "MDT" ? 6 : 7;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], hour + offset, +m[5]);
}

function recordSkip(result: NmParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function buildNmRows(events: NmEvent[], now: number = Date.now()): NmParseResult {
  const result: NmParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const e of events) {
    const rowId = `nmepronm-${e.id}`;
    if (!e.id || !e.name) {
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
    const dueMs = nmCloseMs(e.close);
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const description = [
      e.summary && e.summary !== e.name ? (/[.!?]$/.test(e.summary) ? e.summary : `${e.summary}.`) : "",
      `New Mexico State Purchasing ${e.type || "solicitation"}${e.number ? ` ${e.number}` : ""}${e.open ? `, opened ${e.open}` : ""}.`,
      e.contact ? `Contact: ${e.contact}.` : "",
      "Responses through eProNM (free registration); documents on the State of New Mexico public event list (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: e.name,
      agency: AGENCY,
      description,
      location: "New Mexico",
      category: mapCategory("", e.name, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: NM_EPRONM_URL,
      set_aside: null,
      notice_type: e.type || null,
      solicitation_number: e.number || null,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${NM_EPRONM_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(NM_EPRONM_SOURCE, [detail]);
}

/** GET the public event list and return ingest rows. */
export async function fetchNmEpronmBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let html = "";
  try {
    const resp = await fetch(NM_EPRONM_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, NM_EPRONM_URL));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const total = Number(/of\s+(\d+)\s+Results/.exec(html)?.[1]);
  const events = parseNmEvents(html);
  if (!Number.isFinite(total)) fail("page shape changed: no result count");
  if (events.length < total) fail(`only ${events.length} of ${total} events on the page`);
  const { rows, skipped, skippedRows } = buildNmRows(events, now);
  console.log(
    `  ${NM_EPRONM_SOURCE}: ${rows.length} open events accepted (listed: ${events.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
