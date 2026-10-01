/**
 * South Carolina Business Opportunities — `sc_scbo`, the state's official
 * advertising publication for public bids (scbo.sc.gov, run by the Division
 * of Procurement Services).
 *
 * WHY: Contrax had no state South Carolina feed. State law sends state
 * agencies' solicitations to SCBO, and counties, cities, school districts,
 * technical colleges, utilities and housing authorities advertise there too,
 * so one source covers most of the state's public bidding.
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA: 430 current ads in
 * the kept categories): the "online edition".
 *   1. GET /online-edition — today's overview, one link per category with its
 *      ad count: <a href="/online-edition?c=3-2026-10-01">122 ads</a>.
 *   2. GET each kept category's link — every current ad of that category on
 *      one page, ads separated by `<div class="space" style="padding-top:22px;">`.
 *      Each ad is a run of label/value cells ("Ad Title:", "Bid/Submittal Due
 *      Date:", …) and a "Print Ad" link /printad?a=<id>. The parsed ad count
 *      must equal the overview's count, so a layout change fails loudly.
 *
 * KEPT CATEGORIES: Architectural/Engineering (qualifications, due at the
 * "Resume Deadline"), Construction, Consultant/Professional, Environmental
 * Remediation, Equipment, Information Technology, Maintenance/Repair, Minor
 * Construction, Printing, Services, Supplies, Auditing. NOT fetched: Sole
 * Source and Emergency (no competition), For Sale (the state selling
 * surplus) and Notices/Cooperative Purchasing (announcements).
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = "Project Name" or "Ad Title"; `solicitation_number` =
 *     "Project Number" or "Solicitation #".
 *   - `agency` = "Agency/Owner" or "Purchasing Agent/Entity".
 *   - `location` = "South Carolina" (every advertiser is a South Carolina
 *     public body); the ad's own "Project Location" goes in the description.
 *   - `due_date` = the ad's due date and time, in Eastern time.
 *   - `description` = the ad's description with the buyer's name replaced by
 *     "the buyer" (agency words cause false trade matches), plus the project
 *     location, delivery method and pre-bid information when given. Emails
 *     and phone numbers inside the ad text are replaced too.
 *   - `estimated_value` = "Construction Cost Range" when the ad gives one.
 *   - `notice_type` = the SCBO category; `source_url` = the ad's printable
 *     page /printad?a=<id>. Buyer names, emails and phones are not ingested.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Ads whose due date has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = scbo-<ad id>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const SCBO_SOURCE = "sc_scbo";
export const SCBO_ORIGIN = "https://scbo.sc.gov";
export const SCBO_OVERVIEW_URL = `${SCBO_ORIGIN}/online-edition`;
const MAX_DESCRIPTION = 1500;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** SCBO category ids that carry biddable solicitations → notice type. */
export const SCBO_KEPT_CATEGORIES: Record<string, string> = {
  "2": "Architectural/Engineering services",
  "3": "Construction",
  "4": "Consultant/Professional services",
  "5": "Environmental remediation",
  "6": "Equipment",
  "7": "Information technology",
  "8": "Maintenance/Repair",
  "9": "Minor construction",
  "10": "Printing",
  "11": "Services",
  "12": "Supplies",
  "13": "Auditing",
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const TITLE_LABELS = ["Project Name", "Ad Title"];
const AGENCY_LABELS = ["Agency/Owner", "Purchasing Agent/Entity"];
const NUMBER_LABELS = ["Project Number", "Solicitation #"];
const DUE_LABELS = ["Bid/Submittal Date & Time", "Bid/Submittal Due Date", "Quote Due Date & Time", "Resume Deadline"];

export interface ScboCategoryLink {
  id: string;
  url: string;
  count: number;
}

export interface ScboAd {
  id: string;
  fields: Record<string, string>;
}

export interface ScboParseResult {
  rows: RawBid[];
  ads: ScboAd[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** US Eastern offset (hours) for a calendar date: EDT 2nd Sun Mar – 1st Sun Nov. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "October 29, 2026 - 2:00pm" → ISO (Eastern). A date with no time → 12:00 AM. Invalid → null. */
export function scboDateToIso(text: string): string | null {
  const m = text
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s*[-–@]?\s*(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)?$/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
  const [day, year] = [Number(m[2]), Number(m[3])];
  let hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  if (month < 1 || day < 1 || day > 31 || hour > 12 || minute > 59 || (m[4] && hour < 1)) return null;
  if (m[6]?.toLowerCase() === "p" && hour !== 12) hour += 12;
  if (m[6]?.toLowerCase() === "a" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - easternOffset(year, month, day) * 3_600_000).toISOString();
}

/** The overview's category links with their ad counts. */
export function readScboOverview(html: string): ScboCategoryLink[] {
  const out: ScboCategoryLink[] = [];
  for (const m of html.matchAll(/<a href="(\/online-edition\?c=(\d+)-\d{4}-\d{2}-\d{2})"[^>]*>\s*(\d+)\s+ads?\s*<\/a>/gi)) {
    out.push({ id: m[2]!, url: `${SCBO_ORIGIN}${m[1]!}`, count: Number(m[3]) });
  }
  return out;
}

/** The ads of one category page, as label → value maps. */
export function readScboCategory(html: string): ScboAd[] {
  const ads: ScboAd[] = [];
  for (const block of html.split(/<div class="space" style="padding-top:22px;"><\/div>/i)) {
    const id = block.match(/\/printad\?a=(\d+)/)?.[1];
    if (!id) continue;
    const start = block.lastIndexOf('<div class="space" style="padding-top:12px;"></div>');
    const body = start >= 0 ? block.slice(start) : block;
    const fields: Record<string, string> = {};
    const cell = /<b>([^<]{2,60}):<\/b>\s*<\/div>(?:\s*<\/div>)?\s*<div[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="adata_itm|<\/div>)/gi;
    for (const m of body.matchAll(cell)) {
      const label = decode(m[1]!);
      if (!(label in fields)) fields[label] = decode(m[2]!);
    }
    ads.push({ id, fields });
  }
  return ads;
}

function first(fields: Record<string, string>, labels: readonly string[]): string {
  for (const l of labels) {
    const v = fields[l]?.trim();
    if (v && !/^(n\/?a|none|tbd)$/i.test(v)) return v;
  }
  return "";
}

/** Contact details inside ad text are not ingested (the ad page has them). */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recordSkip(result: ScboParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse of one kept category page — no network, no DB; `now` is injected. */
export function parseScboCategory(categoryId: string, html: string, now: number = Date.now()): ScboParseResult {
  const result: ScboParseResult = { rows: [], ads: readScboCategory(html), skipped: {}, skippedRows: [] };
  const noticeType = SCBO_KEPT_CATEGORIES[categoryId] ?? "Solicitation";
  for (const ad of result.ads) {
    const rowId = `scbo-${ad.id}`;
    const f = ad.fields;
    const title = first(f, TITLE_LABELS);
    const agency = first(f, AGENCY_LABELS);
    if (!title || !agency) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const dueText = first(f, DUE_LABELS);
    const due = dueText ? scboDateToIso(dueText) : null;
    if (!due) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const scrub = (s: string) =>
      s
        .replace(EMAIL_RE, "(email on the ad)")
        .replace(PHONE_RE, "(phone on the ad)")
        .replace(new RegExp(`(?:\\bthe\\s+)?${escapeRegExp(agency)}`, "gi"), "the buyer");
    let text = scrub(f["Description"] ?? "");
    if (text.length > MAX_DESCRIPTION) text = `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
    const rawWhere = f["Project Location"]?.trim() ?? "";
    const where = rawWhere.toLowerCase() === agency.toLowerCase() ? "" : rawWhere;
    const method = first(f, ["Project Delivery Method", "Anticipated Project Delivery Method"]);
    const prebid = first(f, ["Pre-Bid Information"]);
    const description = [
      text,
      where ? `Project location: ${scrub(where)}.` : "",
      method ? `Delivery method: ${method}.` : "",
      prebid ? `Pre-bid: ${scrub(prebid)}` : "",
      `Advertised in South Carolina Business Opportunities (${noticeType})${f["Ad Publish Date"] ? ` on ${f["Ad Publish Date"]}` : ""}.`,
    ]
      .filter(Boolean)
      .join(" ");
    const number = first(f, NUMBER_LABELS);
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "South Carolina",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: first(f, ["Construction Cost Range"]) || "Not specified",
      source_url: `${SCBO_ORIGIN}/printad?a=${ad.id}`,
      set_aside: null,
      notice_type: noticeType,
      solicitation_number: number || ad.id,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${SCBO_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(SCBO_SOURCE, [detail]);
}

async function getText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    return await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch today's SCBO online edition (kept categories) and return ingest rows. */
export async function fetchScScboBids(now: number = Date.now()): Promise<FetchResult> {
  const overview = readScboOverview(await getText(SCBO_OVERVIEW_URL));
  if (overview.length === 0) fail("page shape changed: no category links on the online edition overview");
  const kept = overview.filter((c) => c.id in SCBO_KEPT_CATEGORIES && c.count > 0);
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  let ads = 0;
  for (const cat of kept) {
    const r = parseScboCategory(cat.id, await getText(cat.url), now);
    if (r.ads.length !== cat.count) {
      fail(`page shape changed: category ${cat.id} lists ${cat.count} ads, parsed ${r.ads.length}`);
    }
    ads += r.ads.length;
    rows.push(...r.rows);
    for (const [k, n] of Object.entries(r.skipped)) skipped[k] = (skipped[k] ?? 0) + n;
    skippedRows.push(...r.skippedRows);
  }
  console.log(
    `  ${SCBO_SOURCE}: ${rows.length} open ads accepted (ads read: ${ads} in ${kept.length} categories; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
