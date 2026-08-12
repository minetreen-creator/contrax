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
 */

import type { RawBid } from "./sam-gov";

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
/** Per-opportunity detail endpoint — the only place SAM exposes
 * place-of-performance (the v1 search summary never includes location). */
const DETAIL_API = "https://sam.gov/api/prod/opps/v2/opportunities/";
const PAGE_SIZE = 25;
const MAX_PAGES = 1;
const DELAY_MS = 500;

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

/** Place-of-performance shape from the SAM.gov v2 detail endpoint
 * (data2.placeOfPerformance): { zip, city: {code, name}, state: {code, name},
 * country, streetAddress }. */
type PlaceOfPerformance = {
  city?: { name?: string };
  state?: { code?: string; name?: string };
} | null;

/**
 * Fetches the authoritative place-of-performance for an opportunity. The v1
 * search summary never includes location fields, so a bid whose org name and
 * truncated description carry no location signal would otherwise be labeled
 * with the query state (wrong for out-of-state listings). Best-effort: any
 * failure returns null so a detail fetch can never break the sync.
 */
async function fetchPlaceOfPerformance(
  noticeId: string,
): Promise<PlaceOfPerformance> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${DETAIL_API}${noticeId}`, {
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.data2?.placeOfPerformance ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

function mapCategory(title: string, description: string): string {
  const full = (title + " " + description).toLowerCase();
  if (full.includes("landscap") || full.includes("grounds main")) return "Landscaping";
  if (full.includes("construction") || full.includes("renovation") || full.includes("demolition")) return "Construction";
  if (full.includes("it ") && (full.includes("service") || full.includes("support") || full.includes("software") || full.includes("cloud"))) return "IT Services";
  if (full.includes("janitor") || full.includes("custodial") || full.includes("cleaning")) return "Janitorial";
  if (full.includes("security") || full.includes("guard ")) return "Security";
  if (full.includes("hvac") || full.includes("heating") || full.includes("cooling")) return "HVAC";
  if (full.includes("electrical") || full.includes("plumbing")) return "Plumbing & Electrical";
  return "Other";
}

/**
 * Creates a SAM.gov keyword source for a single state.
 *
 * @param stateName Full state name, e.g. "North Carolina" (used as the SAM.gov
 *   q= query term and as the agency fallback label).
 * @param stateAbbr 2-letter code, e.g. "NC" (used for the external_id prefix
 *   and log labels).
 * @returns A fetch function returning RawBid[] — same contract as the legacy
 *   per-state source files.
 */
export function createStateKeywordSource(
  stateName: string,
  stateAbbr: string
): () => Promise<RawBid[]> {
  const tag = stateAbbr.toUpperCase();
  const prefix = stateAbbr.toLowerCase();
  const fallbackAgency = `${stateName} Agency`;

  return async (): Promise<RawBid[]> => {
    const results: RawBid[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const url = `${SAM_API}?page=${page}&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=${encodeURIComponent(stateName)}&is_active=true`;
        console.log(`  ${tag}: fetching page ${page + 1}/${MAX_PAGES}...`);

        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) {
          console.error(`  ${tag} page ${page} returned ${resp.status}`);
          if (page > 0) break;
          continue;
        }

        const data = await resp.json();
        const items = data?._embedded?.results;
        if (!items || items.length === 0) break;

        for (const item of items) {
          try {
            const descContent = item.descriptions?.[0]?.content || "";
            const description = stripHtml(descContent).substring(0, 2000);

            const orgs = item.organizationHierarchy || [];
            const deepestOrg = orgs[orgs.length - 1];
            const agency = deepestOrg?.name || orgs[0]?.name || fallbackAgency;

            const noticeId = item.parentNoticeId || item._id || "";

            // The v1 search summary never includes location, so pull the
            // authoritative place-of-performance from the detail endpoint.
            const placeOfPerformance = noticeId
              ? await fetchPlaceOfPerformance(noticeId)
              : null;
            const location = extractLocation(
              orgs,
              description,
              placeOfPerformance,
            );
            await new Promise((r) => setTimeout(r, 120));

            const category = mapCategory(item.title || "", description);

            const dueDate = item.responseDate || item.responseDateActual || null;

            let estimatedValue = "Not specified";
            if (item.award?.amount) {
              estimatedValue = `${Number(item.award.amount).toLocaleString()}`;
            }

            const sourceUrl = noticeId
              ? `https://sam.gov/opp/${noticeId}/view`
              : "https://sam.gov/search/";

            results.push({
              external_id: `${prefix}-${item._id || item.solicitationNumber || `page${page}-${results.length}`}`,
              title: item.title || "Untitled Opportunity",
              agency,
              description,
              location,
              category,
              due_date: dueDate,
              estimated_value: estimatedValue,
              source_url: sourceUrl,
            });
          } catch (e) {
            console.error(`  ${tag}: error parsing item:`, (e as Error).message);
          }
        }

        console.log(`  ${tag} page ${page + 1}: got ${items.length} items (total: ${results.length})`);

        if (items.length < PAGE_SIZE) break;
        await new Promise((r) => setTimeout(r, DELAY_MS));
      } catch (e) {
        console.error(`  ${tag} page ${page} error:`, (e as Error).message);
      }
    }

    return results;
  };
}
