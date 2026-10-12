/**
 * Montgomery County, Maryland open solicitations — `md_montgomery`.
 *
 * WHY: Maryland's statewide board (eMMA) answers every visitor with a
 * "Browser check" CAPTCHA page; Contrax never gets around bot protection, so
 * eMMA is out (owner 2026-10-11: "lets do MD"). Montgomery County, Maryland's
 * largest, publishes its own solicitations as open data, refreshed daily.
 *
 * SOURCE (verified live 2026-10-11, no login, no CAPTCHA): the county's Socrata
 * dataset "Solicitations" (eeq6-nnwe, Office of Procurement):
 *   GET https://data.montgomerycountymd.gov/resource/eeq6-nnwe.json?status=Active
 * 1,260 rows in all; 21 `status = "Active"` on 2026-10-11, of which 7 carry
 * `cancelledpostponed = "Cancelled or Indefinitely Postponed"`.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = `description` (the solicitation's name, verbatim);
 *     `solicitation_number` = `number`; `notice_type` = `type` (RFP / IFB /
 *     Informal); `agency` = "Montgomery County, MD — <department>".
 *   - `due_date` = `closingdate`, which is DATE-ONLY (always T00:00:00): stored
 *     at 11:59 PM Eastern, the convention for date-only deadlines, and the
 *     description says the time is not published in the data.
 *   - `location` = "Montgomery County, MD"; `category` = "Construction" when the
 *     county flags it (`construction = "Y"`), else mapCategory over the title.
 *   - The description also states the county's Local Small Business Reserve
 *     Program flag (`lsbrpindicator = "Y"`) as the county states it; it is never
 *     written to the federal `set_aside` field.
 *   - `source_url` = the dataset's public page (the county's solicitation pages
 *     were not verified from the dev sandbox).
 *   - `estimated_value` = "" and `naics_code` / `psc` / `set_aside` NULL.
 * Skips: not Active (`not_open`), cancelled or postponed (`cancelled`), closing
 * date passed (`closed`), missing number / title / closing date.
 *
 * IDENTITY: `external_id = mdmontgomery-<number>` (the county's own number).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const MD_MONTGOMERY_SOURCE = "md_montgomery";
export const MD_MONTGOMERY_API_URL = "https://data.montgomerycountymd.gov/resource/eeq6-nnwe.json";
export const MD_MONTGOMERY_PAGE_URL = "https://data.montgomerycountymd.gov/Government/Solicitations/eeq6-nnwe";
const COUNTY = "Montgomery County, MD";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface MdMontgomeryItem {
  status?: string | null;
  type?: string | null;
  number?: string | null;
  description?: string | null;
  issuancedate?: string | null;
  closingdate?: string | null;
  cancelledpostponed?: string | null;
  construction?: string | null;
  lsbrpindicator?: string | null;
  department?: string | null;
}
export interface MdMontgomeryParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

/** Eastern offset (hours): EDT −4 from the 2nd Sunday of March to the 1st Sunday of November, else EST −5. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "2026-10-23T00:00:00.000" (date-only) → 11:59 PM Eastern that day, as ISO. Invalid → null. */
export function mdMontgomeryCloseToIso(s: unknown): string | null {
  const m = clean(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, 23, 59) - easternOffset(y, mo, d) * 3_600_000).toISOString();
}

function recordSkip(result: MdMontgomeryParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseMdMontgomery(items: readonly MdMontgomeryItem[], now: number = Date.now()): MdMontgomeryParseResult {
  const result: MdMontgomeryParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const [i, it] of items.entries()) {
    const number = clean(it.number);
    const rowId = number ? `mdmontgomery-${number}` : `mdmontgomery-row-${i}`;
    if (!number) {
      recordSkip(result, rowId, "missing_id");
      continue;
    }
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    if (clean(it.status).toLowerCase() !== "active") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    if (clean(it.cancelledpostponed)) {
      recordSkip(result, rowId, "cancelled");
      continue;
    }
    const title = clean(it.description);
    if (!title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const due = mdMontgomeryCloseToIso(it.closingdate);
    if (!due) {
      recordSkip(result, rowId, "missing_due");
      continue;
    }
    if (Date.parse(due) <= now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const dept = clean(it.department);
    const type = clean(it.type);
    const closeDay = clean(it.closingdate).slice(0, 10);
    const description = [
      `Montgomery County, Maryland ${type || "solicitation"} ${number}${dept ? ` (${dept})` : ""}.`,
      `Closing date ${closeDay}; the closing time is not published in the county's data.`,
      /^y/i.test(clean(it.construction)) ? "The county lists this as a construction solicitation." : "",
      /^y/i.test(clean(it.lsbrpindicator)) ? "The county marks it for its Local Small Business Reserve Program (LSBRP)." : "",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency: dept ? `${COUNTY} — ${dept}` : COUNTY,
      description,
      location: COUNTY,
      category: /^y/i.test(clean(it.construction)) ? "Construction" : mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: MD_MONTGOMERY_PAGE_URL,
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
  console.error(`  ${MD_MONTGOMERY_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(MD_MONTGOMERY_SOURCE, [detail]);
}

/** Fetch Montgomery County's Active solicitations and return one bid per open listing. */
export async function fetchMdMontgomeryBids(now: number = Date.now()): Promise<FetchResult> {
  const url = `${MD_MONTGOMERY_API_URL}?status=Active&$limit=5000`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: unknown;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, MD_MONTGOMERY_API_URL));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(body)) fail("page shape changed: the dataset response is not an array");
  const items = body as MdMontgomeryItem[];
  const r = parseMdMontgomery(items, now);
  console.log(
    `  ${MD_MONTGOMERY_SOURCE}: ${r.rows.length} open solicitations accepted (read ${items.length}; skips: ${
      Object.entries(r.skipped)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows: r.rows, skipped: r.skipped, skippedRows: r.skippedRows };
}
