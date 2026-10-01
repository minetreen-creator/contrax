/**
 * New York State Contract Reporter — `ny_nyscr`, New York's official board of
 * state procurement (www.nyscr.ny.gov, run by Empire State Development).
 *
 * WHY: Contrax's New York rows came from the federal SAM.gov pass (the old
 * `nys_socrata` feed was retired). Every NY state agency, authority, SUNY
 * campus and public benefit corporation must advertise bids of $150,000 or
 * more here, and many municipalities, school districts and authorities (MTA,
 * Thruway, NYPA, DASNY, NYCHA, …) advertise here too.
 *
 * SOURCE (verified live 2026-10-01, no login, no CAPTCHA): the public search
 * page GET /Ads/Search?Status=Open&Top=100&Skip=<n> renders up to 100 open ads
 * as HTML cards (`<div class="opp-list-item …" data-ad-id="<CR#>">` with
 * labelled rows: Title (full text in a `title="Full Title: …"` attribute),
 * Agency, Division, Issue date, Due date, Location, Category, Ad type) and
 * the total ("Opportunities: 798"). The connector pages until it has them
 * all. Opening an ad's full text needs a free NYSCR account, so each row
 * links to the public search for its CR#, which shows that one ad.
 *
 * WHAT IS KEPT: ads a business can respond to — "General" solicitations,
 * RFIs/RFCs, discretionary and MWBE/SDVOB/small-business discretionary
 * purchases, and continuous procurement solicitations. Skipped with a reason
 * code: "Contractor Ads" (primes looking for subcontractors, no public
 * buyer), sole/single-source and exempt notices, grant/funding notices and
 * surplus-property sales; also ads whose due date has passed.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = the full title, verbatim.
 *   - `agency`      = Agency (NYSCR's own wording, e.g. "Transportation, NYS
 *                     Dept. of"), with the Division appended when given.
 *   - `location`    = "<Location>, New York" when the ad names a place, else
 *                     "New York". If the shared resolver would read the
 *                     place as another state ("Delaware County"), it is
 *                     "New York" (the place stays in the description).
 *   - `due_date`    = Due date (M/D/YYYY, no time) at 11:59 PM Eastern; text
 *                     such as "Until contract is awarded" → NULL (open-ended).
 *   - `description` = ad type, CR#, NYSCR category and place (not the buyer).
 *   - `solicitation_number` = CR#; `notice_type` = Ad type.
 *   - `source_url`  = https://www.nyscr.ny.gov/Ads/Search?Keyword=<CR#>
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 *
 * IDENTITY: `external_id = nyscr-<CR#>`.
 */
import { resolveStateFromText } from "~/lib/location-state";
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const NYSCR_SOURCE = "ny_nyscr";
export const NYSCR_ORIGIN = "https://www.nyscr.ny.gov";
export const NYSCR_PAGE_SIZE = 100;
export const NYSCR_MAX_PAGES = 40;
const NYSCR_PAGE_DELAY_MS = 500;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Ad types that are NOT something a business bids on to a public buyer. */
const SKIPPED_AD_TYPES: { test: RegExp; reason: string }[] = [
  { test: /^contractor ads$/i, reason: "contractor_ad" },
  { test: /sole\/single source|exempt from advertising/i, reason: "sole_source_notice" },
  { test: /grant or notice of funds/i, reason: "grant_notice" },
  { test: /surplus property/i, reason: "surplus_sale" },
];

/** Places that are not a place ("Statewide", "TBD", …) → just "New York". */
const NON_PLACES = /^(statewide|various|tbd|n\/?a|see (the )?documents?|nys|new york( state)?|multiple( locations)?|various locations)$/i;

export function nyscrSearchUrl(skip: number, top: number = NYSCR_PAGE_SIZE): string {
  return `${NYSCR_ORIGIN}/Ads/Search?Status=Open&Top=${top}&Skip=${skip}`;
}

export function nyscrAdUrl(crNumber: string): string {
  return `${NYSCR_ORIGIN}/Ads/Search?Keyword=${encodeURIComponent(crNumber)}`;
}

export interface NyscrAd {
  id: string;
  title: string;
  agency: string;
  division: string;
  issue: string;
  due: string;
  location: string;
  category: string;
  adType: string;
}

export interface NyscrParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelled(card: string, label: string): string {
  const m = card.match(new RegExp(`>\\s*${escapeRe(label)}\\s*</div>\\s*<div class="px-2[^"]*">([\\s\\S]*?)</div>`));
  return m ? decode(m[1]) : "";
}

