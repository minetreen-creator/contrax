/**
 * Minnesota Department of Administration construction projects —
 * `mn_questcdn`, the department's public QuestCDN posting list (state
 * building, DNR, corrections and veterans-home construction, bid through
 * Admin's Real Estate and Construction Services).
 *
 * WHY: Contrax had no Minnesota feed (owner 2026-10-05: "Minnesota", and the
 * owner supplied this posting link).
 *
 * SOURCE (verified live 2026-10-05, no login, no CAPTCHA: 9 open projects):
 * the public posting page
 *   https://qcpi.questcdn.com/cdn/posting/?projType=all&provider=6506969&group=6506969&yr=3
 * fills its table from its own call
 *   GET https://qcpi.questcdn.com/cdn/browse_posting/?search_id=&postings_since_last_login=&draw=1&start=0&length=…
 * which is scoped to the posting group by the page's session cookie. The
 * connector GETs the page first (cookie) and then makes that same call.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = Bid/Request Name (the full name from the cell's title).
 *   - `agency` = Owner, prefixed "Minnesota " where the owner field omits it
 *     ("Department of Administration" → "Minnesota Department of
 *     Administration"); the solicitor is always a Minnesota state department.
 *   - `due_date` = Bid Closing Date with its own zone ("10/08/2026 02:00 PM
 *     CDT").
 *   - `source_url` = the posting list (project pages need the browser app);
 *     the Quest number is in `solicitation_number` and the description.
 *   - `location` = "Minnesota"; city and county go in the description.
 * Skipped: closing passed (`closed`), unreadable closing (`bad_date`), no id
 * or name (`missing_fields`), repeated id (`duplicate`), state other than MN
 * (`out_of_state`).
 *
 * IDENTITY: `external_id = mnquest-<Quest number>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const MN_QUESTCDN_SOURCE = "mn_questcdn";
export const MN_QUESTCDN_HOST = "https://qcpi.questcdn.com";
export const MN_QUESTCDN_GROUP = "6506969";
export const MN_QUESTCDN_PAGE_URL = `${MN_QUESTCDN_HOST}/cdn/posting/?projType=all&provider=${MN_QUESTCDN_GROUP}&group=${MN_QUESTCDN_GROUP}&yr=3`;
export const MN_QUESTCDN_DATA_URL = `${MN_QUESTCDN_HOST}/cdn/browse_posting/?search_id=&postings_since_last_login=&draw=1&start=0&length=500`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface QuestPosting {
  project_id: string;
  render_name: string | null;
  bid_date_str: string | null;
  render_city: string | null;
  render_county: string | null;
  state_code: string | null;
  render_owner: string | null;
  render_solicitor: string | null;
  render_category_search_string: string | null;
  posting_type: string | null;
}

export interface MnQuestParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** A rendered cell's full text: its tooltip title when present (cells are truncated), else its text. */
export function questCell(html: string | null | undefined): string {
  const raw = String(html ?? "");
  const title = /title="([^"]*)"/.exec(raw)?.[1];
  const text = title ?? raw.replace(/<[^>]+>/g, " ");
  return decode(text).replace(/\s+/g, " ").trim();
}

const ZONES: Record<string, number> = { CDT: -5, CST: -6, EDT: -4, EST: -5, MDT: -6, MST: -7, PDT: -7, PST: -8 };

/** "10/08/2026 02:00 PM CDT" → epoch ms, or NaN. */
export function questCloseMs(s: string | null | undefined): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+([A-Z]{3})$/i.exec(String(s ?? "").trim());
  if (!m) return NaN;
  const offset = ZONES[m[7].toUpperCase()];
  if (offset === undefined) return NaN;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], hour - offset, +m[5]);
}

/** "Department of Administration" → "Minnesota Department of Administration". */
export function questAgencyName(owner: string, solicitor: string): string {
  const name = owner || solicitor;
  if (!name) return "State of Minnesota";
  return /^minnesota\b/i.test(name) ? name : `Minnesota ${name}`;
}

function recordSkip(result: MnQuestParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseQuestPostings(items: QuestPosting[], now: number = Date.now()): MnQuestParseResult {
  const result: MnQuestParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const p of items) {
    const id = String(p.project_id ?? "").trim();
    const rowId = `mnquest-${id}`;
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    const title = questCell(p.render_name);
    if (!id || !title) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (String(p.state_code ?? "MN").trim().toUpperCase() !== "MN") {
      recordSkip(result, rowId, "out_of_state");
      continue;
    }
    const closeMs = questCloseMs(p.bid_date_str);
    if (!Number.isFinite(closeMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (closeMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = questAgencyName(questCell(p.render_owner), questCell(p.render_solicitor));
    const city = questCell(p.render_city);
    const county = questCell(p.render_county);
    const categories = questCell(p.render_category_search_string);
    const place = [city, county ? `${county} County` : ""].filter(Boolean).join(", ");
    const description = [
      `Minnesota state ${String(p.posting_type ?? "project").toLowerCase()} posted by ${agency} on QuestCDN (Quest number ${id}).`,
      place ? `Location: ${place}, Minnesota.` : "",
      categories ? `Categories: ${categories}.` : "",
      "Plans and bidding documents through QuestCDN (see source link; search the Quest number).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Minnesota",
      category: mapCategory("", title, description),
      due_date: new Date(closeMs).toISOString(),
      estimated_value: "Not specified",
      source_url: MN_QUESTCDN_PAGE_URL,
      set_aside: null,
      notice_type: String(p.posting_type ?? "").trim() || null,
      solicitation_number: id,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${MN_QUESTCDN_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(MN_QUESTCDN_SOURCE, [detail]);
}

/** GET the posting page (session cookie), then the page's own table call. */
export async function fetchMnQuestcdnBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: any;
  try {
    const page = await fetch(MN_QUESTCDN_PAGE_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (page.status !== 200) fail(httpFailureDetail(page.status, MN_QUESTCDN_PAGE_URL));
    const set: string[] = typeof (page.headers as any).getSetCookie === "function" ? (page.headers as any).getSetCookie() : [];
    const cookie = set.map((c) => c.split(";")[0]).join("; ");
    await page.text();
    const resp = await fetch(MN_QUESTCDN_DATA_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Referer: MN_QUESTCDN_PAGE_URL,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, MN_QUESTCDN_DATA_URL));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!body || !Array.isArray(body.data)) fail("response shape changed: no data array");
  const items = body.data as QuestPosting[];
  if (Number(body.recordsTotal) > items.length) fail(`only ${items.length} of ${body.recordsTotal} postings returned`);
  const { rows, skipped, skippedRows } = parseQuestPostings(items, now);
  console.log(
    `  ${MN_QUESTCDN_SOURCE}: ${rows.length} open projects accepted (listed: ${items.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
