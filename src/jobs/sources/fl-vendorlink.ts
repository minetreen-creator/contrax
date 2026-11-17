/**
 * VendorLink: the bid board many Florida school districts and Central Florida cities post on
 * (owner 2026-11-16: "we need more janitorial sources nationwide", then "School" for Florida school
 * districts). Hillsborough, Polk, Manatee, Marion, Volusia, Sarasota, Collier, St. Johns, Seminole,
 * Pinellas and other school boards, Brevard County, Ocala, Kissimmee, DeLand and about 60 more public
 * bodies list their solicitations on one public page, www.myvendorlink.com/external/bids. Orange
 * County Public Schools, Osceola County with its School Board, and State College of Florida run the
 * same software on their own addresses.
 *
 * Read on 2026-11-16 by a GitHub Actions job as ContraxBot, with no login: 86 Active on the shared
 * board, 12 on Osceola's, 2 on Orange County Public Schools'. Each site's robots.txt allows the
 * public /external/ pages to crawlers that are not on its named list; ContraxBot is not on it.
 *
 * What is read: the public Bids page and one search of it (Status = Active, 100 a page). Nothing
 * else. A solicitation's own page is a form post behind the list, so it is not requested; every row
 * links to the public Bids page and names the agency and number to look up there.
 *
 * DATA HONESTY
 * - Only public bodies in Florida whose place is known are stored. The board also carries electric
 *   cooperatives, chambers and associations (`not_a_public_body`), a few buyers in other states
 *   (`out_of_state`), and may add agencies this file has never seen (`unknown_agency`: counted and
 *   printed, never guessed into Florida).
 * - "All times are listed as the listing agency's local time zone" (the page's own note): Eastern,
 *   except the Panhandle agencies marked Central below.
 * - A row with no due date cannot be shown as open, so it is skipped (`no_deadline`). Sole-source
 *   notices are not competitions (`not_competitive`).
 */
import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import type { FetchResult } from "../runner";
import { zonedIso } from "./revize-bids";
import type { RawBid } from "./sam-gov";

const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
type Zone = "America/New_York" | "America/Chicago";

export interface VendorlinkSite { source: string; origin: string; label: string; /** The agency, when the site lists one buyer and prints no Agency column. */ onlyAgency?: string }

export const VENDORLINK_SITES: readonly VendorlinkSite[] = [
  { source: "fl_vendorlink", origin: "https://www.myvendorlink.com", label: "VendorLink" },
  { source: "fl_orange_schools_vendorlink", origin: "https://vendorlink.ocps.net", label: "Orange County Public Schools' VendorLink", onlyAgency: "Orange County Public Schools" },
  { source: "fl_osceola_vendorlink", origin: "https://vendorlink.osceola.org", label: "Osceola County's VendorLink" },
  { source: "fl_scf_vendorlink", origin: "https://vendorlink.scf.edu", label: "State College of Florida's VendorLink", onlyAgency: "State College of Florida, Manatee–Sarasota" },
];

