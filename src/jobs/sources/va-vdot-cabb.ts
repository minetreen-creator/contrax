/**
 * Virginia Department of Transportation highway construction advertisements —
 * `va_vdot_cabb` (owner 2026-11-04: "we need more construction bids in VA").
 *
 * WHY: VDOT is Virginia's largest construction buyer. Its highway construction
 * contracts (paving, latex/plant mix schedules, SMART SCALE roadway work,
 * bridges) are advertised on VDOT's Construction Advertisement Bulletin Board,
 * which VDOT's Advertisements page names as where they are posted.
 *
 * SOURCE (captured 2026-11-04 from a GitHub Actions job, no login, no CAPTCHA):
 *   https://cabb.virginiadot.org/AdProjectInfoList.aspx
 * an ASP.NET list, 20 advertised projects a page ("Displaying results 1 - 20
 * (of 54)"). Page 1 is a GET; later pages are the list's own "Next" postback
 * (the same form a person's click submits). The host has no robots.txt.
 * Proposals, plans and PDFs are never fetched; each row links to its public
 * project history page (AdProjectHistory.aspx), which is not fetched either.
 *
 * WHAT A ROW BECOMES (data honesty):
 *   - `title` = the advertised description, then the county/city as listed
 *     ("SMART SCALE - ROADWAY AND PEDESTRIAN IMPROVEMENTS — Martinsville").
 *   - `due_date` = the Let Date at 12:00 AM Eastern. The list has no time; bids
 *     are due at that letting, so a row is never shown open later than it is.
 *   - `estimated_value` = the list's Value column, as published.
 *   - `solicitation_number` = the state project number(s); the order number,
 *     route, begin site and time limit go in the description.
 *   - `location` = the listed counties/cities with ", VA", or "Virginia" for
 *     "Various" and for a name the state resolver would read as another state
 *     (Washington County).
 *   - `category` = "Construction": CABB lists only highway construction contracts.
 * Skipped: let date passed (`closed`), unreadable let date (`bad_date`), no id
 * or description (`missing_fields`), repeated id (`duplicate`).
 *
 * IDENTITY: `external_id = vdotcabb-<AD_PRJ_ID>` (CABB's own project id; the
 * order number is reused across lettings, the project id is not).
 */
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import { odotLettingToIso } from "./oh-odot";
import type { RawBid } from "./sam-gov";

export const VDOT_CABB_SOURCE = "va_vdot_cabb";
export const VDOT_CABB_HOST = "https://cabb.virginiadot.org";
export const VDOT_CABB_LIST_URL = `${VDOT_CABB_HOST}/AdProjectInfoList.aspx`;
export const VDOT_AGENCY = "Virginia Department of Transportation";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const MAX_PAGES = 10;

export interface CabbRow {
  id: string;
  order: string;
  letDate: string;
  projects: string;
  route: string;
  places: string;
  value: string;
  description: string;
  beginSite: string;
  timeLimit: string;
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** The project rows on one list page, in page order. PURE. */
export function readCabbRows(html: string): CabbRow[] {
  const out: CabbRow[] = [];
  const re = /<tr id='[^']*_projectlistControl_row1_(\d+)'[^>]*>([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(re)) {
    const cells = [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    if (cells.length < 15) continue;
    out.push({
      id: m[1],
      order: cells[2],
      letDate: cells[6],
      projects: cells[7],
      route: cells[8],
      places: cells[9],
      value: cells[10],
      description: cells[11],
      beginSite: cells[12],
      timeLimit: cells[14],
    });
  }
  return out;
}

/** "Displaying results 1 - 20 (of 54)" → 54; null when the pager is missing. PURE. */
export function cabbTotal(html: string): number | null {
  const m = /Displaying results(?:&nbsp;|\s)*\d+\s*-\s*\d+\s*\(of\s*(\d+)\)/i.exec(html);
  return m ? Number(m[1]) : null;
}

/** The postback target of the pager's "Next" link, or null on the last page. PURE. */
export function cabbNextTarget(html: string): string | null {
  return /__doPostBack\('([^']+)',''\)">Next</.exec(html)?.[1] ?? null;
}

const STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "ohio",
  "oklahoma", "oregon", "pennsylvania", "tennessee", "texas", "utah", "vermont", "washington", "wisconsin", "wyoming",
]);

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

