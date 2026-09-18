import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { rateLimitedResponse } from "~/lib/rate-limit";
import {
  COUNT_SCAN_ROWS,
  GRANTS_ORG_NOTICE,
  GRANTS_PRICE_LABEL,
  GRANTS_SOURCE_LABEL,
  MAX_PAGE,
  PAGE_SIZE,
  PREVIEW_LIMIT,
  applyPreviewCap,
  filterResultsForStatus,
  isUpgradePromptEnabled,
  parseGrantsSearchParams,
  tallyGrantStatuses,
  type GrantResult,
  type GrantsStatus,
} from "~/lib/grants";
import {
  GrantsUpstreamError,
  enrichGrants,
  scanGrantsUpstream,
  searchGrantsUpstream,
} from "~/lib/grants.server";
import {
  NO_GRANTS_SUBSCRIPTION,
  getGrantsSubscription,
  grantsAccessTier,
} from "~/lib/grants-subscription.server";
import {
  checkGrantsAnonIpLimit,
  checkGrantsIpLimit,
  checkGrantsUserLimit,
  consumeAnonymousSearch,
  refundAnonymousSearch,
} from "~/lib/grants-limits.server";

/**
 * GET /api/grants/search — Contrax Grants V1 search (owner order 2026-09-16).
 *
 * SERVER-SIDE ONLY. The browser never talks to Grants.gov and never sees any
 * key: this handler is the only place the upstream search + per-opportunity
 * detail calls happen. Grants are NOT persisted anywhere — no insert into
 * bids/solicitations/contracts and no result cache; the only trace a search
 * leaves is the isolated grants_* analytics event the PAGE fires.
 *
 * QUERY PARAMETERS (every one validated + bounded by parseGrantsSearchParams;
 * a present-but-invalid value is a hard 400, never silently coerced):
 *   keyword          free text, control chars stripped, max 120 chars
 *   applicantType    CLOSED LIST — Grants.gov eligibility codes (17)
 *   fundingCategory  CLOSED LIST — Grants.gov funding-activity codes (21)
 *   agency           CLOSED LIST — Grants.gov top-level agency codes (26)
 *   status           `open` (default: source-confirmed posted AND not yet due) |
 *                    `forecast` (`forecasted` only) | `closed` (`closed` only)
 *   page             1..MAX_PAGE (5) — the "Load more" cursor, 10 results/page
 *
 * FRESHNESS (owner fix 2026-09-18, see src/lib/grants.ts FRESHNESS CONTRACT):
 *   - Open asks upstream for `posted` and then keeps only rows whose DERIVED
 *     status is open (posted + a published closeDate that has not passed, ET day
 *     boundary, inclusive of the deadline day). Forecasts can therefore never
 *     appear in Open, which is what put MP-CPI-25-001/003 in it.
 *   - The Open COUNT is not upstream's `hitCount` (that includes posted rows with
 *     no published deadline). One bounded scan (`COUNT_SCAN_ROWS = 1000`, the
 *     upstream row cap, verified live) tallies the whole status-filtered set
 *     locally: exact when upstream's own hitCount ≤ 1000, otherwise reported as a
 *     lower bound ("N+"). Forecast/closed counts need no scan — upstream already
 *     filtered to exactly one status, so its hitCount is exact.
 *   - `asOf` is the server timestamp of the successful upstream search this
 *     response is based on — the page shows it separately from each card's own
 *     "Source last updated".
 *   - If the count scan fails, the search still succeeds and the count degrades
 *     to the filtered page size labelled "N+" — never to the unfiltered hitCount.
 *   - On Open, one further tiny request (`rows: 1`, `forecasted`) supplies the
 *     source's exact forecasted total for the same filters, so the page states
 *     how many forecasts are NOT counted as open rather than implying 0.
 *
 * ACCESS MODEL (owner spec, updated 2026-09-17 for the $19/month product):
 *   - granted (signed in + a Stripe-written status of `active`/`trialing`):
 *     full pages, "Load more" up to MAX_PAGE — the same path signed-in users had.
 *   - everyone else — anonymous AND signed in without a granted subscription —
 *     gets the EXISTING anonymous limits (one search per visitor per day, at most
 *     PREVIEW_LIMIT cards, then a 200 with `requiresAuth: true`) plus the upgrade
 *     prompt. grants-limits.server.ts is unchanged, and access is NEVER taken
 *     from the ?checkout=success redirect parameter.
 *   - the $19/month prompt is gated by GRANTS_UPGRADE_PROMPT_ENABLED (default
 *     OFF); `subscribed` tells the page which CTA to render.
 *
 * FAILURE MODEL (no endless loader, ever): the upstream search has an 8s
 * AbortController deadline (14s shared budget for detail enrichment). A timeout
 * or upstream error becomes a 502 with a retryable message; the page also aborts
 * its own fetch at 20s and renders the error + retry state.
 *
 * RESPONSES: 200 (results | requiresAuth wall) · 400 (invalid parameter) ·
 * 429 (rate limited) · 502 (upstream timeout/failure). Every response is
 * `Cache-Control: no-store` (per-visitor caps + freshness).
 */

