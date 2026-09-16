import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { rateLimitedResponse } from "~/lib/rate-limit";
import {
  GRANTS_ORG_NOTICE,
  GRANTS_PRICE_LABEL,
  GRANTS_SOURCE_LABEL,
  MAX_PAGE,
  PAGE_SIZE,
  PREVIEW_LIMIT,
  applyPreviewCap,
  isUpgradePromptEnabled,
  parseGrantsSearchParams,
  type GrantResult,
} from "~/lib/grants";
import { GrantsUpstreamError, enrichGrants, searchGrantsUpstream } from "~/lib/grants.server";
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
 *   status           `open` (default: posted|forecasted) | `closed`
 *   page             1..MAX_PAGE (5) — the "Load more" cursor, 10 results/page
 *
 * ACCESS MODEL (owner spec):
 *   - anonymous: ONE search (server-authoritative, see grants-limits.server.ts)
 *     returning at most PREVIEW_LIMIT (3) cards + the total count so the page can
 *     say how many are behind the wall. A second search answers 200 with
 *     `requiresAuth: true` — the signup wall, not an error.
 *   - signed in   : full pages, "Load more" up to MAX_PAGE.
 *   - the $19/month prompt is gated by GRANTS_UPGRADE_PROMPT_ENABLED (default
 *     OFF) and only ever echoed to the page as a boolean — no Stripe product,
 *     price, link, or subscription code path is touched by this feature.
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
  authenticated: boolean;
  requiresAuth?: boolean;
  message?: string;
  totalCount: number;
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
  authenticated: boolean;
  results: GrantResult[];
  totalCount: number;
  page: number;
  requiresAuth?: boolean;
  message?: string;
  upgradePromptEnabled: boolean;
}): GrantsSearchPayload {
  const results = opts.authenticated
    ? opts.results
    : applyPreviewCap(opts.results, false); // belt + braces: the cap is applied here, not by callers
  const returned = results.length;
  const totalCount = opts.totalCount;
  // "Load more" is an authenticated affordance only: an anonymous visitor gets
  // the preview + the signup wall instead of another page of results.
  const hasMore =
    opts.authenticated &&
    !opts.requiresAuth &&
    totalCount > opts.page * PAGE_SIZE &&
    opts.page < MAX_PAGE;
  return {
    ok: true,
    source: GRANTS_SOURCE_LABEL,
    authenticated: opts.authenticated,
    ...(opts.requiresAuth ? { requiresAuth: true } : {}),
    ...(opts.message ? { message: opts.message } : {}),
    totalCount,
    page: opts.page,
    pageSize: PAGE_SIZE,
    maxPage: MAX_PAGE,
    hasMore,
    lockedCount: Math.max(0, totalCount - returned),
    previewLimit: opts.authenticated ? PAGE_SIZE : PREVIEW_LIMIT,
    upgradePromptEnabled: opts.upgradePromptEnabled,
    upgradePrice: GRANTS_PRICE_LABEL,
    notice: GRANTS_ORG_NOTICE,
    results,
  };
}

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

  // Layer 3: per-IP backstop for every request.
  const ipLimit = await checkGrantsIpLimit(request);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);

  let countsAgainstAnonymousCredit = false;
  if (authenticated) {
    const userLimit = await checkGrantsUserLimit(user.id);
    if (!userLimit.allowed) return rateLimitedResponse(userLimit);
  } else {
    // Layer 2: anonymous IP backstop (cookie-clearing abuse).
    const anonIpLimit = await checkGrantsAnonIpLimit(request);
    if (!anonIpLimit.allowed) return rateLimitedResponse(anonIpLimit);
    // Layer 1: the single free search.
    const anon = await consumeAnonymousSearch(request);
    if (!anon.allowed) {
      return json(
        buildPayload({
          authenticated: false,
          results: [],
          totalCount: 0,
          page: 1,
          requiresAuth: true,
          message:
            "You've used your free grant search. Create a free account to keep searching Grants.gov — it's free.",
          upgradePromptEnabled,
        }),
      );
    }
    countsAgainstAnonymousCredit = true;
  }

  // Cap the upstream rows we ask for: an anonymous preview needs only 3 cards.
  const detailLimit = authenticated ? PAGE_SIZE : PREVIEW_LIMIT;

  try {
    const { hits, totalCount } = await searchGrantsUpstream(params);
    const enriched = await enrichGrants(hits, detailLimit);
    return json(
      buildPayload({
        authenticated,
        results: enriched,
        totalCount,
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
