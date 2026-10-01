/**
 * Alabama Department of Transportation construction lettings — `al_aldot`.
 *
 * WHY: Alabama's state agency bids are on Alabama Buys, whose public bid list
 * sits behind a Google reCAPTCHA; Contrax does not get around bot protection,
 * so that portal is out (owner 2026-10-01 chose ALDOT lettings instead, the
 * same fallback Ohio got with oh_odot). ALDOT lets road and bridge
 * construction (resurfacing, bridge replacements, widening, signals, safety
 * improvements, …) about once a month and publishes every proposal openly.
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA): ALDOT's Project
 * Letting Information page, https://alletting.aldot.gov/ (the page aldot.gov
 * links to). Its "Regular Letting" tile lists each current letting as
 *   <font>September 25, 2026 10:00 AM CDT</font> … <a>Project Letting List</a>
 * and each Project Letting List page has one block per proposal ("call"):
 *   <a name="CALL001"></a><font size="5"><b>1.&nbsp;BR-0077(522) , CHAMBERS COUNTY</b></font>
 *   <b>Contract Time:</b> 140 Working Days
 *   <b>for constructing the Bridge Culvert Replacement (…) on SR-77 … Length 0.190 mi.</b>
 *   The Bracket Estimate on this project is from $2,540,642 to $3,105,229 .
 * Only lettings whose opening time has not passed are fetched; the links are
 * read from the index page, so a new month's letting is picked up as soon as
 * ALDOT posts it.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = "<Work> — ALDOT project <number>, <County> County"; the
 *                     work is ALDOT's own wording ("Bridge Culvert Replacement").
 *   - `agency`      = "Alabama Department of Transportation".
 *   - `location`    = "<County> County, Alabama", or "Alabama" when the county
 *                     is missing or named like a US state (Washington County:
 *                     the shared resolver would read it as the state).
 *   - `due_date`    = the letting date and time printed on the index (bids
 *                     are opened then), in Central time.
 *   - `estimated_value` = ALDOT's bracket estimate ("$2,540,642 to
 *                     $3,105,229"), which ALDOT publishes as general size
 *                     information; the description says it is not a bid guide.
 *   - `source_url`  = the letting list page at that proposal's anchor
 *                     (…/NTC_September_25_2026.html#CALL001).
 *   - `solicitation_number` = project number(s) as printed;
 *     `notice_type` = "Construction letting".
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Proposals whose letting has opened are skipped (`closed`), and proposals
 * ALDOT marked "WITHDRAWN FROM LETTING" are skipped (`withdrawn`).
 *
 * IDENTITY: `external_id = aldot-<YYYYMMDD letting>-<call number>` — the call
 * number is unique within a letting, and a project re-let later is a new bid.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const ALDOT_SOURCE = "al_aldot";
export const ALDOT_ORIGIN = "https://alletting.aldot.gov";
export const ALDOT_INDEX_URL = `${ALDOT_ORIGIN}/`;
const ALDOT_AGENCY = "Alabama Department of Transportation";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export interface AldotLetting {
  /** "September 25, 2026" as printed. */
  label: string;
  /** Opening time as an ISO instant. */
  opensAt: string;
  /** Letting list page on ALDOT_ORIGIN. */
  listUrl: string;
}

export interface AldotCall {
  call: number;
  project: string;
  county: string; // "Chambers" ("" when missing)
  contractTime: string;
  scope: string; // "for constructing the …"
  bracket: string; // "$2,540,642 to $3,105,229" ("" when missing)
  /** ALDOT marked the proposal "**WITHDRAWN FROM LETTING**". */
  withdrawn: boolean;
  /** The block announces a MANDATORY pre-bid conference. */
  mandatoryPrebid: boolean;
}