const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

/** Fields the page renders; nothing else from the upstream payload is returned. */
interface GrantsSearchPayload {
  ok: true;
  source: string;
  /** The status filter this response answers (echoed so the page can label it). */
  status: GrantsStatus;
  authenticated: boolean;
  /** True only when the caller has a granted ($19/month) Grants subscription. */
  subscribed: boolean;
  requiresAuth?: boolean;
  message?: string;
  /** Honest count for `status` — for `open`: posted AND not yet due. */
  totalCount: number;
  /** False when `totalCount` is a lower bound ("N+"), never a confirmed total. */
  countExact: boolean;
  /** Server timestamp of the upstream search this response came from. */
  asOf?: string;
  /**
   * Rows the source returned for this filter but that we deliberately do NOT
   * present as open (past deadline / no published deadline / forecasts). Shown
   * so nothing is silently hidden. `forecasts` is the source's own exact
   * `forecasted` total for the same filters (see handler), not a scan artefact;
   * it is `null` when that count call failed, and the page then omits the clause
   * rather than printing a false 0.
   */
  excluded?: ExcludedCounts;
  page: number;
  pageSize: number;
  maxPage: number;
  hasMore: boolean;
  lockedCount: number;
  previewLimit: number;
  upgradePromptEnabled: boolean;
  upgradePrice: string;
  notice: string;
  results: GrantResult[];
}

function buildPayload(opts: {
  status: GrantsStatus;
  authenticated: boolean;
  /** full access = signed in AND subscribed; otherwise the anonymous preview. */
  granted: boolean;
  subscribed: boolean;
  results: GrantResult[];
  totalCount: number;
  countExact: boolean;
  /**
   * Pool size for "Load more" (the upstream count for the requested status).
   * Defaults to totalCount; it differs for Open, where totalCount is the
   * corrected open count but paging walks the upstream `posted` window.
   */
  pagingTotal?: number;
  asOf?: string;
  excluded?: ExcludedCounts;
  page: number;
  requiresAuth?: boolean;
  message?: string;
  upgradePromptEnabled: boolean;
}): GrantsSearchPayload {
  const results = opts.granted
    ? opts.results
    : applyPreviewCap(opts.results, false); // belt + braces: the cap is applied here, not by callers
  const returned = results.length;
  const totalCount = opts.totalCount;
  const pagingTotal = opts.pagingTotal ?? opts.totalCount;
  // "Load more" is a subscriber affordance only: a visitor without a granted
  // subscription gets the preview + the wall/upgrade prompt instead of another
  // page of results.
  const hasMore =
    opts.granted &&
    !opts.requiresAuth &&
    pagingTotal > opts.page * PAGE_SIZE &&
    opts.page < MAX_PAGE;
  return {
    ok: true,
    source: GRANTS_SOURCE_LABEL,
    status: opts.status,
    authenticated: opts.authenticated,
    subscribed: opts.subscribed,
    ...(opts.requiresAuth ? { requiresAuth: true } : {}),
    ...(opts.message ? { message: opts.message } : {}),
    totalCount,
    countExact: opts.countExact,
    ...(opts.asOf ? { asOf: opts.asOf } : {}),
    ...(opts.excluded ? { excluded: opts.excluded } : {}),
    page: opts.page,
    pageSize: PAGE_SIZE,
    maxPage: MAX_PAGE,
    hasMore,
    lockedCount: Math.max(0, totalCount - returned),
    previewLimit: opts.granted ? PAGE_SIZE : PREVIEW_LIMIT,
    upgradePromptEnabled: opts.upgradePromptEnabled,
    upgradePrice: GRANTS_PRICE_LABEL,
    notice: GRANTS_ORG_NOTICE,
    results,
  };
}

