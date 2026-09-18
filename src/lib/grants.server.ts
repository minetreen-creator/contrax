/**
 * Contrax Grants — server-only upstream client (owner order 2026-09-16).
 *
 * SERVER-SIDE ONLY. These functions are called exclusively from the
 * /api/grants/search route handler; no grants fetch ever runs in the browser and
 * no key/token is ever sent to a client. The upstream base URLs are hard-coded
 * constants in src/lib/grants.ts — there is no client-controllable URL.
 *
 * TIMEOUT DISCIPLINE (reused from the app's existing collector pattern): every
 * upstream call is wrapped in an AbortController with an explicit deadline, so a
 * hung Grants.gov can never hang the route (and therefore can never leave the
 * page on an endless loader). Two budgets:
 *   - search  : UPSTREAM_SEARCH_TIMEOUT_MS (8s)
 *   - details : UPSTREAM_DETAIL_TIMEOUT_MS per opportunity (6s), issued in
 *               parallel, all inside UPSTREAM_TOTAL_BUDGET_MS (14s) shared
 *               deadline; a detail that fails/times out simply yields no
 *               funding/eligibility/description ("Not specified" in the UI) —
 *               it never fails the whole search.
 *
 * AUTH: the Grants.gov search2 web service needs no key (verified live
 * 2026-09-16). If the owner ever provisions a key (Simpler.Grants.gov requires
 * one), setting GRANTS_GOV_API_KEY makes this module send it as an `X-API-Key`
 * request header — read from the environment, never logged, never returned.
 */
import {
  GRANTS_UPSTREAM_DETAIL_URL,
  GRANTS_UPSTREAM_SEARCH_URL,
  buildUpstreamSearchBody,
  mapGrantResult,
  type GrantResult,
  type GrantsSearchParams,
  type GrantsStatus,
  type GrantsUpstreamDetail,
  type GrantsUpstreamHit,
} from "~/lib/grants";

export const UPSTREAM_SEARCH_TIMEOUT_MS = 8_000;
export const UPSTREAM_DETAIL_TIMEOUT_MS = 6_000;
export const UPSTREAM_TOTAL_BUDGET_MS = 14_000;

/** Raised when the upstream search itself fails or times out. */
export class GrantsUpstreamError extends Error {
  readonly kind: "timeout" | "http" | "malformed";
  constructor(kind: "timeout" | "http" | "malformed", message: string) {
    super(message);
    this.name = "GrantsUpstreamError";
    this.kind = kind;
  }
}

interface UpstreamFetchOptions {
  /** Hard deadline for this single call (AbortController timeout). */
  timeoutMs: number;
  /** Optional shared deadline across several calls (ms epoch). */
  deadline?: number;
}

/**
 * One JSON POST to Grants.gov with a hard timeout. Throws GrantsUpstreamError on
 * timeout / non-2xx / unparseable body — callers decide how to degrade.
 */
