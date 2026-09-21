/**
 * SAM.gov TRADE-FILTER passes — janitorial + trucking ingestion
 * (owner PRIORITY 09-21, R1).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The audit (`shared/janitorial-trucking-audit-2026-09-21.md` §3.5) measured the
 * SAM.gov v1 search API directly: it honours the STRUCTURED filters `naics=<code>`
 * and `psc=<code>` (they change `totalElements`; bogus parameter names do not),
 * and the pipeline had never sent either — so these trades were captured only by
 * luck from the 100-row national recency window plus 51 state keyword queries.
 *
 * This module asks the API the question directly: one pass per code, each
 * registered as its OWN SyncSource so run logs, staleness and quality gates stay
 * per-category and independently observable.
 *
 * PSC MAPPING — CORRECTED ON LIVE DATA (audit §3.6)
 * -------------------------------------------------
 * The owner's original brief mapped janitorial → PSC R602. Live SAM data says
 * otherwise, and the data wins:
 *   - `psc=S201` returns EXACTLY the same 253 active notices as `naics=561720`
 *     ("S201--Janitorial Services …", "S--HAFC Janitorial SERVICES") — S201 IS
 *     Housekeeping–Custodial Janitorial.
 *   - `psc=R602` (28) returns COURIER/DELIVERY work ("1 SOMDG Medical Courier
 *     Services", "Newspaper and Periodicals Delivery Support Services").
 *   - `psc=V112` (18) returns motor freight / moving / drayage ("Bldgs … METC
 *     Furniture Relocation and Storage", "Justification & Approval for Drayage
 *     Services in Germany").
 * So: janitorial = NAICS 561720 + PSC S201; trucking/courier = the seven NAICS
 * codes + PSC V112 + PSC R602. R602 stays IN THE SET — it is one of the
 * categories the owner listed ("courier, delivery, medical-courier") — but it is
 * labelled for what it is, never as janitorial.
 *
 * DELIBERATELY NOT HERE (scope, audit R6/R7): the `sam-gov.ts` "regional" pass
 * still sends `placeOfPerformance.state=`, which the API SILENTLY IGNORES. The
 * honoured spelling is `state=`; repairing that multiplies ingest volume (~4×)
 * and is NOT janitorial/trucking-specific, so it is a separate PR. The
 * `oh_dayton` state/local connector (R7) belongs to the Ohio fix PR — two PRs
 * must not edit `runner.ts` + `src/jobs/sources/` concurrently.
 */

import {
  SAM_HEADERS,
  mapSamItem,
  stripHtml,
  type OpportunityDetail,
  type RawBid,
} from "./sam-gov";
import { tradePassExclusion } from "~/lib/trade-classification";

/** Same page size as the national pass (SAM.gov's documented practical max). */
export const TRADE_PAGE_SIZE = 25;
/**
 * Per-filter page cap (100 rows/pass), identical to the national pass. Deeper
 * backfill of a 253-notice code is a separate volume/rate-limit decision, so this
 * PR keeps the polite bound and says so instead of pretending the set is complete.
 */
export const TRADE_MAX_PAGES = 4;
/** Inter-page politeness delay (same as the national pass). */
export const TRADE_DELAY_MS = 500;

export type TradeFilterKind = "naics" | "psc";

/** One structured-filter pass = one SyncSource. */
export interface SamTradeFilter {
  /** SyncSource name AND the stored `source` value — unique, observable. */
  name: string;
  kind: TradeFilterKind;
  /** `naics` = 6 digits, `psc` = letter + 3 digits. Validated at module load. */
  code: string;
  /** The owner-facing trade this pass serves. */
  trade: "janitorial" | "trucking";
  /** Human label (run-log / PR description). */
  label: string;
}

/** JANITORIAL: NAICS 561720 + PSC S201 (the corrected mapping — see the header). */
export const JANITORIAL_TRADE_FILTERS: SamTradeFilter[] = [
  {
    name: "sam_naics_561720",
    kind: "naics",
    code: "561720",
    trade: "janitorial",
    label: "Janitorial Services",
  },
  {
    name: "sam_psc_s201",
    kind: "psc",
    code: "S201",
    trade: "janitorial",
    label: "Housekeeping — Custodial Janitorial",
  },
];

