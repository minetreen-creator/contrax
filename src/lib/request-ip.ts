/**
 * Client-IP resolution + single-IP block guard for the auth/signup endpoints.
 *
 * `getClientIp` mirrors the exact resolution order used by the analytics routes
 * (src/routes/api/event.ts, src/routes/api/page-view.ts): read `x-forwarded-for`
 * first value, then `cf-connecting-ip`, then `x-real-ip`. Extracted here so the
 * guarded auth endpoints share one DRY implementation.
 *
 * `isBlockedIp` is an exact-match guard (NOT a range): it returns true only when
 * the resolved client IP equals an entry in `BLOCKED_IPS`. Kept as a small
 * exported array so future IPs are trivial to add and it can be unit-tested.
 *
 * This module is pure (no node builtins, no DB, no env), so it is safe both on
 * the server and when imported from client-bundled route files.
 */
export const BLOCKED_IPS: string[] = ["5.175.149.80"];

/**
 * Resolves the client IP from a Request using the same proxy header order as
 * the analytics routes: x-forwarded-for (first entry) → cf-connecting-ip →
 * x-real-ip. Returns null when no header is present.
 */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  return ip ? ip.slice(0, 64) : null;
}

/**
 * Returns true when the resolved client IP is on the exact-match blocklist.
 * A missing/unresolvable IP is never blocked (fail-open on unknown, so real
 * users behind misconfigured proxies are not locked out).
 */
export function isBlockedIp(request: Request): boolean {
  const ip = getClientIp(request);
  if (!ip) return false;
  return BLOCKED_IPS.includes(ip);
}
