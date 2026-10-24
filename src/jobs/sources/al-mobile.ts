import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import type { FetchResult } from "../runner";

export const MOBILE_URL = "https://www.cityofmobile.gov/bids/";
function fail(message: string): never { throw new SourceUnreachableError("al_mobile", [message]); }
const text = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

/**
 * Published local closing time: Mobile uses America/Chicago, including DST.
 * The board types times by hand ("12:01pm", owner 2026-10-24: also "10:00 am",
 * "10 A.M.", "Noon"), so the meridiem may be spaced, dotted or upper case and
 * the minutes may be missing.
 */
export function mobileDeadline(date: string, time: string): string | null {
  const d = date.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  const t = /^(?:12:00\s*)?noon$/i.test(time.trim()) ? ["", "12", "00", "p"] : time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i);
  const month = d ? "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ").indexOf(d[1]) + 1 : 0;
  const minute = t ? +(t[2] ?? "0") : 0;
  if (!d || !t || !month || +t[1] < 1 || +t[1] > 12 || minute > 59) return null;
  const target = {year: +d[3], month, day: +d[2], hour: +t[1] % 12 + (t[3].toLowerCase() === "p" ? 12 : 0), minute};
  const local = Date.UTC(target.year, month - 1, target.day, target.hour, target.minute);
  const fmt = new Intl.DateTimeFormat("en-US", {timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23"});
  const matches = [5, 6].map(offset => new Date(local + offset * 3600000)).filter(value => {
    const parts = Object.fromEntries(fmt.formatToParts(value).map(p => [p.type, Number(p.value)]));
    return Object.entries(target).every(([key, val]) => parts[key] === val);
  });
  return matches.length === 1 ? matches[0].toISOString() : null;
}

export function parseMobileHtml(html: string, now = Date.now()): FetchResult {
  if (!/<h2[^>]*>\s*All Open Bids\s*<\/h2>/i.test(html)) fail("open-board heading missing");
  const table = html.match(/<table\b[^>]*>[\s\S]*?<caption[^>]*>List of Bids<\/caption>[\s\S]*?<\/table>/i)?.[0];
  if (!table || !/Date Due[\s\S]*Bid Time[\s\S]*Bid Number[\s\S]*Title/.test(table)) fail("bid table or columns changed");
  const body = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (body === undefined) fail("bid table body missing");
  const result: FetchResult = {rows: [], skipped: {}, skippedRows: []};
  if (!/href="[^"\n]*[?&]bid=/.test(body) && /no (?:open |current )?(?:bids|records|results)/i.test(text(body))) return result;
  const blocks = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (!blocks.length && !/no (?:open |current )?(?:bids|records|results)/i.test(text(body))) fail("no rows or explicit empty-board message");
  const seen = new Set<string>();
  let rowNumber = 0;
  for (const block of blocks) {
    rowNumber++;
    const cells = [...block[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (cells.length !== 6) fail("bid row columns changed");
    const [department, date, time, number, title] = cells.map(text);
    const link = cells[3].match(/href="([^"]+)"/)?.[1];
    if (!department || !number || !title || !link) {
      // One half-entered notice skips that row (owner 2026-10-24: the board briefly carried a row
      // missing one of these, which sank every Mobile bid); a board with no complete row still fails below.
      const missing = Object.entries({department, number, title, link}).filter(([, v]) => !v).map(([k]) => k);
      console.warn(`  al_mobile: row ${rowNumber} skipped, missing ${missing.join(", ")} (number "${number}", title "${title.slice(0, 80)}")`);
      result.skipped.missing_fields = (result.skipped.missing_fields ?? 0) + 1;
      result.skippedRows.push({id: `mobile-row-${rowNumber}`, reason: "missing_fields"});
      continue;
    }
    const url = new URL(text(link), MOBILE_URL);
    const id = url.searchParams.get("bid");
    if (url.origin !== new URL(MOBILE_URL).origin || url.pathname !== "/bids/" || !id || !/^\d+$/.test(id)) fail("unexpected source link");
    const due = mobileDeadline(date, time);
    const external_id = `mobile-${id}`;
    // One hand-typed closing time we can't read skips that notice (owner 2026-10-24: bid
    // 4244 alone used to sink the whole board); a board where none parse still fails below.
    const reason = !due ? "bad_date" : Date.parse(due) <= now ? "closed" : seen.has(id) ? "duplicate" : null;
    if (reason) { result.skipped[reason] = (result.skipped[reason] ?? 0) + 1; result.skippedRows.push({id: external_id, reason}); continue; }
    seen.add(id);
    const description = `City of Mobile ${department} public bid notice. Published closing: ${date} ${time}, Mobile local time (America/Chicago). Refer to the official notice and attachments for full scope, submission requirements and amendments.`;
    result.rows.push({external_id, title, agency: "City of Mobile", description, location: "Mobile, AL", category: mapCategory("", title, description), due_date: due!, source_url: `${MOBILE_URL}?bid=${id}`, estimated_value: "", solicitation_number: number.replace(/\s*\*+$/, ""), naics_code: null, psc: null, set_aside: null, notice_type: null});
  }
  if (blocks.length > 0 && (result.skipped.missing_fields ?? 0) === blocks.length) fail("required bid identity missing on every row");
  if (blocks.length > 0 && (result.skipped.missing_fields ?? 0) + (result.skipped.bad_date ?? 0) === blocks.length) fail("no bid row has a readable closing time; the date or time format changed");
  return result;
}

export async function fetchMobileBids(now = Date.now(), fetchPage: typeof fetch = fetch): Promise<FetchResult> {
  try {
    const response = await fetchPage(MOBILE_URL, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) fail(`HTTP ${response.status}`);
    const result = parseMobileHtml(await response.text(), now);
    console.log(`  al_mobile: ${result.rows.length} open notices; ${JSON.stringify(result.skipped)}`);
    return result;
  } catch (error) {
    if (error instanceof SourceUnreachableError) throw error;
    return fail(`request/parse failed: ${(error as Error).message}`);
  }
}