/**
 * Counts of rows the source returned for the active filter that we deliberately
 * do NOT present as open. `forecasts` is the source's own exact `forecasted`
 * total for the same filters (see handler) and is `null` when that count could
 * not be retrieved — the page then omits the clause rather than printing a false
 * 0. One type for the payload, the builder and the local variable, so the three
 * can never drift apart again.
 */
type ExcludedCounts = { expiredPosted: number; missingDeadline: number; forecasts: number | null };

/**
 * The Open tab's concurrent count work: [bounded `posted` scan (null on
 * failure), source's exact `forecasted` total for the same filters (null on
 * failure)]. Both are best-effort — the search itself must still succeed.
 */
type ScanPair = [Awaited<ReturnType<typeof scanGrantsUpstream>> | null, number | null];

async function handler({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseGrantsSearchParams(url.searchParams);
  if (!parsed.ok) {
    return json({ ok: false, error: parsed.error }, 400);
  }
  const params = parsed.params;
  const upgradePromptEnabled = isUpgradePromptEnabled(
    (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>,
  );

  // Identity first — the caps differ for anonymous vs signed-in visitors.
  const user = await getUserFromRequest(request);
  const authenticated = user !== null;

  // Entitlement (owner 2026-09-17): full access comes ONLY from a granted
  // ($19/month) subscription status written by verified Stripe webhooks. A
  // signed-in user WITHOUT one falls back to the anonymous limits + upgrade
  // prompt — the ?checkout=success param is never consulted here.
  const subscription = authenticated
    ? await getGrantsSubscription(user.id)
    : NO_GRANTS_SUBSCRIPTION;
  const tier = grantsAccessTier({
    authenticated,
    subscribed: subscription.subscribed,
  });
  const granted = tier === "full";

  // Layer 3: per-IP backstop for every request.
  const ipLimit = await checkGrantsIpLimit(request);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);

  let countsAgainstAnonymousCredit = false;
  if (authenticated) {
    const userLimit = await checkGrantsUserLimit(user.id);
    if (!userLimit.allowed) return rateLimitedResponse(userLimit);
  }
  if (!granted) {
    // Layer 2: anonymous IP backstop (cookie-clearing abuse).
    const anonIpLimit = await checkGrantsAnonIpLimit(request);
    if (!anonIpLimit.allowed) return rateLimitedResponse(anonIpLimit);
    // Layer 1: the single free search (anonymous OR signed in without a
    // granted subscription — unchanged policy, grants-limits.server.ts).
    const anon = await consumeAnonymousSearch(request);
    if (!anon.allowed) {
      return json(
        buildPayload({
          status: params.status,
          authenticated,
          granted: false,
          subscribed: subscription.subscribed,
          results: [],
          totalCount: 0,
          countExact: true,
          page: 1,
          requiresAuth: true,
          message: authenticated
            ? `You've used your free grant search. Subscribe to Contrax Grants (${GRANTS_PRICE_LABEL}) for full results and unlimited searches.`
            : "You've used your free grant search. Create a free account to keep searching Grants.gov — it's free.",
          upgradePromptEnabled,
        }),
      );
    }
    countsAgainstAnonymousCredit = true;
  }

  // Cap the upstream rows we ask for: a preview needs only PREVIEW_LIMIT cards.
  const detailLimit = granted ? PAGE_SIZE : PREVIEW_LIMIT;
  // One clock for the whole response, so every classification in it agrees.
  const now = new Date();

  // The bounded count scan runs CONCURRENTLY with the search. It is a second
  // upstream request only on the Open tab (the one tab whose count needs
  // filtering); a failure never fails the search — it degrades the count.
  //
  // `forecastTotal` is a tiny third request (`rows: 1`) on the Open tab only.
  // The Open scan is deliberately `posted`-only, so it can never observe the
  // forecasts that are excluded from Open: without this the page would print
  // "0 forecasted" above a reduced count, which is false. Upstream's own
  // hitCount for `forecasted` (same filters) is the source's exact number.
  const scanPromise: Promise<ScanPair> =
    params.status === "open"
      ? Promise.all([
          scanGrantsUpstream(params, "open", COUNT_SCAN_ROWS).catch((e) => {
            console.error("[grants] count scan failed:", e instanceof Error ? e.message : e);
            return null;
          }),
          scanGrantsUpstream(params, "forecast", 1)
            .then((r) => r.totalCount)
            .catch((e) => {
              console.error("[grants] forecast count failed:", e instanceof Error ? e.message : e);
              return null;
            }),
        ])
      : Promise.resolve<ScanPair>([null, null]);

  try {
    const { hits, totalCount: upstreamStatusCount } = await searchGrantsUpstream(params);
    const [enriched, scanPair] = await Promise.all([
      enrichGrants(hits, detailLimit, now),
      scanPromise,
    ]);
    const [scan, forecastTotal] = scanPair;
    // Freshness: a card is only shown under the status the source confirms for
    // it, so nothing that upstream returned for a broader status can leak in.
    const visible = filterResultsForStatus(enriched, params.status);
    const asOf = new Date().toISOString();

    let totalCount = upstreamStatusCount;
    let countExact = true;
    let excluded: ExcludedCounts | undefined;
    if (params.status === "open") {
      if (scan) {
        const tally = tallyGrantStatuses(scan.hits, now);
        // Exact only when the scan could see the entire status-filtered set
        // (upstream caps a response at COUNT_SCAN_ROWS rows).
        totalCount = tally.open;
        countExact = scan.totalCount <= COUNT_SCAN_ROWS;
        excluded = {
          expiredPosted: tally.expiredPosted,
          missingDeadline: tally.missingDeadline,
          // The scan is `posted`-only and so cannot see forecasts: use the
          // source's own exact `forecasted` total for the same filters, or null
          // (never a fabricated 0) when that count call failed.
          forecasts: forecastTotal,
        };
      } else {
        // Never fall back to upstream's unfiltered hitCount (it would count
        // forecasts and deadline-less rows as open). The filtered page is a true
        // floor, and it is labelled as one.
        totalCount = visible.length;
        countExact = false;
      }
    }

    return json(
      buildPayload({
        status: params.status,
        authenticated,
        granted,
        subscribed: subscription.subscribed,
        results: visible,
        totalCount,
        countExact,
        pagingTotal: upstreamStatusCount,
        asOf,
        ...(excluded ? { excluded } : {}),
        page: params.page,
        upgradePromptEnabled,
      }),
    );
  } catch (e) {
    // A failed upstream search must not eat an anonymous visitor's free search.
    if (countsAgainstAnonymousCredit) await refundAnonymousSearch(request);
    const isTimeout = e instanceof GrantsUpstreamError && e.kind === "timeout";
    console.error("[grants] upstream search failed:", e instanceof Error ? e.message : e);
    return json(
      {
        ok: false,
        error: isTimeout
          ? "Grants.gov took too long to respond. Please try again."
          : "We couldn't reach Grants.gov just now. Please try again.",
        retryable: true,
      },
      502,
    );
  }
}

export const Route = createFileRoute("/api/grants/search")({
  server: { handlers: { GET: handler } },
});
