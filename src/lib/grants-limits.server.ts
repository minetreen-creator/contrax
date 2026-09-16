/**
 * Contrax Grants — rate limiting policy (server-only, owner order 2026-09-16).
 *
 * Reuses the app's existing DB-backed fixed-window limiter
 * (src/lib/rate-limit.ts → Neon `rate_limits` table, fail-open on any DB error).
 * No new infrastructure, no in-memory state (which would be per-instance and
 * useless on Vercel serverless).
 *
 * DOCUMENTED POLICY — three layers, each with its own scope:
 *
 *   1. ANONYMOUS FREE SEARCH (the owner's "one search" cap):
 *      scope `grants_search_anon`, key `v:<contrax_vid>` (the persistent
 *      first-party visitor id; falls back to `ip:<client ip>` when the cookie is
 *      absent/blocked), limit 1 per 86,400s. When it is used up the API answers
 *      200 with `requiresAuth: true` — a "create a free account to keep
 *      searching" wall, NOT an error.
 *      REFUND: because the counter is consumed before the upstream call is
 *      known to succeed, a FAILED upstream search refunds the credit
 *      (refundAnonymousSearch) so a Grants.gov outage can never burn a visitor's
 *      one free search. Best-effort and fail-open.
 *
 *   2. ANONYMOUS IP BACKSTOP: scope `grants_search_anon_ip`, key `ip:<ip>`,
 *      limit 10 per 86,400s — stops cookie-clearing abuse of layer 1 without
 *      punishing a single shared-NAT visitor. Exceeding it is a 429.
 *
 *   3. PER-REQUEST BACKSTOPS: every request (anonymous or signed in) is capped
 *      at 60/hour per IP (scope `grants_search_ip`); a signed-in user is
 *      additionally capped at 120/hour per account (scope `grants_search_user`,
 *      key `u:<user id>`) so a logged-in scrape cannot amplify through the
 *      upstream API. Exceeding either is a 429.
 */
import { sql } from "~/db";
import {
  checkIpLimit,
  checkRateLimit,
  type RateLimitResult,
} from "~/lib/rate-limit";
import { parseCookies } from "~/lib/api-auth";
import { getClientIp } from "~/lib/request-ip";
import { VISITOR_COOKIE_NAME } from "~/lib/visitor";

export const ANON_SCOPE = "grants_search_anon";
export const ANON_LIMIT = 1;
export const ANON_WINDOW_SEC = 86_400;

export const ANON_IP_SCOPE = "grants_search_anon_ip";
export const ANON_IP_LIMIT = 10;
export const ANON_IP_WINDOW_SEC = 86_400;

export const IP_SCOPE = "grants_search_ip";
export const IP_LIMIT = 60;
export const IP_WINDOW_SEC = 3_600;

export const USER_SCOPE = "grants_search_user";
export const USER_LIMIT = 120;
export const USER_WINDOW_SEC = 3_600;

/** The key the anonymous free-search credit is tracked under for this request. */
export function anonymousSearchKey(request: Request): string {
  const cookie = parseCookies(request)[VISITOR_COOKIE_NAME];
  if (cookie && /^[A-Za-z0-9-]{8,64}$/.test(cookie)) return `v:${cookie}`;
  const ip = getClientIp(request);
  return `ip:${ip ?? "unknown"}`;
}

/** Layer 3 (per-IP backstop). Applies to every grants search request. */
export function checkGrantsIpLimit(request: Request): Promise<RateLimitResult> {
  return checkIpLimit(request, IP_SCOPE, IP_LIMIT, IP_WINDOW_SEC);
}

/** Layer 3 (per-account backstop) for a signed-in visitor. */
export function checkGrantsUserLimit(userId: number): Promise<RateLimitResult> {
  return checkRateLimit({
    scope: USER_SCOPE,
    key: `u:${userId}`,
    limit: USER_LIMIT,
    windowSec: USER_WINDOW_SEC,
  });
}

/** Layer 2 (anonymous IP backstop). */
export function checkGrantsAnonIpLimit(request: Request): Promise<RateLimitResult> {
  return checkIpLimit(request, ANON_IP_SCOPE, ANON_IP_LIMIT, ANON_IP_WINDOW_SEC);
}

/**
 * Layer 1: consumes the anonymous visitor's single free search. Increments
 * before the upstream call (so parallel tab-spam cannot slip past), which is why
 * a failure refunds it.
 */
export function consumeAnonymousSearch(request: Request): Promise<RateLimitResult> {
  return checkRateLimit({
    scope: ANON_SCOPE,
    key: anonymousSearchKey(request),
    limit: ANON_LIMIT,
    windowSec: ANON_WINDOW_SEC,
  });
}

/**
 * Gives back the anonymous free-search credit after an upstream failure.
 * Deliberately narrow: one row, one window, best-effort, never throws, and only
 * ever decrements (GREATEST(0, ...)) — a limiter hiccup must not lock anyone out.
 */
export async function refundAnonymousSearch(request: Request): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / ANON_WINDOW_SEC) * ANON_WINDOW_SEC;
    const key = anonymousSearchKey(request);
    await sql()`
      UPDATE rate_limits SET count = GREATEST(0, count - 1)
      WHERE scope = ${ANON_SCOPE} AND key = ${key} AND window_start = ${windowStart}
    `;
  } catch (e) {
    console.error("[grants] anonymous credit refund failed (non-fatal):", e);
  }
}
