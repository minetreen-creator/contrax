/**
 * New York City: the City Record Online (owner 2026-11-16: "we need more janitorial sources
 * nationwide", then "Go" on New York). Every city agency, the Housing Authority, Health + Hospitals
 * and the Department of Education must advertise their solicitations in the City Record; the city
 * publishes those notices as an open dataset (NYC Open Data, dataset dg92-zbpx), which is what this
 * reads. No New York City board was being read before this.
 *
 * Read: Procurement-section notices of type "Solicitation" whose due date is still ahead. A
 * "Bid Extension:" or "Correction:" notice is a later advertisement of the same solicitation (same
 * PIN), so the newest notice per PIN is kept. Each row links to its own public notice page.
 * Contact columns (name, phone, email) are never read.
 */
import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import type { FetchResult } from "../runner";
import { zonedIso } from "./revize-bids";
import type { RawBid } from "./sam-gov";

export const NYC_CROL_SOURCE = "ny_nyc_city_record";
export const NYC_CROL_API = "https://data.cityofnewyork.us/resource/dg92-zbpx.json";
const NOTICE_PAGE = "https://a856-cityrecord.nyc.gov/RequestDetail/";
const COLUMNS = "request_id,start_date,agency_name,short_title,category_description,selection_method_description,pin,due_date,additional_description_1";
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const HEADERS = { Accept: "application/json", "User-Agent": "Contrax procurement intelligence (https://www.contrax.company)" };

function fail(detail: string): never { throw new SourceUnreachableError(NYC_CROL_SOURCE, [detail]); }

const clean = (v: unknown) =>
  String(v ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&rsquo;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();

/** The dataset prints New York wall time with no zone ("2026-11-20T12:00:00.000"). PURE. */
export function nycDeadline(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v ?? ""));
  if (!m) return null;
  // A date with no time of day (midnight) closes at the end of that day.
  const [h, mi] = +m[4] === 0 && +m[5] === 0 ? [23, 59] : [+m[4], +m[5]];
  return zonedIso("America/New_York", +m[1], +m[2], +m[3], h, mi);
}

/** "Housing Authority" → "NYC Housing Authority"; a name that already says NYC or New York stays. PURE. */
export function nycAgency(name: unknown): string {
  const n = clean(name);
  if (!n) return "City of New York";
  return /^(NYC|New York)\b/i.test(n) ? n : `NYC ${n}`;
}

/** The query for open solicitations. `now` is formatted as New York wall time, as the dataset is. */
export function nycCrolUrl(now: number, offset: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  // From the start of today: a notice due later today is still open; the parser drops what has closed.
  const where = `section_name='Procurement' AND type_of_notice_description='Solicitation' AND due_date >= '${p.year}-${p.month}-${p.day}T00:00:00'`;
  return `${NYC_CROL_API}?${new URLSearchParams({ $select: COLUMNS, $where: where, $order: "request_id ASC", $limit: String(PAGE_SIZE), $offset: String(offset) })}`;
}

export function parseNycCrol(records: unknown, now = Date.now()): FetchResult {
  if (!Array.isArray(records)) fail("the dataset did not answer with a list");
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({ id, reason }); };
  const newest = new Map<string, { id: string; row: RawBid }>();
  for (const r of records as Record<string, unknown>[]) {
    const id = clean(r.request_id);
    if (!/^\d{6,14}$/.test(id)) { skip(id || "(none)", "no_notice_id"); continue; }
    const title = clean(r.short_title).replace(/^(?:(?:bid extension|correction|re-?ad|rescheduled)\s*:\s*)+/i, "");
    if (!title) { skip(id, "no_title"); continue; }
    const due = nycDeadline(r.due_date);
    // The dataset holds placeholder years such as 9999; a real deadline is within a few years.
    if (!due || Date.parse(due) > now + 3 * 365 * 86_400_000) { skip(id, "no_deadline"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    const pin = clean(r.pin);
    const method = clean(r.selection_method_description);
    const kind = clean(r.category_description);
    const body = clean(r.additional_description_1).slice(0, 1800);
    const description = [`New York City solicitation advertised in the City Record.${method ? ` ${method}.` : ""}${kind ? ` ${kind}.` : ""}${pin ? ` PIN ${pin}.` : ""}`, body].filter(Boolean).join(" ");
    const row: RawBid = {
      external_id: `nyc-crol-${id}`,
      title,
      agency: nycAgency(r.agency_name),
      description,
      location: "New York, NY",
      category: mapCategory("", title, body),
      due_date: due,
      estimated_value: "",
      source_url: `${NOTICE_PAGE}${id}`,
      solicitation_number: pin || null,
    };
    // One row per solicitation: the newest notice for a PIN replaces the earlier ones.
    const key = pin ? `pin:${pin.toLowerCase()}` : `id:${id}`;
    const seen = newest.get(key);
    if (!seen) newest.set(key, { id, row });
    else if (id > seen.id) { skip(seen.id, "superseded_notice"); newest.set(key, { id, row }); }
    else skip(id, "superseded_notice");
  }
  return { rows: [...newest.values()].map((v) => v.row), skipped, skippedRows };
}

export async function fetchNycCrolBids(now = Date.now(), fetchPage: typeof fetch = fetch): Promise<FetchResult> {
  const all: unknown[] = [];
  try {
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) fail(`more than ${MAX_PAGES * PAGE_SIZE} open notices; refusing a partial read`);
      const res = await fetchPage(nycCrolUrl(now, page * PAGE_SIZE), { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) fail(`HTTP ${res.status}`);
      const records = (await res.json()) as unknown;
      if (!Array.isArray(records)) fail("the dataset did not answer with a list");
      all.push(...records);
      if (records.length < PAGE_SIZE) break;
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(`fetch failed: ${(e as Error).message}`);
  }
  const result = parseNycCrol(all, now);
  console.log(`  ${NYC_CROL_SOURCE}: ${result.rows.length} open solicitations from ${all.length} notices; ${JSON.stringify(result.skipped)}`);
  return result;
}
