/**
 * City procurement fetcher.
 *
 * Pulls open procurement opportunities and contract records from city
 * open-data portals and normalizes them into the shared `bids` table schema
 * (via RawBid). All five endpoints are Socrata SODA datasets — public data,
 * no API key required.
 *
 *   NYC     data.cityofnewyork.us   /resource/3khw-qi8f  (City Record solicitations)
 *   Chicago data.cityofchicago.org  /resource/rsxa-ify5  (Contracts)
 *   LA      data.lacity.org         /resource/hf3r-utnq  (RAMP Open Bid Opportunities)
 *   SF      data.sfgov.org          /resource/cqi5-hm2d  (Supplier Contracts)
 *   Austin  datahub.austintexas.gov /resource/84ih-p28j  (Contracts)
 *
 * Design rules:
 *  - Every city is an isolated source: a network error, dataset move, or rate
 *    limit on one city never blocks the others (each is wrapped in its own
 *    try/catch and the runner treats sources independently).
 *  - Each city is exposed as a standalone `fetch` function so the sync runner
 *    persists records under distinct `source` values (`nyc_open_data`,
 *    `chicago_open_data`, ...) which the UI uses to badge Federal vs City bids.
 *  - Pagination is capped (2 pages × 100 rows) so the daily cron stays light.
 */
import type { RawBid } from "../jobs/sources/sam-gov";

const PAGE_SIZE = 100;
const MAX_PAGES = 2; // up to 200 rows per city per sync
const DELAY_MS = 300;
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Contrax procurement intelligence (https://www.contrax.company)",
};

export interface CitySourceConfig {
  /** Unique source key stored in bids.source (e.g. "nyc_open_data"). */
  name: string;
  /** Human-readable city name for the UI (e.g. "New York City"). */
  cityName: string;
  /** Location string stored in bids.location (e.g. "New York, NY"). */
  location: string;
  /** Socrata portal root (e.g. "https://data.cityofnewyork.us"). */
  baseUrl: string;
  /** SODA dataset id (e.g. "3khw-qi8f"). */
  datasetId: string;
  /** Dataset landing page, used as fallback source_url. */
  datasetPageUrl: string;
  /** Fetch this city's procurement records (isolated from other cities). */
  fetch: () => Promise<RawBid[]>;
}

export interface CitySyncResult {
  source: string;
  cityName: string;
  fetched: number;
  errors: string[];
}

type SocrataRecord = Record<string, unknown>;

// ── Small normalizers ─────────────────────────────────────────────────────────

