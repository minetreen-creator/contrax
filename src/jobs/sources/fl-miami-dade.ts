/**
 * Miami-Dade County Strategic Procurement Department, construction solicitations
 * (owner 2026-10-29: "add Miami-Dade and Orange County bid boards").
 *
 * Read path (public, no login, no documents): the "Construction Solicitations"
 * page at /apps/ISD/stratproc/Home/CurrentSolicitations fills its table from
 *   https://www.miamidade.gov/apps/ISD/stratproc/Home/CurrentSolicitationsList
 * a JSON array of { solicitationNumber, solicitationType, title, openingDate,
 * postedDate } with dates as MM/DD/YYYY. One request per run; detail pages
 * (SolicitationDetails?solNumber=…) are linked, not fetched.
 *
 * The feed gives the opening day but no time, so the deadline is the end of that
 * day in Miami (Eastern time, DST-aware). Rows whose day has passed are skipped.
 *
 * Captured 2026-10-29 (fixtures/fl-miami-dade): 22 open solicitations (roofing,
 * park walkways, pool repairs, marinas, drainage, streetlights, demolition).
 *
 * Orange County, FL was looked at the same day and is not read: its live board
 * moved to OpenGov Procurement, which sits behind a Cloudflare bot check, and the
 * legacy OrangeBids page (apps.ocfl.net/OrangeBids/bidopen.asp) only lists four
 * stale 2019–2023 items with no due dates.
 */
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import { mapCategory } from "~/lib/trade-classification";
import type { RawBid } from "./sam-gov";

export const MIAMI_DADE_SOURCE = "fl_miami_dade";
const ORIGIN = "https://www.miamidade.gov/apps/ISD/stratproc/Home";
export const MIAMI_DADE_LIST_URL = `${ORIGIN}/CurrentSolicitationsList`;
const BUYER = "Miami-Dade County";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)",
  accept: "application/json",
  "x-requested-with": "XMLHttpRequest",
};

export interface MiamiDadeSolicitation {
  solicitationNumber: string;
  solicitationType: string;
  title: string;
  openingDate: string;
  postedDate: string;
}

export const miamiDadeDetailUrl = (number: string): string =>
  `${ORIGIN}/SolicitationDetails?solNumber=${encodeURIComponent(number)}`;

/** Minutes Eastern time is behind UTC on that calendar day (240 in EDT, 300 in EST). PURE. */
function easternOffsetMinutes(y: number, m: number, d: number): number {
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(noon)
    .find((p) => p.type === "timeZoneName")?.value;
  const h = /GMT([+-]\d{1,2})/.exec(name ?? "");
  return h ? -Number(h[1]) * 60 : 300;
}

/** "11/04/2026" → 23:59 that day in Miami, as ISO; null when unreadable. PURE. */
export function miamiDadeDateToIso(date: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(date ?? "");
  if (!m) return null;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d, 23, 59) + easternOffsetMinutes(y, mo, d) * 60_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The feed body → solicitations; throws when it is not the expected array. PURE. */
export function parseMiamiDadeList(body: string): MiamiDadeSolicitation[] {
  const data = JSON.parse(body) as unknown;
  if (!Array.isArray(data)) throw new Error("not an array");
  return data.filter(
    (r): r is MiamiDadeSolicitation =>
      !!r && typeof r === "object" && typeof (r as MiamiDadeSolicitation).solicitationNumber === "string",
  );
}

/** One solicitation → a bid row, or the reason it is skipped. PURE. */
export function miamiDadeRow(sol: MiamiDadeSolicitation, now: number = Date.now()): RawBid | { skip: string } {
  const number = sol.solicitationNumber.trim().replace(/\s+/g, " ");
  const title = (sol.title ?? "").trim().replace(/\s+/g, " ");
  if (!number || !title) return { skip: "missing_fields" };
  const due = miamiDadeDateToIso(sol.openingDate);
  if (!due) return { skip: "no_deadline" };
  if (Date.parse(due) < now) return { skip: "closed" };
  const kind = sol.solicitationType === "A&E" ? "architecture and engineering (A&E) solicitation" : "construction solicitation";
  const description = [
    `Miami-Dade County ${kind} ${number}, posted ${sol.postedDate} by the Strategic Procurement Department.`,
    `Bids open ${sol.openingDate}. Scope, commodity codes, packages and addendums are on the county's notice page (see source link).`,
  ].join(" ");
  return {
    external_id: `miamidade-${number}`,
    title,
    agency: BUYER,
    description,
    location: "Miami-Dade County, FL",
    category: mapCategory("", title, description),
    due_date: due,
    estimated_value: "Not specified",
    source_url: miamiDadeDetailUrl(number),
    set_aside: null,
    naics_code: null,
    psc: null,
    notice_type: sol.solicitationType || "Bids & Contracts",
    solicitation_number: number,
  };
}

export async function fetchFlMiamiDadeBids(now: number = Date.now()): Promise<FetchResult> {
  let resp: Response;
  try {
    resp = await fetch(MIAMI_DADE_LIST_URL, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new SourceUnreachableError(MIAMI_DADE_SOURCE, [requestFailureDetail(e)]);
  }
  if (!resp.ok) throw new SourceUnreachableError(MIAMI_DADE_SOURCE, [httpFailureDetail(resp.status, MIAMI_DADE_LIST_URL)]);
  let sols: MiamiDadeSolicitation[];
  try {
    sols = parseMiamiDadeList(await resp.text());
  } catch {
    throw new SourceUnreachableError(MIAMI_DADE_SOURCE, [`${MIAMI_DADE_SOURCE}: ${MIAMI_DADE_LIST_URL} is no longer a JSON list — feed restructured`]);
  }
  const result: FetchResult = { rows: [], skipped: {}, skippedRows: [] };
  for (const sol of sols) {
    const row = miamiDadeRow(sol, now);
    if ("skip" in row) {
      result.skipped[row.skip] = (result.skipped[row.skip] ?? 0) + 1;
      result.skippedRows.push({ id: `miamidade-${sol.solicitationNumber}`, reason: row.skip });
    } else result.rows.push(row);
  }
  console.log(`  ${MIAMI_DADE_SOURCE}: ${result.rows.length} open bids accepted (skips: ${JSON.stringify(result.skipped)})`);
  return result;
}