export interface AldotParseResult {
  rows: RawBid[];
  calls: AldotCall[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

/** US Central offset (hours) for a calendar date: CDT 2nd Sun Mar – 1st Sun Nov. */
function centralOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -5 : -6;
}

/** "September 25, 2026 10:00 AM CDT" → 2026-09-25T15:00:00.000Z (Central). Invalid → null. */
export function aldotLettingToIso(text: string): string | null {
  const m = decode(text).match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)(?:\s+C[DS]?T)?$/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
  const [day, year] = [Number(m[2]), Number(m[3])];
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  if (m[6]!.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (m[6]!.toUpperCase() === "AM" && hour === 12) hour = 0;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - centralOffset(year, month, day) * 3_600_000;
  return new Date(utc).toISOString();
}

/** Keep the path, serve it from ALDOT_ORIGIN (the index links the older dot.state.al.us host). */
function onOrigin(href: string): string | null {
  try {
    const u = new URL(href.replace(/&amp;/g, "&"), ALDOT_INDEX_URL);
    return `${ALDOT_ORIGIN}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * The lettings on the index page: each printed date/time followed by its
 * "Project Letting List" link. A date with no list link is not returned.
 */
export function readAldotIndex(html: string): AldotLetting[] {
  const out: AldotLetting[] = [];
  const heads = [...html.matchAll(/<font[^>]*>\s*([A-Za-z]+\s+\d{1,2},\s*\d{4}\s+\d{1,2}:\d{2}\s*[AP]M(?:\s+C[DS]?T)?)\s*<\/font>/gi)];
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i]!;
    const start = head.index! + head[0].length;
    const end = i + 1 < heads.length ? heads[i + 1]!.index! : html.length;
    const block = html.slice(start, end);
    const link = block.match(/<a\s+href="([^"]+)"[^>]*>\s*Project Letting List\s*<\/a>/i);
    const opensAt = aldotLettingToIso(head[1]!);
    const listUrl = link ? onOrigin(link[1]!) : null;
    if (!opensAt || !listUrl) continue;
    out.push({ label: decode(head[1]!).replace(/\s+\d{1,2}:\d{2}.*$/, ""), opensAt, listUrl });
  }
  return out;
}

/** The proposal blocks of one Project Letting List page. */
export function readAldotLettingList(html: string): AldotCall[] {
  const calls: AldotCall[] = [];
  const re = /<a name="CALL(\d+)"><\/a>\s*<font[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/font>([\s\S]*?)(?=<a name="CALL\d+"|$)/gi;
  for (const m of html.matchAll(re)) {
    const head = decode(m[2]!).replace(/^\*+\s*/, "").replace(/^\d+\.\s*/, "");
    const comma = head.lastIndexOf(",");
    const project = (comma >= 0 ? head.slice(0, comma) : head).trim();
    const countyText = comma >= 0 ? head.slice(comma + 1).trim() : "";
    const county = /^(.+?)\s+COUNTY$/i.test(countyText) ? titleCase(countyText.replace(/\s+COUNTY$/i, "")) : "";
    const body = m[3]!;
    const time = body.match(/Contract Time:<\/b>\s*([^<]+)/i);
    const scope = body.match(/<p>\s*<b>\s*(for\s+[\s\S]*?)<\/b>/i);
    const bracket = decode(body).match(/Bracket Estimate on this project is from (\$[\d,]+) to (\$[\d,]+)/i);
    calls.push({
      call: Number(m[1]),
      project,
      county,
      contractTime: time ? decode(time[1]!) : "",
      scope: scope ? decode(scope[1]!) : "",
      bracket: bracket ? `${bracket[1]} to ${bracket[2]}` : "",
      // ALDOT's own spelling varies ("WITHDRAWN FORM LETTING").
      withdrawn: /WITHDRAWN\s+F(?:RO|OR)M\s+LETTING/i.test(body),
      mandatoryPrebid: /MANDATORY\s+pre-bid/i.test(body),
    });
  }
  return calls;
}

/** Alabama counties named like a US state: their name would win the state resolver. */
const STATE_NAMED_COUNTIES = new Set(["Washington"]);

/** "Chambers" → "Chambers County, Alabama"; "", Washington → "Alabama". */
export function aldotLocation(county: string): string {
  return county && !STATE_NAMED_COUNTIES.has(county) ? `${county} County, Alabama` : "Alabama";
}

/** "for constructing the Bridge Replacement (Grading, …) on SR-77 …" → "Bridge Replacement". */
export function aldotWork(scope: string): string {
  const m = scope.match(/^for\s+(?:constructing|the construction of)\s+(?:the\s+)?(.+?)(?:\s+\(|\s+on\s|\s+at\s|\s+in\s|\s+from\s|\.|$)/i);
  const work = m?.[1]?.trim() ?? "";
  return work.length >= 3 && work.length <= 200 ? work : "Highway construction";
}

/** The Central calendar date of an opening instant, as YYYYMMDD. */
function yyyymmdd(iso: string): string {
  return new Date(Date.parse(iso) - 6 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "");
}

function recordSkip(result: AldotParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of one letting list page — no network, no DB; `now` is injected. */
export function parseAldotLettingList(letting: AldotLetting, html: string, now: number = Date.now()): AldotParseResult {
  const result: AldotParseResult = { rows: [], calls: readAldotLettingList(html), skipped: {}, skippedRows: [] };
  const day = yyyymmdd(letting.opensAt);
  for (const c of result.calls) {
    const rowId = `aldot-${day}-${String(c.call).padStart(3, "0")}`;
    if (!c.project) {
      recordSkip(result, rowId, "no_project");
      continue;
    }
    if (c.withdrawn) {
      recordSkip(result, rowId, "withdrawn");
      continue;
    }
    if (Date.parse(letting.opensAt) <= now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const work = aldotWork(c.scope);
    const area = c.county ? `${c.county} County` : "Alabama";
    const title = `${work} — ALDOT project ${c.project}, ${area}`;
    const parts = [
      `Alabama DOT construction letting of ${letting.label}, call ${c.call}: project ${c.project}, ${area}.`,
      c.scope ? `${c.scope.charAt(0).toUpperCase()}${c.scope.slice(1)}` : "",
      c.contractTime ? `Contract time: ${c.contractTime}.` : "",
      c.mandatoryPrebid ? "A MANDATORY pre-bid conference applies (date and place on the letting list)." : "",
      c.bracket ? `Bracket estimate ${c.bracket} (general size information only, not a bidding guide).` : "",
      "Bidders must be prequalified by ALDOT. Proposals, plans and item lists are on ALDOT's Project Letting List (see source link).",
    ];
    const description = parts.filter(Boolean).join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency: ALDOT_AGENCY,
      description,
      location: aldotLocation(c.county),
      category: mapCategory("", title, description),
      due_date: letting.opensAt,
      estimated_value: c.bracket || "Not specified",
      source_url: `${letting.listUrl}#CALL${String(c.call).padStart(3, "0")}`,
      set_aside: null,
      notice_type: "Construction letting",
      solicitation_number: c.project,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${ALDOT_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(ALDOT_SOURCE, [detail]);
}

async function getText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    return await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch ALDOT's upcoming lettings and return one bid per proposal. */
export async function fetchAlAldotBids(now: number = Date.now()): Promise<FetchResult> {
  const index = await getText(ALDOT_INDEX_URL);
  const lettings = readAldotIndex(index);
  if (lettings.length === 0) fail(`page shape changed: no lettings with a Project Letting List (${index.length} bytes)`);
  const upcoming = lettings.filter((l) => Date.parse(l.opensAt) > now);
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  for (const letting of upcoming) {
    const html = await getText(letting.listUrl);
    const r = parseAldotLettingList(letting, html, now);
    if (r.calls.length === 0) fail(`page shape changed: no proposals on ${letting.listUrl}`);
    rows.push(...r.rows);
    for (const [k, n] of Object.entries(r.skipped)) skipped[k] = (skipped[k] ?? 0) + n;
    skippedRows.push(...r.skippedRows);
  }
  console.log(
    `  ${ALDOT_SOURCE}: ${rows.length} proposals accepted from ${upcoming.length} upcoming letting(s) (lettings on index: ${lettings.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