/** Agencies that are not government buyers, or are another VendorLink address's listing. */
const NOT_PUBLIC = /electric (?:cooperative|membership|association)|electric$|power association|energy \(now|chamber of commerce|sheriffs.? association|association of texas|foundation|\bLLC\b|academy|museum|community club|educationplus|^vendorlink$|center of excellence|cooperatives association/i;
/** Public bodies on the board that are not in Florida. */
const OUT_OF_STATE = /madison, georgia|murfreesboro|farragut|forrest county/i;

/** Agencies whose place is not in their name. */
const PLACES: Record<string, string> = {
  "Canaveral Port Authority": "Port Canaveral, FL",
  "CareerSource Central Florida": "Orlando, FL",
  "Florida Municipal Power Agency": "Orlando, FL",
  "Homosassa Special Water District": "Homosassa, FL",
  "Housing Authority of Brevard County and Melbourne Housing Authority": "Brevard County, FL",
  "Keys Energy Services": "Key West, FL",
  "Kissimmee Utility Authority": "Kissimmee, FL",
  "Lake-Sumter State College": "Leesburg, FL",
  "Melbourne Orlando International Airport": "Melbourne, FL",
  "Merritt Island Redevelopment Agency": "Merritt Island, FL",
  "Orlando Utilities Commission": "Orlando, FL",
  "Pensacola State College": "Pensacola, FL",
  "Pinellas Suncoast Fire and Rescue District": "Indian Rocks Beach, FL",
  "St. Johns River State College": "Palatka, FL",
  "State College of Florida, Manatee–Sarasota": "Bradenton, FL",
  "Tampa Sports Authority": "Tampa, FL",
  "Toho Water Authority": "Kissimmee, FL",
  "Valencia College": "Orlando, FL",
  "West Volusia Hospital Authority": "DeLand, FL",
  "Winter Park Housing Authority": "Winter Park, FL",
  "Gainesville Community Redevelopment Agency": "Gainesville, FL",
  "City of New Smyrna Beach Utilities Commission": "New Smyrna Beach, FL",
  "Hillsborough County Public Schools": "Hillsborough County, FL",
  "Orange County Public Schools": "Orange County, FL",
  "Collier County Public Schools": "Collier County, FL",
  "Seminole County Public Schools": "Seminole County, FL",
};
/** The Florida Panhandle west of the Apalachicola keeps Central time. */
const CENTRAL = /^(City of Milton|Pensacola State College)$/;

export type VendorlinkPlace = { location: string; zone: Zone } | "not_a_public_body" | "out_of_state" | "unknown_agency";

/** Where an agency is, from its own name. Never guesses a place for a name it cannot read. PURE. */
export function vendorlinkPlace(agency: string): VendorlinkPlace {
  const a = agency.replace(/\s*\(now on [^)]*\)\s*$/i, "").trim();
  if (!a) return "unknown_agency";
  if (OUT_OF_STATE.test(a)) return "out_of_state";
  if (NOT_PUBLIC.test(a)) return "not_a_public_body";
  const zone: Zone = CENTRAL.test(a) ? "America/Chicago" : "America/New_York";
  if (PLACES[a]) return { location: PLACES[a], zone };
  const city = /^(?:City|Town) of (.+)$/.exec(a);
  if (city) return { location: `${city[1]}, FL`, zone };
  const county = /^(.+? County)\b/.exec(a);
  if (county) return { location: `${county[1]}, FL`, zone };
  return "unknown_agency";
}

