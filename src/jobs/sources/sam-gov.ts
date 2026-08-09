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
  set_aside?: string | null;
  naics_code?: string | null;
  /** Identifies whether the bid came from the national or regional pass. */
  source_label?: "sam_gov" | "sam_gov_regional";
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


const DETAIL_API = "https://sam.gov/api/prod/opps/v2/opportunities/";

/**
 * Normalizes a raw SAM.gov set-aside value (code or label) into a display label.
 * Codes observed from SAM.gov: "SBA" (SBA Certified 8(a) Program), "SDVOSBC",
 * "VOSBC", "WOSB", "EDWOSB", "HZC", "NONE". Accepts strings or {code, value}
 * objects (e.g. {code: "8a", value: "SBA Certified 8(a) Program"}).
 */
export function normalizeSetAside(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let v = String(value).trim();
  if (!v || /^(none|no|not set aside|n\/a|na)$/i.test(v)) return null;
  const lower = v.toLowerCase();
  const map: Record<string, string> = {
    sba: "8(a)",
    "8a": "8(a)",
    "8(a)": "8(a)",
    sdvosbc: "SDVOSB",
    sdvosb: "SDVOSB",
    "service-disabled": "SDVOSB",
    vosbc: "VOSB",
    vosb: "VOSB",
    wosb: "WOSB",
    edwosb: "EDWOSB",
    "wosb/edwosb": "WOSB/EDWOSB",
    hzc: "HUBZone",
    hubzone: "HUBZone",
    hub: "HUBZone",
    mbe: "MBE",
    wbe: "WBE",
    dbe: "DBE",
  };
  if (map[lower]) return map[lower];
  if (lower.includes("8(a)") || (lower.includes("8a") && lower.includes("sba"))) return "8(a)";
  if (lower.includes("service-disabled") || lower.includes("sdvosb")) return "SDVOSB";
  if (lower.includes("economically disadvantaged")) return "EDWOSB";
  if (lower.includes("women-owned") || lower.includes("women owned") || lower.includes("wosb")) return "WOSB";
  if (lower.includes("veteran-owned") || lower.includes("veteran owned") || lower.includes("vosb")) return "VOSB";
  if (lower.includes("hubzone") || lower.includes("hub zone")) return "HUBZone";
  if (lower.includes("minority")) return "Minority-Owned";
  if (lower.includes("disadvantaged")) return "Disadvantaged";
  return v;
}

/**
 * Extracts a set-aside designation from a SAM.gov search-result item.
 * The v1 search response usually does not carry the field, so this checks any
 * structured field that could be present (setAside / typeOfSetAside /
 * setAsideType / data2.solicitation.setAside) and falls back to scanning the
 * opportunity text for "set aside" phrases.
 */
function extractSetAsideFromItem(item: any, description: string): string | null {
  const candidates = [
    item?.setAside,
    item?.typeOfSetAside,
    item?.setAsideType,
    item?.data2?.solicitation?.setAside,
  ];
  for (const c of candidates) {
    const raw = typeof c === "object" && c !== null ? c?.value ?? c?.code ?? c : c;
    const label = normalizeSetAside(raw);
    if (label) return label;
  }

  const text = `${item?.title || ""} ${description}`.toLowerCase().replace(/\s+/g, " ");
  const idx = text.indexOf("set-aside") >= 0 ? text.indexOf("set-aside") : text.indexOf("set aside");
  if (idx >= 0) {
    const window = text.slice(Math.max(0, idx - 100), idx + 100);
    const pairs: [RegExp, string][] = [
      [/\b8\s?\(\s?a\s?\)|sba certified/, "8(a)"],
      [/\bedwosb\b/, "EDWOSB"],
      [/\bsdvosb\b|service[- ]disabled/, "SDVOSB"],
      [/\bwosb\b|women[- ]owned/, "WOSB"],
      [/\bhubzone\b|hub[- ]?zone/, "HUBZone"],
      [/\bvosb\b|veteran[- ]owned/, "VOSB"],
    ];
    for (const [re, label] of pairs) if (re.test(window)) return label;
  }
  return null;
}

/**
 * Fetches the authoritative set-aside designation AND primary NAICS code from
 * the SAM.gov opportunity detail endpoint:
 *   - set-aside: data2.solicitation.setAside
 *   - NAICS:     data2.naics = [{ code: ["236220"], type: "primary" }]
 * Best-effort: any failure returns nulls so a detail fetch can never break
 * the sync. The search summary never includes either field, so this detail
 * call is the only source for both.
 */
async function fetchOpportunityDetail(noticeId: string): Promise<{ setAside: string | null; naicsCode: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${DETAIL_API}${noticeId}`, { headers: HEADERS, signal: controller.signal });
    if (!resp.ok) return { setAside: null, naicsCode: null };
    const data = await resp.json();
    const setAside = normalizeSetAside(data?.data2?.solicitation?.setAside);
    // data2.naics is an array of { code: string[], type: "primary" } objects.
    let naicsCode: string | null = null;
    const naicsArr = Array.isArray(data?.data2?.naics) ? data.data2.naics : [];
    const primary = naicsArr.find((n: any) => n?.type === "primary") ?? naicsArr[0];
    const firstCode = Array.isArray(primary?.code) ? primary.code[0] : primary?.code;
    if (firstCode && /^\d{2,6}$/.test(String(firstCode).trim())) {
      naicsCode = String(firstCode).trim();
    } else {
      // Fall back to the solicitation-level field if the naics array is absent.
      const sol = data?.data2?.solicitation?.naicsCode ?? data?.data2?.solicitation?.naicsCodes?.[0];
      if (sol && /^\d{2,6}$/.test(String(sol).trim())) naicsCode = String(sol).trim();
    }
    return { setAside, naicsCode };
  } catch {
    return { setAside: null, naicsCode: null };
  } finally {
    clearTimeout(timer);
  }
}

function extractNaicsCode(item: any): string | null {
  const candidates = [item?.naicsCode, item?.naics_code, item?.data2?.solicitation?.naicsCode, item?.data2?.solicitation?.naicsCodes?.[0], item?.naics?.[0]?.code, item?.naics?.code];
  for (const value of candidates) {
    const code = typeof value === "object" && value !== null ? value.code ?? value.value : value;
    if (code && /^\d{2,6}$/.test(String(code).trim())) return String(code).trim();
  }
  return null;
}

export async function fetchBids(options: { states?: string[] } = {}): Promise<RawBid[]> {
  const states = options.states?.filter((state) => /^[A-Z]{2}$/.test(state)).join(",");
  const sourceLabel = states ? "sam_gov_regional" as const : "sam_gov" as const;
  const results: RawBid[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const stateFilter = states ? `&placeOfPerformance.state=${states}` : "";
      const url = `${SAM_API}?page=${page}&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=&is_active=true${stateFilter}`;
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

          // Set-aside + NAICS: the search summary never includes either field,
          // so pull the opportunity detail when either is missing.
          let setAside = extractSetAsideFromItem(item, description);
          let naicsCode = extractNaicsCode(item);
          if (noticeId && (!setAside || !naicsCode)) {
            const detail = await fetchOpportunityDetail(noticeId);
            if (!setAside) setAside = detail.setAside;
            if (!naicsCode) naicsCode = detail.naicsCode;
            await new Promise((r) => setTimeout(r, 120));
          }

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
            set_aside: setAside,
            naics_code: naicsCode,
            source_label: sourceLabel,
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