/** "BEDFORD, FRANKLIN" → "Bedford, Franklin"; "Various" stays "Various". PURE. */
export function cabbPlaces(raw: string): string {
  return raw
    .split(",")
    .map((p) => titleCase(p.trim()))
    .filter(Boolean)
    .join(", ");
}

export function cabbLocation(places: string): string {
  const names = places.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0 || names.includes("various") || names.some((n) => STATE_NAMES.has(n))) return "Virginia";
  return `${places}, VA`;
}

export interface VdotCabbParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseVdotCabb(list: readonly CabbRow[], now: number = Date.now()): VdotCabbParseResult {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const r of list) {
    const id = String(r.id ?? "").trim();
    const desc = String(r.description ?? "").trim();
    if (!id || !desc) { skip(id || "unknown", "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const due = odotLettingToIso(r.letDate);
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    const places = cabbPlaces(r.places);
    const projects = r.projects.replace(/\s*,\s*/g, ", ").trim();
    const value = r.value.replace(/\.00$/, "").trim();
    const details = [
      `order ${r.order}`,
      places && places !== "Various" ? `location ${places}` : "various locations",
      r.route && r.route !== "Various" ? `route ${r.route}` : "",
      r.beginSite && r.beginSite !== "Various" ? `begins ${r.beginSite}` : "",
      projects ? `state project ${projects}` : "",
      r.timeLimit ? `contract time limit ${r.timeLimit}` : "",
    ].filter(Boolean);
    rows.push({
      external_id: `vdotcabb-${id}`,
      title: places ? `${desc} — ${places}` : desc,
      agency: VDOT_AGENCY,
      location: cabbLocation(places),
      description: `VDOT highway construction advertisement: ${desc} (${details.join("; ")}). Bids are due at VDOT's ${r.letDate} letting. Proposals, plans, plan holders and notices are on VDOT's Construction Advertisement Bulletin Board (CABB).`,
      category: "Construction",
      due_date: due,
      estimated_value: value || "Not specified",
      source_url: `${VDOT_CABB_HOST}/AdProjectHistory.aspx?AD_PRJ_ID=${encodeURIComponent(id)}`,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: projects || null,
      notice_type: "Construction letting",
    });
  }
  return { rows, skipped, skippedRows };
}

const hidden = (html: string, name: string) =>
  (new RegExp(`id="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "")
    .replace(/&#43;/g, "+")
    .replace(/&#47;/g, "/")
    .replace(/&amp;/g, "&");

export const vdotCabbDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  pause: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

async function page(init: RequestInit, cookie: string): Promise<{ html: string; cookie: string }> {
  const r = await vdotCabbDeps.fetch(VDOT_CABB_LIST_URL, {
    ...init,
    headers: { "user-agent": UA, accept: "text/html", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const set = r.headers.get("set-cookie");
  const next = set ? set.split(/,(?=\s*[A-Za-z0-9_.-]+=)/).map((c) => c.split(";")[0].trim()).join("; ") : cookie;
  const html = await r.text();
  if (!html.includes("projectlistControl")) throw new Error("advertisement list shape changed");
  return { html, cookie: next };
}

export async function fetchVaVdotCabbBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    let { html, cookie } = await page({ method: "GET" }, "");
    const total = cabbTotal(html);
    if (total === null) throw new Error("advertisement count missing");
    const all = readCabbRows(html);
    const ids = new Set(all.map((r) => r.id));
    for (let p = 1; ids.size < total; p++) {
      if (p >= MAX_PAGES) throw new Error(`${total} advertised; refusing partial coverage`);
      const target = cabbNextTarget(html);
      if (!target) break;
      await vdotCabbDeps.pause(2000);
      const body = new URLSearchParams({
        __EVENTTARGET: target,
        __EVENTARGUMENT: "",
        __VIEWSTATE: hidden(html, "__VIEWSTATE"),
        __VIEWSTATEGENERATOR: hidden(html, "__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: hidden(html, "__EVENTVALIDATION"),
      });
      ({ html, cookie } = await page({ method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }, cookie));
      const more = readCabbRows(html).filter((r) => !ids.has(r.id));
      if (more.length === 0) break; // the page did not move: stop, then refuse below
      for (const r of more) ids.add(r.id);
      all.push(...more);
    }
    if (ids.size < total) throw new Error(`read ${ids.size} of ${total} advertisements; refusing partial coverage`);
    return parseVdotCabb(all, now);
  } catch (e) {
    throw new SourceUnreachableError(VDOT_CABB_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
