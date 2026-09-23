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
 *
 * PR-1 RESTRUCTURE (owner-approved source-provenance policy, plan rev 315,
 * ruling c — 2026-09-23): the two collector entry points that used this file are
 * GONE. `nys_socrata` is RETIRED — it was removed from the runner's registry
 * (both of its data.ny.gov dataset ids answer 404, and the "fallback" id
 * `hf3r-utnq` is in fact LA's RAMP dataset id), and `nyc_socrata` was the dead
 * NYC export nobody registered. What remains is the SODA page reader
 * (`fetchSocrataBids`) and its optional honest reach/failure `report`, which the
 * deterministic tests in this repository exercise directly.
 *
 * RETIRED ≠ FIXED: the fix-② behaviour that DEAD-classification depends on is
 * unchanged and still active for every source that DOES run (the five city
 * portals raise the same shared `SourceUnreachableError` via
 * `city-procurement.ts` + `fetch-failure.ts`). Retiring `nys_socrata` only stops
 * the dead collector from producing a run row at all — so an after-run readout
 * that used to expect "nys_socrata ran_zero" now simply never sees the label.
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
type SourceName = string;

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
        // No invented geography: the record's own location field, or nothing.
        // (This line used to fall back to the literal "New York" for every
        // nameless record — the PR-1 retirement removed that claim.)
        const location = text(value(record, "location", "county", "city"));
        const fullText = `${title} ${description}`;
        // The dataset landing page is the honest link for a row with no notice
        // page of its own.
        const sourceUrl = `${baseUrl.replace(/\/$/, "")}/resource/${datasetId}.json`;

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