function text(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function stripHtml(value: unknown): string {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function first(record: SocrataRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = record[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

/** "12345.6" / "-7.6" / "$1,000,000" → "$1,234" (or null when absent). */
function money(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[$,]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return raw;
  return `$${Math.round(num).toLocaleString("en-US")}`;
}

/** Extract a URL string, handling Socrata's {"url": "..."} URL-typed columns. */
function extractUrl(value: unknown): string {
  if (value && typeof value === "object") {
    const url = (value as { url?: unknown }).url;
    return text(url);
  }
  return text(value);
}

/** Detect city set-aside/program designations (M/WBE, SBE, DBE, LBE). */
function detectSetAside(textValue: string): string | null {
  const v = textValue.toLowerCase();
  if (/\b(?:mwbe|m\/wbe|minority[\s-]?owned|women[\s-]?owned|minority[\s-]? and women[\s-]?owned)\b/.test(v)) return "MWBE";
  if (/\b(?:dbe|disadvantaged business enterprise)\b/.test(v)) return "DBE";
  if (/\b(?:sbe|small business enterprise|local business enterprise)\b/.test(v)) return "SBE";
  if (/\blbe\b/.test(v)) return "LBE";
  return null;
}

// ── Per-city record mappers ───────────────────────────────────────────────────

/** NYC City Record Online — active solicitations with due dates. */
function mapNyc(record: SocrataRecord, source: CitySourceConfig, index: number): RawBid | null {
  const id = text(first(record, "request_id"));
  const title = text(first(record, "short_title", "title"), "Untitled Opportunity");
  const agency = text(first(record, "agency_name", "agency"), "City of New York");
  const description = stripHtml(first(record, "additional_description_1", "description"));
  const category = text(first(record, "category_description", "category"), "Other");
  const dueDate = text(first(record, "due_date", "response_due_date", "bid_due_date")) || null;
  const fullText = `${title} ${description} ${text(first(record, "selection_method_description"))} ${text(first(record, "type_of_notice_description"))}`;
  return {
    external_id: `nyc-${id || `row-${index}`}`,
    title,
    agency,
    description,
    category,
    due_date: dueDate,
    location: source.location,
    estimated_value: "Not specified",
    source_url: id ? `https://a856-cityrecord.nyc.gov/${id}` : source.datasetPageUrl,
    set_aside: detectSetAside(fullText),
  };
}

/** Chicago Contracts — awarded contracts with amounts and vendors. */
function mapChicago(record: SocrataRecord, source: CitySourceConfig, index: number): RawBid | null {
  const poNumber = text(first(record, "purchase_order_contract_number"));
  const revision = text(first(record, "revision_number"));
  const specNumber = text(first(record, "specification_number"));
  const title = text(first(record, "purchase_order_description"), "Untitled Contract");
  const department = text(first(record, "department"), "City of Chicago");
  const vendor = text(first(record, "vendor_name"));
  const contractType = text(first(record, "contract_type"), "Contract");
  const amount = money(first(record, "award_amount"));
  const approvalDate = text(first(record, "approval_date"));
  const descriptionParts = [contractType];
  if (vendor) descriptionParts.push(`Vendor: ${vendor}`);
  if (approvalDate) descriptionParts.push(`Approved ${approvalDate.slice(0, 10)}`);
  const fullText = `${title} ${contractType} ${vendor}`;
  return {
    external_id: `chicago-${poNumber || "none"}-${revision || "0"}-${specNumber || `row-${index}`}`,
    title,
    agency: department,
    description: descriptionParts.join(". ").slice(0, 2000),
    category: contractType,
    due_date: null,
    location: source.location,
    estimated_value: amount ?? "Not specified",
    source_url: source.datasetPageUrl,
    set_aside: detectSetAside(fullText),
  };
}

/** Los Angeles RAMP Open Bid Opportunities — live solicitations with close dates. */
function mapLa(record: SocrataRecord, source: CitySourceConfig, index: number): RawBid | null {
  const id = text(first(record, "rampid"));
  const title = text(first(record, "title"), "Untitled Opportunity");
  const department = text(first(record, "department"), "City of Los Angeles");
  const type = text(first(record, "type"));
  const stage = text(first(record, "stagename"));
  const category = text(first(record, "category"), "Other");
  const closeDate = text(first(record, "closedate", "due_date")) || null;
  const url = extractUrl(first(record, "url"));
  const fullText = `${title} ${type} ${stage} ${category} ${text(first(record, "description"))}`;
  return {
    external_id: `la-${id || `row-${index}`}`,
    title,
    agency: department,
    description: [type, stage && `Stage: ${stage}`, category !== "Other" && `Category: ${category}`].filter(Boolean).join(". ") || "Open bid opportunity",
    category,
    due_date: closeDate,
    location: source.location,
    estimated_value: "Not specified",
    source_url: url || source.datasetPageUrl,
    set_aside: detectSetAside(fullText),
  };
}

/** SF Supplier Contracts — citywide contract awards with amounts. */
function mapSf(record: SocrataRecord, source: CitySourceConfig, index: number): RawBid | null {
  const contractNo = text(first(record, "contract_no"));
  const title = text(first(record, "contract_title"), "Untitled Contract");
  const department = text(first(record, "department"), "City of San Francisco");
  const contractor = text(first(record, "prime_contractor"));
  const contractType = text(first(record, "contract_type"), "Contract");
  const lbeStatus = text(first(record, "project_team_lbe_status"));
  const scope = stripHtml(first(record, "scope_of_work"));
  const amount = money(first(record, "agreed_amt"));
  const descriptionParts = [contractType];
  if (contractor) descriptionParts.push(`Contractor: ${contractor}`);
  if (scope && scope !== "Unspecified") descriptionParts.push(scope);
  if (lbeStatus && lbeStatus.toLowerCase() !== "non-lbe") descriptionParts.push(`LBE status: ${lbeStatus}`);
  const fullText = `${title} ${contractType} ${contractor} ${lbeStatus}`;
  return {
    external_id: `sf-${contractNo || `row-${index}`}`,
    title,
    agency: department,
    description: descriptionParts.join(". ").slice(0, 2000),
    category: contractType,
    due_date: null,
    location: source.location,
    estimated_value: amount ?? "Not specified",
    source_url: source.datasetPageUrl,
    set_aside: detectSetAside(fullText),
  };
}

/** Austin Contracts — master agreements with spend limits and vendors. */
function mapAustin(record: SocrataRecord, source: CitySourceConfig, index: number): RawBid | null {
  const docId = text(first(record, "doc_id"));
  const version = text(first(record, "doc_vers_no"));
  const title = text(first(record, "doc_dscr"), "Untitled Contract");
  const vendor = text(first(record, "lgl_nm"));
  const category = text(first(record, "cat_dscr"), "Other");
  const method = text(first(record, "rpt_dscr"));
  const soDocCd = text(first(record, "so_doc_cd"));
  const soDocId = text(first(record, "so_doc_id"));
  const amount = money(first(record, "ma_prch_lmt_am"));
  const descriptionParts: string[] = [];
  if (method) descriptionParts.push(method);
  if (vendor) descriptionParts.push(`Vendor: ${vendor}`);
  if (soDocId) descriptionParts.push(`Solicitation: ${soDocCd} ${soDocId}`);
  const fullText = `${title} ${category} ${vendor} ${method}`;
  return {
    external_id: `austin-${docId || "none"}-${version || `row-${index}`}`,
    title,
    agency: "City of Austin — Central Purchasing",
    description: descriptionParts.join(". ").slice(0, 2000) || "City of Austin contract",
    category,
    due_date: null,
    location: source.location,
    estimated_value: amount ?? "Not specified",
    source_url: source.datasetPageUrl,
    set_aside: detectSetAside(fullText),
  };
}

// ── Generic Socrata SODA fetch (paginated, resilient) ────────────────────────

type RecordMapper = (record: SocrataRecord, source: CitySourceConfig, index: number) => RawBid | null;

async function fetchSocrataBids(source: CitySourceConfig, mapRecord: RecordMapper): Promise<RawBid[]> {
  const results: RawBid[] = [];
  const endpoint = `${source.baseUrl.replace(/\/$/, "")}/resource/${encodeURIComponent(source.datasetId)}.json`;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        $limit: String(PAGE_SIZE),
        $offset: String(page * PAGE_SIZE),
      });
      const response = await fetch(`${endpoint}?${params}`, { headers: HEADERS });
      if (!response.ok) {
        console.error(`  [${source.name}] page ${page + 1} returned ${response.status}`);
        break;
      }
      const payload = (await response.json()) as SocrataRecord[] | { error?: unknown };
      if (!Array.isArray(payload) || payload.length === 0) break;
      for (const record of payload) {
        try {
          const bid = mapRecord(record, source, results.length);
          if (bid) results.push(bid);
        } catch (e) {
          console.error(`  [${source.name}] error parsing record:`, (e as Error).message);
        }
      }
      console.log(`  [${source.name}] page ${page + 1}: ${payload.length} records (total ${results.length})`);
      if (payload.length < PAGE_SIZE) break;
      if (page < MAX_PAGES - 1) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    } catch (e) {
      console.error(`  [${source.name}] page ${page + 1} error:`, (e as Error).message);
      break;
    }
  }
  return results;
}