/**
 * TRUCKING / COURIER: the owner's seven NAICS codes + PSC V112 (motor freight,
 * moving, drayage) + PSC R602 (courier / delivery — including medical courier).
 * R602 is included per the owner's category list and is labelled correctly.
 */
export const TRUCKING_TRADE_FILTERS: SamTradeFilter[] = [
  { name: "sam_naics_484110", kind: "naics", code: "484110", trade: "trucking", label: "General Freight Trucking, Local" },
  { name: "sam_naics_484121", kind: "naics", code: "484121", trade: "trucking", label: "General Freight Trucking, Long-Distance, Truckload" },
  { name: "sam_naics_484122", kind: "naics", code: "484122", trade: "trucking", label: "General Freight Trucking, Long-Distance, Less Than Truckload" },
  { name: "sam_naics_484210", kind: "naics", code: "484210", trade: "trucking", label: "Used Household and Office Goods Moving" },
  { name: "sam_naics_484220", kind: "naics", code: "484220", trade: "trucking", label: "Specialized Freight Trucking, Local" },
  { name: "sam_naics_484230", kind: "naics", code: "484230", trade: "trucking", label: "Specialized Freight Trucking, Long-Distance" },
  { name: "sam_naics_492110", kind: "naics", code: "492110", trade: "trucking", label: "Couriers and Express Delivery Services" },
  { name: "sam_psc_v112", kind: "psc", code: "V112", trade: "trucking", label: "Motor Freight / Moving / Drayage" },
  { name: "sam_psc_r602", kind: "psc", code: "R602", trade: "trucking", label: "Courier / Delivery Services" },
];

export const SAM_TRADE_FILTERS: SamTradeFilter[] = [
  ...JANITORIAL_TRADE_FILTERS,
  ...TRUCKING_TRADE_FILTERS,
];

/** Fail fast on a malformed code or a duplicate source name (module load). */
function validateTradeFilters(filters: SamTradeFilter[]): void {
  const seen = new Set<string>();
  for (const f of filters) {
    const okCode =
      f.kind === "naics" ? /^\d{6}$/.test(f.code) : /^[A-Z][0-9]{3}$/.test(f.code);
    if (!okCode) {
      throw new Error(`[sam-gov-trades] bad ${f.kind} code: "${f.code}"`);
    }
    if (seen.has(f.name)) {
      throw new Error(`[sam-gov-trades] duplicate source name: "${f.name}"`);
    }
    seen.add(f.name);
  }
}

validateTradeFilters(SAM_TRADE_FILTERS);

/**
 * The structured-filter query URL for one pass page. Exported so a deterministic
 * test can pin the EXACT parameters that were proven to work (`naics=` / `psc=`)
 * — and prove the silently-ignored `placeOfPerformance.state=` is never used.
 */
export function buildTradeSearchUrl(filter: SamTradeFilter, page: number): string {
  const param = filter.kind === "naics" ? "naics" : "psc";
  return (
    `https://sam.gov/api/prod/sgs/v1/search/?page=${page}&size=${TRADE_PAGE_SIZE}` +
    `&sort=-modifiedDate&mode=opportunities&q=&is_active=true` +
    `&${param}=${encodeURIComponent(filter.code)}`
  );
}

export interface TradeFetchDeps {
  /** Page fetcher (injected in tests to feed saved fixtures; zero network). */
  fetchJson?: (url: string) => Promise<any>;
  /** Detail fetcher (injected in tests; defaults to the real endpoint). */
  detailFetcher?: (noticeId: string) => Promise<OpportunityDetail>;
  /** Override the inter-page politeness delay (tests use 0). */
  delayMs?: number;
  /** Max pages for this invocation (defaults to TRADE_MAX_PAGES). */
  maxPages?: number;
}

/**
 * One trade pass's rows PLUS its reason-coded skip accounting — the same shape
 * the runner's run-record contract consumes for every other source, so a
 * `fetched = accepted + skipped + failed` invariant holds per trade pass too.
 */