/** Total open ads the page reports ("Opportunities: 798"), or null. */
export function nyscrTotal(html: string): number | null {
  const m = decode(html).match(/Opportunities:\s*([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** True when the HTML is the NYSCR search results page. */
export function isNyscrSearchPage(html: string): boolean {
  return html.includes('id="Search"') && /Opportunities:/.test(html);
}

/** Read the ad cards on one results page. */
export function readNyscrPage(html: string): NyscrAd[] {
  const parts = html.split(/<div class="opp-list-item[^"]*" data-ad-id="(\d+)">/);
  const ads: NyscrAd[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const card = parts[i + 1] ?? "";
    const full = card.match(/title="Full Title: ([^"]*)"/);
    ads.push({
      id: parts[i],
      title: decode(full ? full[1] : ""),
      agency: labelled(card, "Agency:"),
      division: labelled(card, "Division:"),
      issue: labelled(card, "Issue date:"),
      due: labelled(card, "Due date:"),
      location: labelled(card, "Location:"),
      category: labelled(card, "Category:"),
      adType: labelled(card, "Ad type:"),
    });
  }
  return ads;
}

/** US Eastern offset (hours) for a calendar date: EDT 2nd Sun Mar – 1st Sun Nov. */
function easternOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -4 : -5;
}

/** "10/29/2026" → 11:59 PM Eastern that day, as UTC ISO. Anything else → null. */
export function nyscrDueToIso(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day, 23, 59) - easternOffset(year, month, day) * 3_600_000).toISOString();
}

/** The stored location: the ad's place in New York, or "New York". */
export function nyscrLocation(place: string): string {
  const p = place.trim().replace(/[.,;]+$/, "");
  if (!p || NON_PLACES.test(p)) return "New York";
  const candidate = /\b(NY|New York)\b/.test(p) ? p : `${p}, New York`;
  return resolveStateFromText(candidate) === "NY" ? candidate : "New York";
}

function recordSkip(result: NyscrParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseNyscrAds(ads: readonly NyscrAd[], now: number = Date.now()): NyscrParseResult {
  const result: NyscrParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const ad of ads) {
    const rowId = `nyscr-${ad.id}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    const skip = SKIPPED_AD_TYPES.find((s) => s.test.test(ad.adType));
    if (skip) {
      recordSkip(result, rowId, skip.reason);
      continue;
    }
    if (!ad.title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const due = nyscrDueToIso(ad.due);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = [ad.agency, ad.division].filter(Boolean).join(" — ") || "New York State (NYSCR)";
    // The buyer is not repeated here (trade matching reads the description and
    // agency names contain trade words); NYSCR's own category is, because it
    // is the ad's classification of the work.
    const description = [
      `${ad.adType || "Ad"} CR# ${ad.id} on the New York State Contract Reporter${ad.issue ? `, issued ${ad.issue}` : ""}.`,
      ad.category ? `NYSCR category: ${ad.category}.` : "",
      ad.location ? `Location: ${ad.location}.` : "",
      due ? "" : ad.due ? `Due: ${ad.due}.` : "",
      "Full ad and documents: free NYSCR account (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: ad.title,
      agency,
      description,
      location: nyscrLocation(ad.location),
      category: mapCategory("", ad.title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: nyscrAdUrl(ad.id),
      set_aside: null,
      notice_type: ad.adType || null,
      solicitation_number: ad.id,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(detail: string): never {
  console.error(`  ${NYSCR_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(NYSCR_SOURCE, [detail]);
}

async function fetchPage(skip: number): Promise<string> {
  const url = nyscrSearchUrl(skip);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, url));
    const html = await resp.text();
    if (!isNyscrSearchPage(html)) fail(`page shape changed: not the NYSCR search page (${html.length} bytes)`);
    return html;
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch every open NYSCR ad and return ingest rows. */
export async function fetchNyNyscrBids(now: number = Date.now()): Promise<FetchResult> {
  const ads: NyscrAd[] = [];
  let total: number | null = null;
  for (let page = 0; page < NYSCR_MAX_PAGES; page++) {
    const html = await fetchPage(page * NYSCR_PAGE_SIZE);
    total ??= nyscrTotal(html);
    const pageAds = readNyscrPage(html);
    ads.push(...pageAds);
    if (pageAds.length < NYSCR_PAGE_SIZE || (total !== null && ads.length >= total)) break;
    await sleep(NYSCR_PAGE_DELAY_MS);
  }
  if (ads.length === 0) fail("no ads on the search page");
  const { rows, skipped, skippedRows } = parseNyscrAds(ads, now);
  console.log(
    `  ${NYSCR_SOURCE}: ${rows.length} open ads accepted (read ${ads.length} of ${total ?? "?"}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