async function postJson(
  url: string,
  body: Record<string, unknown>,
  { timeoutMs, deadline }: UpstreamFetchOptions,
): Promise<unknown> {
  const budget = deadline ? Math.min(timeoutMs, Math.max(1, deadline - Date.now())) : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // Optional owner-provisioned key (never required by the endpoint we use).
  const apiKey = typeof process !== "undefined" ? process.env?.GRANTS_GOV_API_KEY : undefined;
  if (apiKey) headers["X-API-Key"] = apiKey;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new GrantsUpstreamError("http", `Grants.gov responded ${res.status}`);
    }
    return (await res.json()) as unknown;
  } catch (e) {
    if (e instanceof GrantsUpstreamError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new GrantsUpstreamError("timeout", "Grants.gov request timed out");
    }
    throw new GrantsUpstreamError(
      "http",
      e instanceof Error ? e.message : "Grants.gov request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface GrantsUpstreamSearchResult {
  hits: GrantsUpstreamHit[];
  totalCount: number;
}

/**
 * Runs the upstream keyword/enum search. Only fields the front end renders are
 * read out of the response; the raw payload is never stored or echoed.
 *
 * `overrides` widens/narrows the paging window. The bounded open-count scan uses
 * it (`rows: COUNT_SCAN_ROWS`, `startRecordNum: 0`); the visitor search path
 * passes nothing, so its upstream body is byte-identical to before.
 */
export async function searchGrantsUpstream(
  params: GrantsSearchParams,
  overrides: { rows?: number; startRecordNum?: number } = {},
): Promise<GrantsUpstreamSearchResult> {
  const payload = (await postJson(
    GRANTS_UPSTREAM_SEARCH_URL,
    buildUpstreamSearchBody(params, overrides),
    {
      timeoutMs: UPSTREAM_SEARCH_TIMEOUT_MS,
    },
  )) as { errorcode?: unknown; data?: unknown } | null;

  // Grants.gov signals application-level failures with errorcode !== 0 too.
  if (payload && typeof payload === "object" && "errorcode" in payload) {
    const code = Number((payload as { errorcode?: unknown }).errorcode);
    if (Number.isFinite(code) && code !== 0) {
      throw new GrantsUpstreamError("http", `Grants.gov error code ${code}`);
    }
  }
  const data = (payload as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object") {
    throw new GrantsUpstreamError("malformed", "Grants.gov returned no data");
  }
  const rawHits = (data as { oppHits?: unknown }).oppHits;
  const hits = Array.isArray(rawHits) ? (rawHits as GrantsUpstreamHit[]) : [];
  const rawCount = Number((data as { hitCount?: unknown }).hitCount);
  return {
    hits,
    totalCount: Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : hits.length,
  };
}

/**
 * The bounded status scan behind the honest counts (owner fix 2026-09-18).
 *
 * Same query filters as the visitor's search, forced to ONE upstream status
 * (`posted` for the Open tab), asking for COUNT_SCAN_ROWS rows from the start.
 * The hits are tallied locally by derived status and are NEVER rendered — this
 * exists so the Open count can exclude forecasts, expired rows and rows whose
 * deadline the source has not published.
 *
 * The response also carries the upstream `hitCount` for that single status: when
 * it is ≤ the rows we asked for, the scan covered the whole set and the tally is
 * exact; above it the tally is a lower bound and the caller labels it "N+".
 */
export async function scanGrantsUpstream(
  params: GrantsSearchParams,
  /** The tab whose single upstream status this scan covers. */
  status: GrantsStatus,
  rows: number,
): Promise<GrantsUpstreamSearchResult & { scanned: number }> {
  const payload = (await postJson(
    GRANTS_UPSTREAM_SEARCH_URL,
    buildUpstreamSearchBody({ ...params, status }, { rows, startRecordNum: 0 }),
    { timeoutMs: UPSTREAM_SEARCH_TIMEOUT_MS },
  )) as { errorcode?: unknown; data?: unknown } | null;

  if (payload && typeof payload === "object" && "errorcode" in payload) {
    const code = Number((payload as { errorcode?: unknown }).errorcode);
    if (Number.isFinite(code) && code !== 0) {
      throw new GrantsUpstreamError("http", `Grants.gov error code ${code}`);
    }
  }
  const data = (payload as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object") {
    throw new GrantsUpstreamError("malformed", "Grants.gov returned no data");
  }
  const rawHits = (data as { oppHits?: unknown }).oppHits;
  const hits = Array.isArray(rawHits) ? (rawHits as GrantsUpstreamHit[]) : [];
  const rawCount = Number((data as { hitCount?: unknown }).hitCount);
  return {
    hits,
    scanned: hits.length,
    totalCount: Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : hits.length,
  };
}

/**
 * Fetches one opportunity's detail (funding + eligibility + text, the source's
 * last-updated stamp, and — for a forecast — its ESTIMATED application deadline).
 * Returns null on any failure — the caller renders "Not specified" rather than
 * inventing a value, and classification NEVER depends on this call.
 *
 * Two shapes exist upstream (verified live 2026-09-18): a POSTED opportunity
 * carries `data.synopsis` (verified for ids 363657 / 356559), while a FORECAST
 * carries `data.forecast` instead and has no synopsis at all (id 355824:
 * MP-CPI-25-001). A forecast's estimate lives in
 * `forecast.estApplicationResponseDate` — normalised here into the pure module's
 * `estimatedDeadline` field so it can only ever be displayed as an ESTIMATE.
 */
async function fetchOpportunityDetail(
  id: string,
  deadline: number,
): Promise<GrantsUpstreamDetail | null> {
  if (!/^\d+$/.test(id)) return null;
  try {
    const payload = (await postJson(
      GRANTS_UPSTREAM_DETAIL_URL,
      { opportunityId: Number(id) },
      { timeoutMs: UPSTREAM_DETAIL_TIMEOUT_MS, deadline },
    )) as { data?: { synopsis?: unknown; forecast?: unknown } } | null;
    const synopsis = payload?.data?.synopsis;
    if (synopsis && typeof synopsis === "object") {
      const s = synopsis as Record<string, unknown>;
      return {
        awardFloor: s.awardFloor,
        awardCeiling: s.awardCeiling,
        estimatedFunding: s.estimatedFunding,
        postingDate: s.postingDate,
        responseDate: s.responseDate,
        applicantTypes: s.applicantTypes,
        synopsisDesc: s.synopsisDesc,
        lastUpdated: s.lastUpdatedDate,
      };
    }
    const forecast = payload?.data?.forecast;
    if (forecast && typeof forecast === "object") {
      const f = forecast as Record<string, unknown>;
      return {
        awardFloor: f.awardFloor,
        awardCeiling: f.awardCeiling,
        estimatedFunding: f.estimatedFunding,
        postingDate: f.postingDate,
        responseDate: null, // a forecast has no response date — only an estimate
        applicantTypes: f.applicantTypes,
        synopsisDesc: f.forecastDesc,
        estimatedDeadline: f.estApplicationResponseDate,
        lastUpdated: f.lastUpdatedDate,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Maps hits to card-ready results, enriching the first `detailLimit` with source
 * funding/eligibility/description in parallel under one shared deadline. Detail
 * calls for cards beyond the limit are skipped entirely — for an anonymous
 * preview that means we fetch 3 details, not 10. `now` (the ET day boundary) is
 * passed through to the classifier so every card in one response is judged
 * against the same clock.
 */
export async function enrichGrants(
  hits: readonly GrantsUpstreamHit[],
  detailLimit: number,
  now: Date | number = new Date(),
): Promise<GrantResult[]> {
  const deadline = Date.now() + UPSTREAM_TOTAL_BUDGET_MS;
  const details = await Promise.all(
    hits.map((hit, index) => {
      if (index >= detailLimit) return Promise.resolve(null);
      const id = typeof hit?.id === "string" || typeof hit?.id === "number" ? String(hit.id) : "";
      return fetchOpportunityDetail(id, deadline);
    }),
  );
  return hits.map((hit, index) => mapGrantResult(hit, details[index] ?? null, now));
}
