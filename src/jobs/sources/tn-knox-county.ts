/**
 * Knox County, TN Procurement solicitations (`tn_knox_county`) — owner 2026-11-06: "I want ALL
 * construction bids in TN". Knox County also buys for Knox County Schools (e.g. "New K-8
 * School/Knox County Schools").
 *
 * SOURCE (verified 2026-11-06, no login): one public HTML table
 *   GET https://www.knoxcounty.org/apps/solicitations/solicitations.php
 * Columns: Name of Solicitation, Solicitation Number, Deadline Due Date (MM-DD-YY), Buyer,
 * Attachments (public PDF links). A "Note:" row may follow a solicitation (pre-bid meetings).
 *
 * WHAT A ROW BECOMES (data honesty):
 *   - `due_date` = the Deadline Due Date at 11:59 PM Eastern (the date-only convention: the
 *     table states no time; the description says so).
 *   - `source_url` = the solicitation PDF when linked, else the list page.
 *   - Buyer names and phone numbers are not stored.
 * Skipped: date already passed (`closed`), unreadable date (`bad_date`), no title or number
 * (`missing_fields`), repeats (`duplicate`).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const TN_KNOX_COUNTY_SOURCE = "tn_knox_county";
export const KNOX_SOLICITATIONS_URL = "https://www.knoxcounty.org/apps/solicitations/solicitations.php";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";

const text = (s: string) =>
  s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** 11:59 PM Eastern on a MM-DD-YY date → ISO UTC; null when invalid. PURE. */
export function knoxDeadline(mmddyy: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(mmddyy.trim());
  if (!m) return null;
  const [y, mo, d] = [2000 + +m[3], +m[1], +m[2]];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // 23:59 New York wall time is 03:59 or 04:59 UTC the next day.
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23", day: "numeric" });
  for (const off of [4, 5]) {
    const t = new Date(Date.UTC(y, mo - 1, d, 23 + off, 59));
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    if (p.hour === 23 && p.day === d) return t.toISOString();
  }
  return null;
}

export interface KnoxParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseKnoxSolicitations(html: string, now: number = Date.now()): KnoxParseResult {
  if (!/Deadline Due Date/.test(html) || !/Solicitation Number/.test(html)) {
    throw new SourceUnreachableError(TN_KNOX_COUNTY_SOURCE, ["Solicitations table missing (page changed)"]);
  }
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  const entry = /<td[^>]*>\s*<!--\s*=mysql_result\(\$query, \$i, "title"\)\s*-->([\s\S]*?)<\/td>\s*<td>\s*<!--[^>]*"bid"[^>]*-->\s*([\s\S]*?)<\/td>\s*<td>([^<]*)<\/td>/g;
  const hits = [...html.matchAll(entry)];
  hits.forEach((m, i) => {
    const title = text(m[1]);
    const number = text(m[2]);
    const block = html.slice(m.index! + m[0].length, hits[i + 1]?.index ?? html.length);
    if (!title || !number) { skip(number || "unknown", "missing_fields"); return; }
    if (seen.has(number)) { skip(number, "duplicate"); return; }
    seen.add(number);
    const due = knoxDeadline(m[3]);
    if (!due) { skip(number, "bad_date"); return; }
    if (Date.parse(due) <= now) { skip(number, "closed"); return; }
    const pdf = /<a href='(\/purchasing\/pdfs\/showfile\.php\?[^']+)'>\s*Click Here for the Solicitation/.exec(block)?.[1];
    const note = /Note:\s*([\s\S]*?)<\/td>/.exec(block)?.[1];
    const noteText = note ? ` Note: ${text(note)}` : "";
    rows.push({
      external_id: `knoxcounty-${number}`,
      title,
      agency: "Knox County",
      location: "Knox County, TN",
      description: `Knox County Procurement solicitation ${number}: ${title}. Due ${m[3].trim()} (the list gives no time; check the solicitation document).${noteText}`,
      category: mapCategory("", title, noteText),
      due_date: due,
      estimated_value: "",
      source_url: pdf ? new URL(pdf.replace(/&&/g, "&"), KNOX_SOLICITATIONS_URL).href.replace(/ /g, "%20") : KNOX_SOLICITATIONS_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: null,
    });
  });
  return { rows, skipped, skippedRows };
}

export const knoxDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

export async function fetchTnKnoxCountyBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const r = await knoxDeps.fetch(KNOX_SOLICITATIONS_URL, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseKnoxSolicitations(await r.text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(TN_KNOX_COUNTY_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
