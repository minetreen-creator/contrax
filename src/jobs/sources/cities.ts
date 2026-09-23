/**
 * Municipal / City-level Procurement Source
 *
 * Uses SAM.gov API filtered by "City of", "County of", and "Metropolitan"
 * keywords to capture municipal-level bids most relevant to small businesses.
 *
 * API: GET https://sam.gov/api/prod/sgs/v1/search/?q=City+of&...
 *      GET https://sam.gov/api/prod/sgs/v1/search/?q=County+of&...
 *      GET https://sam.gov/api/prod/sgs/v1/search/?q=Metropolitan&...
 *
 * NATIONWIDE CORRECTNESS FIX ⑤ STEP A (owner-locked scope, PR B1): these rows are
 * part of the SAME federal SAM.gov pool as `sam_gov` and the 51 state doors (the
 * census shows `cities` inside the door duplicate groups), so they now carry the
 * provenance the v1 SUMMARY already gives us — the notice TYPE and SAM's own
 * solicitation number (both are in the search item; they were simply discarded) —
 * plus the canonical `sam-<parentNoticeId || _id>` external_id and the
 * `notice_key` the run-level identity guard consumes
 * (src/jobs/notice-identity.ts).
 *
 * Deliberately NOT added here: a PSC. The PSC lives only in the v2 detail
 * payload, and this source makes NO detail request today — inventing a second
 * network call just to fill a column would be new load on SAM.gov, so the PSC
 * stays NULL ("the source did not supply it"). Same for NAICS (never invented;
 * the row keeps the inference-derived code with `naics_code_source='inferred'`)
 * and set_aside (owner-gated cert-matching decision, option E).
 */

import { canonicalNoticeId, extractNoticeType, type RawBid } from "./sam-gov";
import { mapCategory as classifyCategory } from "~/lib/trade-classification";

const SAM_API = "https://sam.gov/api/prod/sgs/v1/search/";
const PAGE_SIZE = 25;
const DELAY_MS = 500;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

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

function extractLocation(orgHierarchy: any[], description: string): string {
  const deepest = orgHierarchy?.[orgHierarchy.length - 1];
  if (deepest?.name) {
    const stateMatch = deepest.name.match(/\(([A-Z]{2})\)/);
    if (stateMatch) return stateMatch[1];
  }
  const stateAbbrevs =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR";
  const locMatch = description.match(
    new RegExp(`\\b([A-Z][a-z]+,\\s*(?:${stateAbbrevs}))\\b`)
  );
  if (locMatch) return locMatch[1];
  return "United States";
}

function mapCategory(title: string, description: string): string {
  // OWNER PRIORITY 09-21 (R4): the single shared classifier — see
  // src/lib/trade-classification.ts. This source has no notice type.
  return classifyCategory("", title, description);
}

/** Deterministic test seam (saved fixtures) — production callers pass nothing. */
export interface CitiesDeps {
  /** v1 search page fetcher; injected in tests (zero network). */
  fetchJson?: (url: string) => Promise<any>;
  /** Override the inter-keyword politeness delay (tests use 0). */
  delayMs?: number;
}

/** The real v1 page fetch (same headers/status handling as before). */
async function defaultFetchJson(keyword: string, url: string): Promise<any> {
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) {
    console.error(`  Cities "${keyword}" returned ${resp.status}`);
    return null;
  }
  return resp.json();
}

async function fetchKeyword(
  keyword: string,
  prefix: string,
  deps: CitiesDeps = {},
): Promise<RawBid[]> {
  const results: RawBid[] = [];

  try {
    const q = encodeURIComponent(keyword);
    const url = `${SAM_API}?page=0&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=${q}&is_active=true`;
    console.log(`  Cities: fetching "${keyword}"...`);

    const data = deps.fetchJson
      ? await deps.fetchJson(url)
      : await defaultFetchJson(keyword, url);
    const items = data?._embedded?.results;
    if (!items || items.length === 0) return results;

    for (const item of items) {
      try {
        const descContent = item.descriptions?.[0]?.content || "";
        const description = stripHtml(descContent).substring(0, 2000);

        const orgs = item.organizationHierarchy || [];
        const deepestOrg = orgs[orgs.length - 1];
        const agency =
          deepestOrg?.name || orgs[0]?.name || "Municipal Agency";

        const location = extractLocation(orgs, description);
        const category = mapCategory(item.title || "", description);

        const dueDate = item.responseDate || item.responseDateActual || null;

        let estimatedValue = "Not specified";
        if (item.award?.amount) {
          estimatedValue = `${Number(item.award.amount).toLocaleString()}`;
        }

        // Canonical notice identity (FIX ⑤) — the same expression the state
        // doors and the shared mapper use, so cross-source identity is stable.
        const noticeId = canonicalNoticeId(item);
        const solicitationNumber =
          item.solicitationNumber == null ||
          String(item.solicitationNumber).trim() === ""
            ? null
            : String(item.solicitationNumber).trim();

        const sourceUrl = noticeId
          ? `https://sam.gov/opp/${noticeId}/view`
          : "https://sam.gov/search/";

        results.push({
          external_id: `sam-${noticeId || solicitationNumber || `${prefix}-${results.length}`}`,
          title: item.title || "Untitled Opportunity",
          agency,
          description,
          location,
          category,
          due_date: dueDate,
          estimated_value: estimatedValue,
          source_url: sourceUrl,
          // FIX ⑤ step A: both fields are already in the v1 summary.
          // psc / naics_code / set_aside stay NULL here (see the header).
          notice_type: extractNoticeType(item),
          solicitation_number: solicitationNumber,
          notice_key: noticeId,
        });
      } catch (e) {
        console.error(`  Cities: error parsing item:`, (e as Error).message);
      }
    }

    console.log(`  Cities "${keyword}": got ${items.length} items`);
  } catch (e) {
    console.error(`  Cities "${keyword}" error:`, (e as Error).message);
  }

  return results;
}

export async function fetchBids(deps: CitiesDeps = {}): Promise<RawBid[]> {
  const delayMs = deps.delayMs ?? DELAY_MS;
  const cityBids = await fetchKeyword("City of", "city", deps);
  await new Promise((r) => setTimeout(r, delayMs));
  const countyBids = await fetchKeyword("County of", "county", deps);
  await new Promise((r) => setTimeout(r, delayMs));
  const metroBids = await fetchKeyword("Metropolitan", "metro", deps);

  return [...cityBids, ...countyBids, ...metroBids];
}
