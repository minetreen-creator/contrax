/**
 * Socrata SODA procurement source adapter.
 * SODA exposes datasets as JSON at /resource/{dataset-id}.json and supports
 * $limit/$offset pagination without an API key for public datasets.
 */
import type { RawBid } from "./sam-gov";

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const DELAY_MS = 500;
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Contrax procurement intelligence (https://www.contrax.company)",
};

type SocrataRecord = Record<string, unknown>;
type SourceName = "nyc_socrata" | "nys_socrata" | string;

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

function setAsideFrom(textValue: string): string | null {
  const value = textValue.toLowerCase();
  if (/\b(?:mwbe|m\/wbe|minority[- ]? and women[- ]?owned)\b/.test(value)) return "MWBE";
  if (/\b(?:sbe|small business enterprise|small[- ]business)\b/.test(value)) return "SBE";
  return null;
}

function value(record: SocrataRecord, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

/** Fetch up to three pages from any Socrata SODA dataset. */
export async function fetchSocrataBids(
  baseUrl: string,
  datasetId: string,
  sourceName: SourceName,
): Promise<RawBid[]> {
  const results: RawBid[] = [];
  const endpoint = `${baseUrl.replace(/\/$/, "")}/resource/${encodeURIComponent(datasetId)}.json`;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({ $limit: String(PAGE_SIZE), $offset: String(page * PAGE_SIZE) });
      const response = await fetch(`${endpoint}?${params}`, { headers: HEADERS });
      if (!response.ok) {
        console.error(`  Socrata ${sourceName} page ${page + 1} returned ${response.status}`);
        break;
      }
      const records = (await response.json()) as SocrataRecord[];
      if (!Array.isArray(records) || records.length === 0) break;

      for (const record of records) {
        const id = text(value(record, "request_id", "solicitation_number", "event_id", "id"));
        const title = text(value(record, "short_title", "title", "opportunity_title"), "Untitled Opportunity");
        const agency = text(value(record, "agency_name", "agency", "issuer"), "State/Local Agency");
        const description = stripHtml(value(record, "additional_description_1", "description", "additional_description"));
        const category = text(value(record, "category_description", "category", "commodity"), "Other");
        const dueDate = text(value(record, "due_date", "response_due_date", "bid_due_date")) || null;
        const location = sourceName === "nyc_socrata" ? "New York, NY" : text(value(record, "location", "county", "city"), "New York");
        const fullText = `${title} ${description}`;
        const sourceUrl = sourceName === "nyc_socrata"
          ? `https://a856-cityrecord.nyc.gov/${id}`
          : `${baseUrl.replace(/\/$/, "")}/resource/${datasetId}.json`;

        results.push({
          external_id: `${sourceName}-${id || `page${page}-${results.length}`}`,
          title,
          agency,
          description,
          due_date: dueDate,
          location,
          category,
          source_url: sourceUrl,
          estimated_value: "Not specified",
          set_aside: setAsideFrom(fullText),
        });
      }

      console.log(`  Socrata ${sourceName} page ${page + 1}: got ${records.length} records (total: ${results.length})`);
      if (records.length < PAGE_SIZE) break;
      if (page < MAX_PAGES - 1) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    } catch (error) {
      console.error(`  Socrata ${sourceName} page ${page + 1} error:`, (error as Error).message);
      break;
    }
  }
  return results;
}

export function nycSocrataSource(): Promise<RawBid[]> {
  return fetchSocrataBids("https://data.cityofnewyork.us", "3khw-qi8f", "nyc_socrata");
}

/** NYS primary catalog dataset, with the RAMP dataset as a fallback on 404. */
export async function nysSocrataSource(): Promise<RawBid[]> {
  const primary = await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata");
  if (primary.length > 0) return primary;
  return fetchSocrataBids("https://data.ny.gov", "hf3r-utnq", "nys_socrata");
}
