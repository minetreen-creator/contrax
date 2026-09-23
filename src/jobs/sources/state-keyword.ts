/**
 * State Keyword Procurement Source Factory
 *
 * Creates a SAM.gov keyword source for any US state (or DC). Replaces the
 * individual per-state source files (nc.ts, sc.ts, tx.ts, fl.ts, md-dc.ts,
 * va-ev.ts) with a single parameterized factory — one source per state, each
 * isolated so a failing state never blocks the others.
 *
 * API: GET https://sam.gov/api/prod/sgs/v1/search/?q=<StateName>&...
 * Same headers/format as sam-gov.ts — see that file for field mappings.
 *
 * NATIONWIDE CORRECTNESS FIX ⑤ STEP A (owner-locked scope, PR B1)
 * --------------------------------------------------------------
 * A door row used to carry title/agency/description/location/category/due_date
 * and NOTHING else, even though the v2 detail payload the door already fetched
 * for place-of-performance ALSO carries the PSC, the notice type and SAM's own
 * solicitation number. Two consequences, both measured:
 *   - the stored row could not participate in the 5-dimension natural key
 *     (notice_type/psc NULL ⇒ the key degenerated to (title, agency), which is
 *     exactly how 4,059 duplicate groups / 14,690 rows accumulated); and
 *   - the door's `external_id` was `<st>-<_id>`, i.e. SAM's notice VERSION id
 *     behind a per-door prefix, so the same notice had a different id in every
 *     door and identity was not stable across doors.
 * This file now (a) keeps the SAME single detail request per notice and reads
 * its classificationCode / type / solicitationNumber out of it (no extra network
 * call, no extra load on SAM.gov), and (b) writes the canonical
 * `sam-<parentNoticeId || _id>` external_id plus a `notice_key` for the
 * run-level identity guard (src/jobs/notice-identity.ts).
 *
 * UNCHANGED, deliberately: the search URL shape (`q=<StateName>`, size 25,
 * MAX_PAGES 1, is_active=true, no state=/psc=/naics= filter), the
 * place-of-performance-first location with the honest "Unknown" fallback (never
 * the query state), the category classifier, due_date, estimated_value, the
 * `<StateName> Agency` fallback, and NAICS — a door never supplies a NAICS code,
 * so the row's code stays inference-derived (`naics_code_source='inferred'`).
 * set_aside is also untouched (the doors' NULL set-aside sits inside the
 * owner-gated cert-matching decision, option E).
 */

import {
  canonicalNoticeId,
  extractNoticeType,
  fetchOpportunityDetailFull,
  type OpportunityDetailWithLocation,
  type PlaceOfPerformance,
  type RawBid,
} from "./sam-gov";
import {
  failureDetail,
  FetchFailures,
  FetchRequestError,
  httpFailureDetail,
} from "../fetch-failure";
import { mapCategory as classifyCategory } from "~/lib/trade-classification";

/** 2-letter state code → full state name (50 states + District of Columbia). */
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

const SAM_API = "https://sam.gov/api/prod/sgs/v1/search/";
const PAGE_SIZE = 25;
const MAX_PAGES = 1;
const DELAY_MS = 500;
/** Politeness delay after each v2 detail request (same as the other passes). */
const DETAIL_DELAY_MS = 120;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const STATE_ABBREVS =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The empty detail bundle (used when a notice carries no id at all). */
const EMPTY_DETAIL: OpportunityDetailWithLocation = {
  setAside: null,
  naicsCode: null,
  psc: null,
  noticeType: null,
  solicitationNumber: null,
  placeOfPerformance: null,
};

/** Trimmed value or null — mirrors the mapper's normalization of SAM's own
 * (space-padded) solicitation numbers. */
function trimOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  return v === "" ? null : v;
}

/** Deterministic test seam: the v1 page fetcher + the v2 detail fetcher. */
export interface StateKeywordDeps {
  /** v1 search page fetcher; injected in tests from saved fixtures (zero
   *  network). Defaults to the real SAM.gov search call. */
  fetchJson?: (url: string) => Promise<any>;
  /** v2 detail fetcher; injected in tests from a saved payload (zero network).
   *  Defaults to `fetchOpportunityDetailFull` — the SAME mapper the national
   *  pass and the trade passes use. */
  detailFetcher?: (noticeId: string) => Promise<OpportunityDetailWithLocation>;
  /** Override the per-detail politeness delay (tests use 0). */
  detailDelayMs?: number;
}

