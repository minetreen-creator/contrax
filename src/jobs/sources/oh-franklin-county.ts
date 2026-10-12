/**
 * Franklin County, Ohio (Columbus area) bids and RFPs — `oh_franklin_county`.
 *
 * WHY (owner 2026-10-12): a Worthington, OH visitor's janitorial scan found no
 * Ohio bids; we read only Dayton, Worthington and Ohio DOT there. The County
 * Purchasing Department posts every County solicitation on its own board.
 *
 * SOURCE (verified live 2026-10-12, no login, no CAPTCHA, no robots.txt rule):
 *   GET https://bids.franklincountyohio.gov/          — table of solicitations
 *   GET https://bids.franklincountyohio.gov/bids.cfm?id=N — one solicitation
 * The table lists Reference Number, Title (linked to bids.cfm?id=N), Opening
 * Date (MM/DD/YYYY) and a contact. Closed solicitations stay in the table, so a
 * row whose opening date is before today (Eastern) is skipped as `closed`.
 *
 * DEADLINE RULE (never guess): the detail page states "Opening Date:
 * 10/28/2026 at 2:00 PM"; that time is read as Eastern. A detail page that
 * cannot be read or states no time falls back to the table's date at 11:59 PM
 * Eastern (the date-only convention), and the description says no time was
 * stated. A row with no readable date is skipped (`no_deadline`).
 *
 * WHAT A ROW BECOMES: `title` = the linked title; `solicitation_number` = the
 * reference number; `notice_type` = RFP / RFQ / ITB / IFB from it when stated;
 * `agency` = "Franklin County, Ohio"; `location` = "Franklin County, OH";
 * `source_url` = the bids.cfm page. Contacts are not stored.
 *
 * IDENTITY: `external_id = franklin-county-oh-<id>` (the County's own id).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const OH_FRANKLIN_COUNTY_SOURCE = "oh_franklin_county";
export const OH_FRANKLIN_COUNTY_ORIGIN = "https://bids.franklincountyohio.gov";
const AGENCY = "Franklin County, Ohio";
const LOCATION = "Franklin County, OH";
const MAX_DETAILS = 30;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface FranklinListing {
  id: string;
  reference: string;
  title: string;
  /** Opening date from the table, as y/m/d. */
  date: { year: number; month: number; day: number } | null;
}

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(s: string): FranklinListing["date"] {
  const m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2020) return null;
  return { year, month, day };
}

/** Rows of the County's bid table, in page order. PURE. */
export function readFranklinListings(html: string): FranklinListing[] {
  const out: FranklinListing[] = [];
  const seen = new Set<string>();
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!);
    if (cells.length < 3) continue;
    const link = cells[1]!.match(/href="bids\.cfm\?id=(\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const id = link[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, reference: clean(cells[0]!), title: clean(link[2]!), date: parseDate(clean(cells[2]!)) });
  }
  return out;
}

/** The "Opening Date: MM/DD/YYYY at H:MM AM/PM" time on a detail page, or null. PURE. */
export function readFranklinOpening(html: string): { date: FranklinListing["date"]; hour: number; minute: number } | null {
  const text = clean(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
  const m = text.match(/Opening Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*at\s*(\d{1,2}):(\d{2})\s*([AP])\.?M\.?/i);
  if (!m) return null;
  const date = parseDate(m[1]!);
  let hour = Number(m[2]);
  const minute = Number(m[3]);
  if (!date || hour < 1 || hour > 12 || minute > 59) return null;
  if (m[4]!.toUpperCase() === "P" && hour !== 12) hour += 12;
  if (m[4]!.toUpperCase() === "A" && hour === 12) hour = 0;
  return { date, hour, minute };
}

/** Eastern offset (hours): EDT −4 from the 2nd Sunday of March to the 1st Sunday of November, else EST −5. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

function easternIso(d: { year: number; month: number; day: number }, hour: number, minute: number): string {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, hour, minute) - easternOffset(d.year, d.month, d.day) * 3_600_000).toISOString();
}

function noticeType(reference: string): string | null {
  const m = reference.toUpperCase().match(/\b(RFP|RFQ|RFI|ITB|IFB)\b/);
  return m ? m[1]! : null;
}

/** One table row (+ its detail page when read) → a row, or a skip reason. PURE. */
export function franklinRow(
  listing: FranklinListing,
  detailHtml: string | null,
  now: number,
): { row: RawBid } | { skip: string } {
  const opening = detailHtml ? readFranklinOpening(detailHtml) : null;
  const date = opening?.date ?? listing.date;
  if (!date) return { skip: "no_deadline" };
  const iso = opening ? easternIso(date, opening.hour, opening.minute) : easternIso(date, 23, 59);
  if (Date.parse(iso) <= now) return { skip: "closed" };
  const url = `${OH_FRANKLIN_COUNTY_ORIGIN}/bids.cfm?id=${listing.id}`;
  const description = [
    `Franklin County, Ohio solicitation ${listing.reference}: ${listing.title}.`,
    opening ? "" : "No opening time is stated; the opening date is shown.",
    "Bid documents, forms and Q&A are on the County Purchasing Department's page (see source link).",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    row: {
      external_id: `franklin-county-oh-${listing.id}`,
      title: listing.title,
      agency: AGENCY,
      description,
      location: LOCATION,
      category: mapCategory("", listing.title, ""),
      due_date: iso,
      estimated_value: "",
      source_url: url,
      set_aside: null,
      notice_type: noticeType(listing.reference),
      solicitation_number: listing.reference || null,
      naics_code: null,
      psc: null,
    },
  };
}

function fail(detail: string): never {
  console.error(`  ${OH_FRANKLIN_COUNTY_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(OH_FRANKLIN_COUNTY_SOURCE, [detail]);
}

/** Today's date in New York, for the table's date-only "already closed" check. */
function easternToday(now: number): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Fetch the County's bid table, read open rows' detail pages, return open rows. */
export async function fetchOhFranklinCountyBids(now: number = Date.now()): Promise<FetchResult> {
  let html = "";
  try {
    const resp = await fetch(`${OH_FRANKLIN_COUNTY_ORIGIN}/`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, OH_FRANKLIN_COUNTY_ORIGIN));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  }
  if (!/Bid Opportunities/i.test(html) || !/Opening/i.test(html)) fail("page shape changed: not the Bid Opportunities table");
  const listings = readFranklinListings(html);
  const today = easternToday(now);
  const todayKey = today.year * 10000 + today.month * 100 + today.day;
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  let details = 0;
  for (const listing of listings) {
    const d = listing.date;
    // A table date before today is closed; don't open its page.
    const open = !d || d.year * 10000 + d.month * 100 + d.day >= todayKey;
    let detail: string | null = null;
    if (open && details < MAX_DETAILS) {
      details++;
      try {
        const resp = await fetch(`${OH_FRANKLIN_COUNTY_ORIGIN}/bids.cfm?id=${listing.id}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
        if (resp.status === 200) detail = await resp.text();
      } catch {
        detail = null;
      }
    }
    const r = franklinRow(listing, detail, now);
    if ("row" in r) rows.push(r.row);
    else {
      skipped[r.skip] = (skipped[r.skip] ?? 0) + 1;
      skippedRows.push({ id: listing.id, reason: r.skip });
    }
  }
  console.log(
    `  ${OH_FRANKLIN_COUNTY_SOURCE}: ${rows.length} open solicitations accepted (listed ${listings.length}; skips: ${
      Object.entries(skipped).map(([k, n]) => `${k}=${n}`).join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
