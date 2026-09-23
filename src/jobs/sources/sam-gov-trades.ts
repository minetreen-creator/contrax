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
 *
 * HONEST ZEROS (nationwide correctness FIX ④, PR B2)
 * --------------------------------------------------
 * A trade pass could yield nothing in three completely different ways and the
 * run record could not tell them apart: a gate refusal on real notices (484110:
 * SAM returns 3 notices; the purchased-service gate refuses all 3), a genuinely
 * empty filter (484121: SAM reports `totalElements = 0` — verified live
 * 2026-09-23) and an unreadable response (`_embedded.results` missing at HTTP
 * 200). This module now (a) parses every page through `readSearchEnvelope`, so a
 * malformed / error-shaped page-0 payload throws `TradeResponseShapeError`
 * instead of being recorded as a clean zero, and (b) reports SAM's own
 * `page.totalElements` per pass (`responseTotal`). The per-pass OUTCOME
 * (`all_skipped` / `zero_empty` / `data_error` / `suppressed_duplicate` / `ok`)
 * is derived from the run record by `~/jobs/pass-outcome`.
 */

import {
  SAM_HEADERS,
  mapSamItem,
  stripHtml,
  type OpportunityDetail,
  type RawBid,
} from "./sam-gov";
import { tradePassExclusion } from "~/lib/trade-classification";
import { FEDERAL_TRADE_SOURCE_LABELS } from "~/lib/cert-matching";

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
    // QA re-verification N2 (PR #414): every pass's `name` IS the stored `source`
    // value, so it must be registered as a FEDERAL source label. Otherwise the
    // certification rule 3/5 path would treat this federal feed as a state/local
    // portal (NULL set-aside pulled into the Small-Business pool) and Bid Alerts
    // would render the row as "City". Enforced here so a future 12th pass cannot
    // reintroduce that silently — the failure is at module load, i.e. in CI.
    if (!FEDERAL_TRADE_SOURCE_LABELS.includes(f.name)) {
      throw new Error(
        `[sam-gov-trades] source "${f.name}" is not listed in ` +
          `FEDERAL_TRADE_SOURCE_LABELS (src/lib/cert-matching.ts) — a federal ` +
          `trade pass must be registered there (QA N2).`,
      );
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
 * HONEST-EMPTY vs UNREADABLE (nationwide correctness FIX ④, PR B2).
 *
 * Thrown when a page-0 SAM.gov response is HTTP 200 but is NOT a usable v1
 * search envelope: no `page` block and no `_embedded.results` array, or a
 * `page.totalElements > 0` with no results to go with it. Before this check the
 * pass did `data?._embedded?.results ?? []` and then `break`, so a malformed /
 * error-shaped payload was recorded as `rows_fetched = 0, errors = 0` — an
 * HONEST-looking zero, indistinguishable from "SAM has nothing open for this
 * code" (fix ②'s blindness, measured on `naics=484121`). Throwing makes it a
 * recorded ERROR instead: the runner logs the source error, the run record
 * carries `errors = 1`, the freshness tier is DEAD (never EMPTY), and
 * `classifyPassOutcome` reports `data_error` (src/jobs/pass-outcome.ts).
 *
 * The message is deliberately diagnostic (the reason + the offending shape) —
 * it is what a human reads in `sync_logs.errors` when a pass goes red.
 */
export class TradeResponseShapeError extends Error {
  readonly code = "sam_trade_response_shape";
  constructor(message: string) {
    super(message);
    this.name = "TradeResponseShapeError";
  }
}

/** What one SAM.gov search page's envelope tells us (see `readSearchEnvelope`). */
export interface SearchEnvelope {
  /** The page's result items (`[]` for an honest empty page). */
  items: any[];
  /** `page.totalElements` when SAM published it, else null (never invented). */
  totalElements: number | null;
}

/**
 * Read ONE SAM.gov v1 search response honestly — pure, total, no network.
 *
 * An HONEST answer is `{ items, totalElements }`; an unusable one is a reason
 * string (the caller decides: page 0 must fail loudly, a later page is the
 * documented end-of-results). Rules, in order:
 *   - the body must be a JSON object;
 *   - it must carry EITHER `_embedded.results` (an array) OR `page.totalElements`
 *     (a number) — a bare error envelope (`{"status":500,…}`) carries neither;
 *   - `totalElements > 0` with no/empty `results` is a shape error: SAM says it
 *     has matches and then hands over none — the exact case that must never be
 *     recorded as an honest zero (an empty `_embedded.results` WITH
 *     `totalElements = 0` is honest and stays `zero_empty`).
 */
export function readSearchEnvelope(
  data: unknown,
): { ok: true; envelope: SearchEnvelope } | { ok: false; reason: string } {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: `response body is not a JSON object (${typeof data})` };
  }
  const raw = data as any;
  const embedded = raw._embedded;
  const rawItems = embedded && typeof embedded === "object" ? (embedded as any).results : undefined;
  const items = Array.isArray(rawItems) ? rawItems : null;
  const page = raw.page && typeof raw.page === "object" ? (raw.page as any) : null;
  const totalElements = page && Number.isFinite(Number(page.totalElements))
    ? Number(page.totalElements)
    : null;

  if (items === null && totalElements === null) {
    return {
      ok: false,
      reason:
        "no `_embedded.results` array and no `page.totalElements` — not a SAM.gov v1 search envelope",
    };
  }
  if (items === null && totalElements !== null && totalElements > 0) {
    return {
      ok: false,
      reason: `SAM reports ${totalElements} matching notice(s) but the payload carries no results array`,
    };
  }
  if (items !== null && items.length === 0 && totalElements !== null && totalElements > 0) {
    return {
      ok: false,
      reason: `SAM reports ${totalElements} matching notice(s) but returned an empty results array`,
    };
  }
  return { ok: true, envelope: { items: items ?? [], totalElements } };
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
  /**
   * SAM's own `page.totalElements` for this filter on page 0 (null when the
   * response did not publish it). This is the source's OWN count of matching
   * notices — never a guess — and it is what makes "SAM has 3 matching notices
   * and the pass refused all 3" (484110) distinguishable from "SAM has none"
   * (484121) in the pass's diagnostics.
   */
  responseTotal: number | null;
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
  /** SAM's own match count for this filter (page 0). null = not published. */
  let responseTotal: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = buildTradeSearchUrl(filter, page);
    let items: any[];
    try {
      const data = await fetchJson(url);
      const read = readSearchEnvelope(data);
      if (!read.ok) {
        // FIX ④: an HTTP 200 that is not a usable envelope is NOT an honest
        // zero. Page 0 must fail loudly (the runner records the error, the
        // outcome is `data_error`, the freshness tier is DEAD); a later page is
        // the documented end-of-results, but it is logged, never silent.
        const message = `${filter.name}: unreadable SAM.gov search response — ${read.reason}`;
        if (page === 0) throw new TradeResponseShapeError(message);
        console.error(`  ${message} (page ${page}) — treating as end of results`);
        break;
      }
      if (page === 0) {
        responseTotal = read.envelope.totalElements;
        console.log(
          `  ${filter.name}: SAM reports ${
            responseTotal === null ? "an unknown number of" : responseTotal
          } matching notice(s) for ${filter.kind}=${filter.code}`,
        );
      }
      items = read.envelope.items;
    } catch (e) {
      // A non-200 on page > 0 means we walked past the end; page 0 must surface.
      if (page === 0) throw e;
      console.error(`  ${filter.name}: page ${page} error:`, (e as Error).message);
      break;
    }
    if (items.length === 0) break;

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

  // FIX ④: report SAM's own match count for the pass alongside the rows. When
  // the pass yields nothing this is what tells the two zero cases apart without
  // guessing: `responseTotal 3` + all rows refused = a gate decision on real
  // notices (484110), `responseTotal 0` = the filter genuinely matches nothing
  // (484121). It is SAM's number, never a count we invent.
  if (results.length === 0 && responseTotal !== null && responseTotal > 0) {
    console.log(
      `  ${filter.name}: SAM reports ${responseTotal} matching notice(s) but none entered this pass ` +
        `(gated: ${
          Object.keys(skipped).length > 0 ? JSON.stringify(skipped) : "none"
        }) — see the pass outcome in the run log`,
    );
  }

  return { rows: results, skipped, skippedRows, responseTotal };
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
