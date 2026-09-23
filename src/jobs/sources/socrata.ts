/**
 * Socrata SODA procurement source adapter.
 * SODA exposes datasets as JSON at /resource/{dataset-id}.json and supports
 * $limit/$offset pagination without an API key for public datasets.
 *
 * FIX ② (owner-locked nationwide correctness fix, 2026-09-23): a page request
 * that FAILS is reported, not swallowed into an empty array. Before this, a
 * source whose datasets no longer exist (HTTP 404) "fetched 0 rows with 0
 * errors" — byte-for-byte the run record of an honest empty source — so the dead
 * collector `nys_socrata` sat in `collector_staleness` as FRESH for 43
 * consecutive runs while both of its data.ny.gov datasets answered 404 (verified
 * live 2026-09-23: `e5pk-us93` and `hf3r-utnq` — and the fallback id is in fact the LA
 * RAMP dataset id — see `city-procurement.ts`). A source that cannot be reached
 * must fail its run, because only a run that reached the source can honestly
 * report "zero rows".
 */
import type { RawBid } from "./sam-gov";
import { nycCityRecordNoticeUrl } from "../../lib/city-procurement";

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const DELAY_MS = 500;
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Contrax procurement intelligence (https://www.contrax.company)",
};

type SocrataRecord = Record<string, unknown>;
type SourceName = "nyc_socrata" | "nys_socrata" | string;

/**
 * Why a Socrata fetch produced no rows. `reached` is the honest signal the
 * collector run log needs: TRUE means at least one page answered 200 with a JSON
 * array (so an empty result list is an HONEST zero), FALSE with a `failure` set
 * means the dataset could not be read at all (dead source — FIX ②).
 */
export interface SocrataFetchReport {
  /** First connection/HTTP/parse failure seen, or null when every page answered. */
  failure: string | null;
  /** True once at least one page answered 200 with a JSON array. */
  reached: boolean;
}

export function newSocrataFetchReport(): SocrataFetchReport {
  return { failure: null, reached: false };
}

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

/**
 * Fetch up to three pages from any Socrata SODA dataset.
 *
 * `report` is OPTIONAL and additive: callers that omit it keep the previous
 * behaviour exactly. Callers that pass one get the honest reach/failure signal
 * back (used by `nysSocrataSource` to fail its run instead of reporting an
 * unreadable dataset as an honest zero — FIX ②).
 */
export async function fetchSocrataBids(
  baseUrl: string,
  datasetId: string,
  sourceName: SourceName,
  report?: SocrataFetchReport,
): Promise<RawBid[]> {
  const results: RawBid[] = [];
  const endpoint = `${baseUrl.replace(/\/$/, "")}/resource/${encodeURIComponent(datasetId)}.json`;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({ $limit: String(PAGE_SIZE), $offset: String(page * PAGE_SIZE) });
      const response = await fetch(`${endpoint}?${params}`, { headers: HEADERS });
      if (!response.ok) {
        console.error(`  Socrata ${sourceName} page ${page + 1} returned ${response.status}`);
        if (report && report.failure === null) {
          report.failure = `HTTP ${response.status} for ${endpoint}`;
        }
        break;
      }
      const records = (await response.json()) as SocrataRecord[];
      if (!Array.isArray(records)) {
        console.error(`  Socrata ${sourceName} page ${page + 1} returned a non-array body`);
        if (report && report.failure === null) {
          report.failure = `malformed (non-array) JSON body from ${endpoint}`;
        }
        break;
      }
      if (report) report.reached = true;
      if (records.length === 0) break;

      for (const record of records) {
        const id = text(value(record, "request_id", "solicitation_number", "event_id", "id"));
        const title = text(value(record, "short_title", "title", "opportunity_title"), "Untitled Opportunity");
        const agency = text(value(record, "agency_name", "agency", "issuer"), "State/Local Agency");
        const description = stripHtml(value(record, "additional_description_1", "description", "additional_description"));
        const category = text(value(record, "category_description", "category", "commodity"), "Other");
        const dueDate = text(value(record, "due_date", "response_due_date", "bid_due_date")) || null;
        const location = sourceName === "nyc_socrata" ? "New York, NY" : text(value(record, "location", "county", "city"), "New York");
        const fullText = `${title} ${description}`;
        // NYC City Record notice ids only resolve under /RequestDetail/{id};
        // the bare-id form redirects to the publisher's 200-answering error
        // page (see nycCityRecordNoticeUrl). Verified 2026-09-18.
        const sourceUrl = sourceName === "nyc_socrata"
          ? nycCityRecordNoticeUrl(id)
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
      if (report && report.failure === null) {
        report.failure = `${(error as Error).message} for ${endpoint}`;
      }
      break;
    }
  }
  return results;
}

export function nycSocrataSource(): Promise<RawBid[]> {
  return fetchSocrataBids("https://data.cityofnewyork.us", "3khw-qi8f", "nyc_socrata");
}

/**
 * NYS primary catalog dataset, with a fallback dataset id that answered 404 in
 * production; the fallback id is in fact the LA RAMP dataset id, so it is not a
 * real NYS fallback (audit A-3 — the id is left UNCHANGED here on purpose: this
 * fix is about honest health reporting, not about re-pointing the source).
 *
 * FIX ②: when NEITHER dataset can be read (both requests failed — HTTP 404 or a
 * connection/parse error, verified live for both ids on 2026-09-23), this THROWS.
 * The run then records an error instead of `rows_fetched = 0, errors = 0`, so
 * `collector_staleness` reports the source as DEAD rather than FRESH, and the
 * sync log names the unreachable dataset. A dataset that ANSWERS with zero rows
 * is still an honest empty (returns []) — the distinction the audit asked for.
 */
export async function nysSocrataSource(): Promise<RawBid[]> {
  const primaryReport = newSocrataFetchReport();
  const primary = await fetchSocrataBids("https://data.ny.gov", "e5pk-us93", "nys_socrata", primaryReport);
  if (primary.length > 0) return primary;
  const fallbackReport = newSocrataFetchReport();
  const fallback = await fetchSocrataBids("https://data.ny.gov", "hf3r-utnq", "nys_socrata", fallbackReport);
  if (fallback.length > 0) return fallback;
  if (!primaryReport.reached && !fallbackReport.reached) {
    throw new Error(
      `nys_socrata unreachable: no dataset answered (primary e5pk-us93: ${primaryReport.failure ?? "no rows"}; ` +
        `fallback hf3r-utnq: ${fallbackReport.failure ?? "no rows"}) — a dead source must not be reported as fresh`,
    );
  }
  return [];
}