export interface TradeFetchResult {
  rows: RawBid[];
  /** reason -> count (e.g. `product_buy: 4`). */
  skipped: Record<string, number>;
  /** One diagnostic per skipped notice (id = SAM notice id / fixture fallback). */
  skippedRows: { id: string; reason: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function defaultFetchJson(url: string): Promise<any> {
  const resp = await fetch(url, { headers: SAM_HEADERS });
  if (!resp.ok) {
    const err = new Error(`SAM.gov trade pass returned ${resp.status}`);
    (err as any).status = resp.status;
    throw err;
  }
  return resp.json();
}

/**
 * Fetch ONE structured-filter pass (all pages up to the cap).
 *
 * Rows carry the filter's own code as AUTHORITATIVE provenance (the source
 * returned the notice FOR that code), plus the notice type / solicitation number
 * from the summary and the set-aside + the complementary code from the detail
 * endpoint — the same mapping the national pass uses (`mapSamItem`).
 *
 * PURCHASED-SERVICE GATE (QA F4b): before a notice is mapped, it is put through
 * the shared `tradePassExclusion` gate. A notice whose purchased thing is a
 * PRODUCT / equipment buy, a dump-truck listing or specialty-only cleaning is
 * SKIPPED with a reason — it never enters this trade's output and is therefore
 * never stamped with the trade's code as "authoritative". Live `naics=484110`
 * really does return "Depot Consumable Parts Processing & Disposal (DEMIL)" and
 * "Removal of 32 FT Bathroom Trailer"; those must not become "trucking".
 */
export async function fetchTradeFilterDetailed(
  filter: SamTradeFilter,
  deps: TradeFetchDeps = {},
): Promise<TradeFetchResult> {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const maxPages = deps.maxPages ?? TRADE_MAX_PAGES;
  const delayMs = deps.delayMs ?? TRADE_DELAY_MS;
  const results: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];

  for (let page = 0; page < maxPages; page++) {
    const url = buildTradeSearchUrl(filter, page);
    let items: any[];
    try {
      const data = await fetchJson(url);
      items = data?._embedded?.results ?? [];
    } catch (e) {
      // A non-200 on page > 0 means we walked past the end; page 0 must surface.
      if (page === 0) throw e;
      console.error(`  ${filter.name}: page ${page} error:`, (e as Error).message);
      break;
    }
    if (!Array.isArray(items) || items.length === 0) break;

    for (const [index, item] of items.entries()) {
      const fallbackId = `${filter.name}-p${page}-${index}`;
      try {
        // Purchased-service-only gate, on the SAME title/description the mapper
        // stores (identical extraction: item.title + stripped description).
        const title = String(item?.title ?? "");
        const description = stripHtml(item?.descriptions?.[0]?.content || "").substring(0, 2000);
        const exclusion = tradePassExclusion(filter.trade, title, description);
        if (exclusion) {
          skipped[exclusion] = (skipped[exclusion] ?? 0) + 1;
          skippedRows.push({
            id: String(item?.parentNoticeId || item?._id || item?.solicitationNumber || fallbackId),
            reason: exclusion,
          });
          continue;
        }
        results.push(
          await mapSamItem(item, {
            sourceLabel: filter.name,
            // The pass's own code is authoritative for itself; the other code
            // (and the set-aside) comes from the detail endpoint inside mapSamItem.
            filterNaics: filter.kind === "naics" ? filter.code : null,
            filterPsc: filter.kind === "psc" ? filter.code : null,
            detailFetcher: deps.detailFetcher,
            fallbackId,
          }),
        );
      } catch (e) {
        console.error(`  ${filter.name}: error parsing item:`, (e as Error).message);
      }
    }

    if (items.length < TRADE_PAGE_SIZE) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return { rows: results, skipped, skippedRows };
}

/**
 * The pass's rows only (every other caller's contract — the gated set is the
 * same one `fetchTradeFilterDetailed` returns).
 */
export async function fetchTradeFilter(
  filter: SamTradeFilter,
  deps: TradeFetchDeps = {},
): Promise<RawBid[]> {
  return (await fetchTradeFilterDetailed(filter, deps)).rows;
}

/**
 * Build the SyncSource fetch function for one filter (the runner registers one
 * SyncSource per filter so each has its own run-log row). Returns the
 * reason-coded skip accounting alongside the rows, so the run record for each
 * trade pass shows exactly how many notices the purchased-service gate refused.
 */
export function createSamTradeSource(filter: SamTradeFilter): () => Promise<TradeFetchResult> {
  return () => fetchTradeFilterDetailed(filter);
}