/** The real page fetch. A failed request THROWS (see fetch-failure.ts): the old
 *  `return null` collapsed "SAM.gov refused the request" into "the page had no
 *  items", which is how a dead door could read as an honest EMPTY zero. */
async function defaultFetchJson(tag: string, page: number, url: string): Promise<any> {
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) {
    console.error(`  ${tag} page ${page} returned ${resp.status}`);
    throw new FetchRequestError(httpFailureDetail(resp.status, url), {
      status: resp.status,
      url,
    });
  }
  return resp.json();
}

/**
 * Creates a SAM.gov keyword source for a single state.
 *
 * @param stateName Full state name, e.g. "North Carolina" (used as the SAM.gov
 *   q= query term and as the agency fallback label).
 * @param stateAbbr 2-letter code, e.g. "NC" (used for the log labels).
 * @param deps Optional deterministic test seam (saved fixtures); production
 *   callers pass nothing and get the real SAM.gov calls.
 * @returns A fetch function returning RawBid[] — same contract as the legacy
 *   per-state source files.
 */
export function createStateKeywordSource(
  stateName: string,
  stateAbbr: string,
  deps: StateKeywordDeps = {}
): () => Promise<RawBid[]> {
  const tag = stateAbbr.toUpperCase();
  const fallbackAgency = `${stateName} Agency`;
  const detailDelayMs = deps.detailDelayMs ?? DETAIL_DELAY_MS;
  const fetchDetail = deps.detailFetcher ?? fetchOpportunityDetailFull;

  return async (): Promise<RawBid[]> => {
    const results: RawBid[] = [];
    // DEAD-COLLECTOR CLASSIFICATION (owner 09-23, item ③): the door records every
    // failed page request and, if the whole door read NOTHING, throws
    // `SourceUnreachableError` (see fetch-failure.ts). `syncSource` catches that
    // per source, so one dead door can never abort the 51-door wave — it just
    // stops reading as an honest EMPTY.
    const failures = new FetchFailures();

    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const url = `${SAM_API}?page=${page}&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=${encodeURIComponent(stateName)}&is_active=true`;
        console.log(`  ${tag}: fetching page ${page + 1}/${MAX_PAGES}...`);

        const data = deps.fetchJson
          ? await deps.fetchJson(url)
          : await defaultFetchJson(tag, page, url);
        // The door ANSWERED (a 200 body was parsed): it is reachable even if the
        // page holds no items — that case is the honest EMPTY, not DEAD.
        if (data && typeof data === "object") failures.markReadable();
        const items = data?._embedded?.results;
        if (!items || items.length === 0) break;

        for (const item of items) {
          try {
            const descContent = item.descriptions?.[0]?.content || "";
            const description = stripHtml(descContent).substring(0, 2000);

            const orgs = item.organizationHierarchy || [];
            const deepestOrg = orgs[orgs.length - 1];
            const agency = deepestOrg?.name || orgs[0]?.name || fallbackAgency;

            // The canonical notice identity (`parentNoticeId || _id`): the SAME
            // expression this source has always used for the notice URL, now
            // also the row's external_id suffix and the run-level guard's key.
            const noticeId = canonicalNoticeId(item);

            // ONE detail request per notice (exactly as before): the v2 payload
            // holds the authoritative place-of-performance AND the provenance
            // fields this row previously discarded (PSC / notice type /
            // solicitation number).
            const detail = noticeId
              ? await fetchDetail(noticeId)
              : EMPTY_DETAIL;
            const location = extractLocation(
              orgs,
              description,
              // The shared v2 mapper types placeOfPerformance as
              // `PlaceOfPerformance | null`; this source's extractLocation takes
              // it as optional (`| undefined`) and only ever reads it with `?.`,
              // so null → undefined is exact no-op behavior at runtime.
              detail.placeOfPerformance ?? undefined,
            );
            await new Promise((r) => setTimeout(r, detailDelayMs));

            const category = mapCategory(
              extractNoticeType(item) ?? trimOrNull(detail.noticeType),
              item.title || "",
              description,
            );

            const dueDate = item.responseDate || item.responseDateActual || null;

            let estimatedValue = "Not specified";
            if (item.award?.amount) {
              estimatedValue = `${Number(item.award.amount).toLocaleString()}`;
            }

            const sourceUrl = noticeId
              ? `https://sam.gov/opp/${noticeId}/view`
              : "https://sam.gov/search/";

            // Summary first (human-readable label + SAM's own number), detail as
            // the fallback — the same precedence the shared mapper uses.
            const solicitationNumber =
              trimOrNull(item.solicitationNumber) ??
              trimOrNull(detail.solicitationNumber);
            const noticeType =
              extractNoticeType(item) ?? trimOrNull(detail.noticeType);

            results.push({
              // Canonical SAM-family identity (FIX ⑤): stable across the doors,
              // unlike the former per-door `<st>-<_id>` prefix.
              external_id: `sam-${noticeId || solicitationNumber || `page${page}-${results.length}`}`,
              title: item.title || "Untitled Opportunity",
              agency,
              description,
              location,
              category,
              due_date: dueDate,
              estimated_value: estimatedValue,
              source_url: sourceUrl,
              // FIX ⑤ step A: provenance the door already fetched. NAICS and
              // set_aside are deliberately NOT populated (never invented; the
              // NAICS stays inference-derived with source 'inferred').
              psc: detail.psc,
              notice_type: noticeType,
              solicitation_number: solicitationNumber,
              notice_key: noticeId,
            });
          } catch (e) {
            console.error(`  ${tag}: error parsing item:`, (e as Error).message);
          }
        }

        console.log(`  ${tag} page ${page + 1}: got ${items.length} items (total: ${results.length})`);

        if (items.length < PAGE_SIZE) break;
        await new Promise((r) => setTimeout(r, DELAY_MS));
      } catch (e) {
        const detail = failureDetail(e);
        console.error(`  ${tag} page ${page} error:`, detail);
        failures.record(detail);
      }
    }

    // Nothing readable at all ⇒ the door is DEAD, not empty. Any page that DID
    // return items keeps the source reportable as reachable (rows > 0).
    failures.assertReached(tag, results.length);
    return results;
  };
}

