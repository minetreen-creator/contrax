/**
 * Tennessee Board of Regents construction bid list (`tn_tbr`) — owner 2026-11-06: "I want ALL
 * construction bids in TN". TBR Facilities Development advertises building, HVAC, site and
 * renovation projects for the state's community colleges and TCATs (and some partner campuses).
 *
 * SOURCE (verified 2026-11-06, no login): one public Drupal table
 *   GET https://www.tbr.edu/facilities/construction-bid-list
 * Columns: Submittal Deadline ("December 2, 2026 02:00 PM local time" / office / type),
 * Project ("in Columbia, TN" / project number / institution / name), Project Description,
 * Solicitor (the designer firm and its contact).
 *
 * WHAT A ROW BECOMES (data honesty):
 *   - `due_date` = the Submittal Deadline in the project city's local time. Tennessee spans two
 *     zones: cities in Eastern-time counties are read as Eastern, listed Central cities as Central,
 *     and any other city by TBR's office (Knoxville office = Eastern, Nashville office = Central).
 *   - `location` = the project city; `agency` = "Tennessee Board of Regents (<institution>)".
 *   - The designer firm is named in the description; personal contacts are not stored.
 * Skipped: deadline passed (`closed`), unreadable deadline (`bad_date`), no project number or name
 * (`missing_fields`), repeats (`duplicate`).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const TN_TBR_SOURCE = "tn_tbr";
export const TBR_BID_LIST_URL = "https://www.tbr.edu/facilities/construction-bid-list";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";

/** Cities in Tennessee's Eastern-time counties where TBR and TCAT campuses sit. */
const EASTERN_CITIES = new Set([
  "knoxville", "strawberry plains", "friendsville", "maryville", "alcoa", "harriman", "oak ridge", "rockwood", "kingston",
  "morristown", "sevierville", "greeneville", "tazewell", "blountville", "kingsport", "elizabethton", "johnson city", "gray",
  "bristol", "cleveland", "athens", "vonore", "madisonville", "chattanooga", "oneida", "jacksboro", "lafollette", "newport",
  "rogersville", "dandridge", "lenoir city", "loudon", "dayton", "etowah", "mountain city", "erwin", "sneedville", "rutledge",
  "maynardville", "wartburg", "huntsville", "benton", "decatur", "jefferson city", "seymour", "pigeon forge", "gatlinburg",
  "clinton", "lake city", "sweetwater",
]);
/** Central-time cities a Knoxville-office project may name. */
const CENTRAL_CITIES = new Set(["crossville", "jamestown", "kimball", "jasper", "pikeville", "dunlap", "spencer", "livingston", "sparta", "cookeville"]);

export function tbrZone(city: string, office: string): "America/New_York" | "America/Chicago" {
  const c = city.toLowerCase().trim();
  if (EASTERN_CITIES.has(c)) return "America/New_York";
  if (CENTRAL_CITIES.has(c)) return "America/Chicago";
  return /knoxville/i.test(office) ? "America/New_York" : "America/Chicago";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "December 2, 2026 02:00 PM" in `zone` → ISO UTC, DST-aware; null when invalid. PURE. */
export function tbrDeadline(v: string, zone: "America/New_York" | "America/Chicago"): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M/i.exec(v.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const [d, y, h12, mi] = [+m[2], +m[3], +m[4], +m[5]];
  if (mo < 1 || d < 1 || d > 31 || h12 < 1 || h12 > 12 || mi > 59) return null;
  const target = { year: y, month: mo, day: d, hour: (h12 % 12) + (m[6].toUpperCase() === "P" ? 12 : 0), minute: mi };
  const wall = Date.UTC(y, mo - 1, d, target.hour, mi);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const hits = (zone === "America/Chicago" ? [5, 6] : [4, 5]).map((o) => new Date(wall + o * 3_600_000)).filter((t) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Object.entries(target).every(([k, val]) => p[k] === val);
  });
  return hits.length === 1 ? hits[0].toISOString() : null;
}

const lines = (cell: string) =>
  cell.split(/<br\s*\/?>/i).map((l) => l.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);

const NOTICE: [RegExp, string][] = [[/^bid$|invitation to bid|^itb$/i, "ITB"], [/proposal|^rfp$/i, "RFP"], [/qualification|^rfq$/i, "RFQ"]];

export interface TbrParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseTbrBidList(html: string, now: number = Date.now()): TbrParseResult {
  if (!/Submittal Deadline/.test(html) || !/views-table/.test(html)) {
    throw new SourceUnreachableError(TN_TBR_SOURCE, ["Construction bid table missing (page changed)"]);
  }
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) { skip("unknown", "missing_fields"); continue; }
    const [deadline = "", office = "", type = ""] = lines(cells[0]);
    const proj = lines(cells[1]);
    const city = (proj[0] ?? "").replace(/^in\s+/i, "").replace(/,\s*TN$/i, "").replace(/Nashvillle/i, "Nashville").trim();
    const [number = "", institution = "", name = ""] = proj.slice(1);
    const description = lines(cells[2]).join(" ").replace(/([^.!?])$/, "$1.");
    const firm = lines(cells[3])[0] ?? "";
    if (!number || !name) { skip(number || "unknown", "missing_fields"); continue; }
    if (seen.has(number)) { skip(number, "duplicate"); continue; }
    seen.add(number);
    const zone = tbrZone(city, office);
    const due = tbrDeadline(deadline, zone);
    if (!due) { skip(number, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(number, "closed"); continue; }
    const tz = zone === "America/New_York" ? "Eastern" : "Central";
    rows.push({
      external_id: `tbr-${number}`,
      title: name,
      agency: institution ? `Tennessee Board of Regents (${institution})` : "Tennessee Board of Regents",
      location: city ? `${city}, TN` : "Tennessee",
      description: `TBR Facilities Development ${type || "bid"} ${number}${institution ? ` for ${institution}` : ""}: ${name}.${description ? ` ${description}` : ""} Submittal deadline ${deadline.replace(/\s*local time/i, "")} ${tz} time.${firm ? ` Documents from the designer, ${firm.replace(/\.$/, "")}.` : ""}`,
      category: mapCategory("", name, description),
      due_date: due,
      estimated_value: "",
      source_url: TBR_BID_LIST_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: NOTICE.find(([re]) => re.test(type))?.[1] ?? (type || null),
    });
  }
  return { rows, skipped, skippedRows };
}

export const tbrDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

export async function fetchTnTbrBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const r = await tbrDeps.fetch(TBR_BID_LIST_URL, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseTbrBidList(await r.text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(TN_TBR_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
