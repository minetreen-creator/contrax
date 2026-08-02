/**
 * Municipal / City-level Procurement Source
 *
 * Uses SAM.gov API filtered by "City of", "County of", and "Metropolitan"
 * keywords to capture municipal-level bids most relevant to small businesses.
 *
 * API: GET https://sam.gov/api/prod/sgs/v1/search/?q=City+of&...
 *      GET https://sam.gov/api/prod/sgs/v1/search/?q=County+of&...
 *      GET https://sam.gov/api/prod/sgs/v1/search/?q=Metropolitan&...
 */

import type { RawBid } from "./sam-gov";

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

async function fetchKeyword(keyword: string, prefix: string): Promise<RawBid[]> {
  const results: RawBid[] = [];

  try {
    const q = encodeURIComponent(keyword);
    const url = `${SAM_API}?page=0&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=${q}&is_active=true`;
    console.log(`  Cities: fetching "${keyword}"...`);

    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) {
      console.error(`  Cities "${keyword}" returned ${resp.status}`);
      return results;
    }

    const data = await resp.json();
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
          estimatedValue = `$${Number(item.award.amount).toLocaleString()}`;
        }

        const noticeId = item.parentNoticeId || item._id || "";
        const sourceUrl = noticeId
          ? `https://sam.gov/opp/${noticeId}/view`
          : "https://sam.gov/search/";

        results.push({
          external_id: `cities-${prefix}-${item._id || item.solicitationNumber || `${results.length}`}`,
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
        console.error(`  Cities: error parsing item:`, (e as Error).message);
      }
    }

    console.log(`  Cities "${keyword}": got ${items.length} items`);
  } catch (e) {
    console.error(`  Cities "${keyword}" error:`, (e as Error).message);
  }

  return results;
}

export async function fetchBids(): Promise<RawBid[]> {
  const cityBids = await fetchKeyword("City of", "city");
  await new Promise((r) => setTimeout(r, DELAY_MS));
  const countyBids = await fetchKeyword("County of", "county");
  await new Promise((r) => setTimeout(r, DELAY_MS));
  const metroBids = await fetchKeyword("Metropolitan", "metro");

  return [...cityBids, ...countyBids, ...metroBids];
}
