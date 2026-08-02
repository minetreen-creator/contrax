/**
 * SAM.gov Procurement Scraper
 *
 * Fetches active federal contract opportunities from SAM.gov's public search API.
 *
 * API discovered via research (2026-07-27):
 * - Endpoint: GET https://sam.gov/api/prod/sgs/v1/search/
 * - Requires browser-like Accept header (text/html, not just application/json)
 * - Query params: page, size, sort, mode, q, is_active
 * - Max 10,000 records accessible (page limit)
 * - Rate limit: add 500ms delay between pages
 */

export interface RawBid {
  external_id: string;
  title: string;
  agency: string;
  description: string;
  location: string;
  category: string;
  due_date: string | null;
  estimated_value: string;
  source_url: string;
}

const SAM_API = "https://sam.gov/api/prod/sgs/v1/search/";
const PAGE_SIZE = 25;
const MAX_PAGES = 4; // Fetch up to 100 bids per sync
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
  // Try to extract state/city from the deepest org name (often includes location)
  const deepest = orgHierarchy?.[orgHierarchy.length - 1];
  if (deepest?.name) {
    const name = deepest.name;
    // Common patterns: "W6QM MICC-FORT BUCHANAN (RC)", "FA2823 AFTC PZIO"
    const stateMatch = name.match(/\(([A-Z]{2})\)/);
    if (stateMatch) return stateMatch[1];
  }

  // Try extracting from description
  const locPatterns = [
    /\b([A-Z][a-z]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|GU|VI|AS|MP))\b/,
    /\b(?:in|at|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC))\b/i,
  ];

  for (const pattern of locPatterns) {
    const match = description.match(pattern);
    if (match) return match[1];
  }

  return "United States";
}

function mapCategory(typeValue: string, title: string, description: string): string {
  const t = (typeValue || "").toLowerCase();
  const full = (title + " " + description).toLowerCase();

  if (full.includes("landscap") || full.includes("grounds main")) return "Landscaping";
  if (full.includes("construction") || full.includes("renovation") || full.includes("demolition")) return "Construction";
  if (full.includes("it ") && (full.includes("service") || full.includes("support") || full.includes("software") || full.includes("cloud"))) return "IT Services";
  if (full.includes("janitor") || full.includes("custodial") || full.includes("cleaning")) return "Janitorial";
  if (full.includes("security") || full.includes("guard ")) return "Security";
  if (full.includes("hvac") || full.includes("heating") || full.includes("cooling")) return "HVAC";
  if (full.includes("electrical") || full.includes("plumbing")) return "Plumbing & Electrical";

  if (t.includes("solicitation") || t.includes("combined")) return "Construction";
  if (t.includes("award")) return "Construction";
  if (t.includes("special")) return "Construction";

  return "Other";
}

export async function fetchBids(): Promise<RawBid[]> {
  const results: RawBid[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const url = `${SAM_API}?page=${page}&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=&is_active=true`;
      console.log(`  SAM.gov: fetching page ${page + 1}/${MAX_PAGES}...`);

      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) {
        console.error(`  SAM.gov page ${page} returned ${resp.status}`);
        // If we get a non-200 on page > 0, we might have hit the end
        if (page > 0) break;
        continue;
      }

      const data = await resp.json();
      const items = data?._embedded?.results;
      if (!items || items.length === 0) break;

      for (const item of items) {
        try {
          const descContent =
            item.descriptions?.[0]?.content || "";
          const description = stripHtml(descContent).substring(0, 2000);

          const orgs = item.organizationHierarchy || [];
          const deepestOrg = orgs[orgs.length - 1];
          const agency = deepestOrg?.name || "Federal Agency";

          const location = extractLocation(orgs, description);
          const category = mapCategory(item.type?.value || "", item.title, description);

          const dueDate = item.responseDate || item.responseDateActual || null;

          // Try to get value from award info
          let estimatedValue = "Not specified";
          if (item.award?.amount) {
            estimatedValue = `$${Number(item.award.amount).toLocaleString()}`;
          }

          const noticeId = item.parentNoticeId || item._id || "";
          const sourceUrl = noticeId
            ? `https://sam.gov/opp/${noticeId}/view`
            : "https://sam.gov/search/";

          results.push({
            external_id: `sam-${item._id || item.solicitationNumber || `page${page}-${results.length}`}`,
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
          console.error(`  SAM.gov: error parsing item:`, (e as Error).message);
        }
      }

      console.log(`  SAM.gov page ${page + 1}: got ${items.length} items (total collected: ${results.length})`);

      // If fewer results than page size, we're at the end
      if (items.length < PAGE_SIZE) break;

      // Rate limit delay
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (e) {
      console.error(`  SAM.gov page ${page} error:`, (e as Error).message);
      // Continue to next page anyway
    }
  }

  return results;
}