export function extractLocation(
  orgHierarchy: any[],
  description: string,
  placeOfPerformance?: PlaceOfPerformance,
): string {
  // 1. Authoritative SAM.gov place of performance (v2 detail endpoint), e.g.
  //    { city: { name: "West Palm Beach" }, state: { code: "FL" } }.
  const city = placeOfPerformance?.city?.name;
  const stateCode = placeOfPerformance?.state?.code;
  const stateName = placeOfPerformance?.state?.name;
  if (city && stateCode) return `${city}, ${stateCode}`;
  if (stateCode) return stateCode;
  if (stateName) return stateName;
  // 2. 2-letter state code in the deepest org name's parentheses.
  const deepest = orgHierarchy?.[orgHierarchy.length - 1];
  if (deepest?.name) {
    const stateMatch = deepest.name.match(/\(([A-Z]{2})\)/);
    if (stateMatch) return stateMatch[1];
  }
  // 3. "City, ST" pattern in the description.
  const locMatch = description.match(
    new RegExp(`\\b([A-Z][a-z]+,\\s*(?:${STATE_ABBREVS}))\\b`)
  );
  if (locMatch) return locMatch[1];
  // 4. Never label with the query state — an out-of-state listing would get a
  //    wrong pin. "Unknown" is honest; the detail fetch above usually refines it.
  return "Unknown";
}

function mapCategory(noticeType: string | null, title: string, description: string): string {
  // OWNER PRIORITY 09-21 (R4): the single shared classifier — no bare "cleaning"
  // janitorial branch, a real trucking/transportation branch, and the
  // purchased-service-only guards (product buys / dump-truck listings never
  // classify into these trades).
  //
  // S5 CLASSIFIER ORDER (owner-approved 2026-09-23, D4): the door now feeds the
  // REAL notice type (it used to pass "") — the same provenance field the write
  // path already stores, so an Award/Justification notice is never stamped
  // "Construction".
  return classifyCategory(noticeType ?? "", title, description);
}