const decode = (s: string) =>
  s.replace(/&nbsp;|&#160;/g, " ").replace(/&#8211;|&ndash;/g, "–").replace(/&#8217;|&rsquo;|&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface VendorlinkItem { agency: string; number: string; title: string; online: boolean; status: string; due: string; preBid: boolean }

/**
 * The results grid of the public Bids page. `rows` is every data row printed; null means the page
 * has neither a grid nor the board's own "No Bids Found" line, so it could not be read. PURE.
 */
export function readVendorlinkGrid(html: string, site: VendorlinkSite): { items: VendorlinkItem[]; rows: number } | null {
  const grid = /<table[^>]*grvSolicitations[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!grid) return /No Bids Found/i.test(html) ? { items: [], rows: 0 } : null;
  const trs = [...grid.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  const head = [...(trs[0] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => text(m[1]).toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [iAgency, iNumber, iTitle, iOnline, iStatus, iPre, iDue] = [col("agency"), col("number"), col("title"), col("online quote/bid"), col("status"), col("mandatory pre-bid"), col("due date")];
  if (iNumber < 0 || iTitle < 0 || iStatus < 0 || iDue < 0 || (iAgency < 0 && !site.onlyAgency)) return null;
  const items: VendorlinkItem[] = [];
  for (const tr of trs.slice(1)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < head.length) continue;
    const checked = (i: number) => i >= 0 && /checked=/i.test(tds[i]);
    items.push({
      agency: iAgency >= 0 ? text(tds[iAgency]) : site.onlyAgency!,
      number: text(tds[iNumber]),
      title: text(tds[iTitle]),
      online: checked(iOnline),
      status: text(tds[iStatus]),
      due: text(tds[iDue]),
      preBid: checked(iPre),
    });
  }
  return { items, rows: trs.length - 1 };
}

/** "11/17/2026 1:00 PM" in the agency's zone → ISO UTC. PURE. */
export function vendorlinkDeadline(v: string, zone: Zone): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(v.trim());
  if (!m || +m[4] < 1 || +m[4] > 12) return null;
  return zonedIso(zone, +m[3], +m[1], +m[2], (+m[4] % 12) + (/p/i.test(m[6]) ? 12 : 0), +m[5]);
}

export function mapVendorlink(items: readonly VendorlinkItem[], site: VendorlinkSite, now: number = Date.now()): FetchResult {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  const skip = (id: string, reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({ id, reason }); };
  for (const it of items) {
    const id = `vendorlink-${slug(it.agency)}-${slug(it.number)}`;
    if (!it.agency || !it.number || !it.title) { skip(id, "missing_fields"); continue; }
    if (!/^active$/i.test(it.status)) { skip(id, "not_active"); continue; }
    const place = vendorlinkPlace(it.agency);
    if (typeof place === "string") { skip(place === "unknown_agency" ? `${id} (${it.agency})` : id, place); continue; }
    if (/^(sole|single) source\b/i.test(it.title)) { skip(id, "not_competitive"); continue; }
    if (!it.due) { skip(id, "no_deadline"); continue; }
    const due = vendorlinkDeadline(it.due, place.zone);
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const agency = it.agency.replace(/\s*\(now on [^)]*\)\s*$/i, "").trim();
    const zoneWord = place.zone === "America/Chicago" ? "Central" : "Eastern";
    const description =
      `${agency} solicitation ${it.number}: ${it.title}. Closes ${it.due} ${zoneWord}.` +
      `${it.online ? " Responses are submitted online through VendorLink." : ""}${it.preBid ? " A mandatory pre-bid meeting is listed." : ""}` +
      ` The documents are on ${site.label}'s public Bids page: choose ${agency} and the Active status, then number ${it.number}.`;
    rows.push({
      external_id: id,
      title: it.title,
      agency,
      description,
      location: place.location,
      category: mapCategory("", it.title, ""),
      due_date: due,
      estimated_value: "",
      source_url: `${site.origin}/external/bids`,
      solicitation_number: it.number,
    });
  }
  return { rows, skipped, skippedRows };
}

/** Network seam (tests replace it). */
export const vendorlinkDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  pause: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

/** The search form's fields: the page's own hidden fields plus Status = Active, 100 a page. PURE. */
export function vendorlinkSearchForm(pageHtml: string, order: "SolicitationDueDateASC" | "SolicitationDueDateDESC"): URLSearchParams | null {
  const form = new URLSearchParams();
  for (const m of pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    if (name) form.set(name, decode(/value="([^"]*)"/.exec(m[0])?.[1] ?? ""));
  }
  if (!form.get("__VIEWSTATE")) return null;
  const f = (k: string, v: string) => form.set(`ctl00$RegionMiddle$${k}`, v);
  for (const k of ["ddlAgency", "ddlFiscalYear", "ddlDepartment", "txtTitle", "txtNotes", "txtNumber", "tbCommodityKeyword"]) f(k, "");
  f("ddlStatus", "2");
  f("rblSolicitationPageCount", "100");
  f("ddlSolicitationOrderBy", order);
  f("btnSearch", "Search Bids");
  return form;
}

export async function fetchVendorlinkBids(site: VendorlinkSite, now: number = Date.now()): Promise<FetchResult> {
  const fail = (detail: string): never => { throw new SourceUnreachableError(site.source, [detail]); };
  const url = `${site.origin}/external/bids`;
  try {
    const first = await vendorlinkDeps.fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (!first.ok) fail(`HTTP ${first.status} on the Bids page`);
    const page = await first.text();
    const search = async (order: "SolicitationDueDateASC" | "SolicitationDueDateDESC") => {
      const form = vendorlinkSearchForm(page, order);
      if (!form) return fail("the Bids page has no search form");
      await vendorlinkDeps.pause(3000);
      const res = await vendorlinkDeps.fetch(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Referer: url }, body: form, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) fail(`HTTP ${res.status} on the Active search`);
      return readVendorlinkGrid(await res.text(), site) ?? fail("the Active search answered with no results grid");
    };
    const soonest = await search("SolicitationDueDateASC");
    let items = soonest.items;
    // A full page means there are more than 100 Active: read the list from the other end too.
    if (soonest.rows >= 100) items = [...items, ...(await search("SolicitationDueDateDESC")).items];
    const result = mapVendorlink(items, site, now);
    if (soonest.rows >= 100 && result.skipped.duplicate === undefined) console.warn(`  ${site.source}: more than 200 Active; the middle of the list was not read`);
    console.log(`  ${site.source}: ${result.rows.length} open from ${items.length} Active rows; ${JSON.stringify(result.skipped)}`);
    for (const s of result.skippedRows.filter((r) => r.reason === "unknown_agency")) console.warn(`  ${site.source}: agency not known to this reader, not stored: ${s.id}`);
    return result;
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    return fail(`fetch failed: ${(e as Error).message}`);
  }
}

export const VENDORLINK_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = VENDORLINK_SITES.map((s) => ({
  name: s.source,
  fetchFn: () => fetchVendorlinkBids(s),
}));