// ── City source registry ──────────────────────────────────────────────────────

function makeSource(config: Omit<CitySourceConfig, "fetch"> & { map: RecordMapper }): CitySourceConfig {
  return {
    ...config,
    fetch: () => fetchSocrataBids(config, config.map),
  };
}

/** All configured city procurement sources, in priority order. */
export const CITY_SOURCES: CitySourceConfig[] = [
  makeSource({
    name: "nyc_open_data",
    cityName: "New York City",
    location: "New York, NY",
    baseUrl: "https://data.cityofnewyork.us",
    datasetId: "3khw-qi8f",
    datasetPageUrl: "https://data.cityofnewyork.us/City-Government/City-Record-Online/3khw-qi8f",
    map: mapNyc,
  }),
  makeSource({
    name: "chicago_open_data",
    cityName: "Chicago",
    location: "Chicago, IL",
    baseUrl: "https://data.cityofchicago.org",
    datasetId: "rsxa-ify5",
    datasetPageUrl: "https://data.cityofchicago.org/Administration-Finance/Contracts/rsxa-ify5",
    map: mapChicago,
  }),
  makeSource({
    name: "la_open_data",
    cityName: "Los Angeles",
    location: "Los Angeles, CA",
    baseUrl: "https://data.lacity.org",
    datasetId: "hf3r-utnq",
    datasetPageUrl: "https://data.lacity.org/Administration-Finance/RAMP-Open-Bid-Opportunities/hf3r-utnq",
    map: mapLa,
  }),
  makeSource({
    name: "sf_open_data",
    cityName: "San Francisco",
    location: "San Francisco, CA",
    baseUrl: "https://data.sfgov.org",
    datasetId: "cqi5-hm2d",
    datasetPageUrl: "https://data.sfgov.org/City-Management-and-Ethics/Supplier-Contracts/cqi5-hm2d",
    map: mapSf,
  }),
  makeSource({
    name: "austin_open_data",
    cityName: "Austin",
    location: "Austin, TX",
    baseUrl: "https://datahub.austintexas.gov",
    datasetId: "84ih-p28j",
    datasetPageUrl: "https://datahub.austintexas.gov/dataset/Contracts/84ih-p28j",
    map: mapAustin,
  }),
];

/** True when the given bids.source value is one of our city feeds. */
export function isCitySource(source: string | null | undefined): boolean {
  if (!source) return false;
  return CITY_SOURCES.some((s) => s.name === source);
}

/** "nyc_open_data" → "New York City" (null for non-city sources). */
export function cityLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return CITY_SOURCES.find((s) => s.name === source)?.cityName ?? null;
}

/** Convenience: run every city source sequentially; one failure never blocks the rest. */
export async function runCitySync(): Promise<CitySyncResult[]> {
  const results: CitySyncResult[] = [];
  for (const source of CITY_SOURCES) {
    const errors: string[] = [];
    let fetched = 0;
    try {
      const bids = await source.fetch();
      fetched = bids.length;
      console.log(`  ${source.name}: fetched ${fetched} city bids`);
    } catch (e) {
      const msg = `${source.name}: ${(e as Error).message}`;
      errors.push(msg);
      console.error(`  ${msg}`);
    }
    results.push({ source: source.name, cityName: source.cityName, fetched, errors });
  }
  return results;
}
