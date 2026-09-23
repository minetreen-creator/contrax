/**
 * Public edge-cache policy for the Vercel launcher (`vercel-entry.ts`).
 *
 * ── The invariant ────────────────────────────────────────────────────────────
 * A route may be given the shared 1-hour edge cache (`PUBLIC_SSR_CACHE_CONTROL`)
 * ONLY when its server-rendered HTML is byte-identical for every visitor,
 * authenticated or not. The CDN cache key is the URL alone — no `Vary: Cookie`
 * is emitted — so whichever variant is rendered first is served to *everybody*
 * for the TTL.
 *
 * ── Why this module exists (root cause R1, 2026-09-21) ───────────────────────
 * `/` used to be in that cached set while its SSR render IS session-dependent:
 * the landing loader (`src/routes/index.tsx` → `getLandingData()`) awaits
 * `getCurrentUser()` and renders `<Navbar user={user} />`, which shows
 * "Sign out" + Dashboard when a session resolves and "Sign In" when it does
 * not. A signed-in visitor was therefore served the cached *signed-out* front
 * door — and, inversely, an anonymous visitor could be served the cached
 * *signed-in* navbar. The owner experienced this as "it keeps signing me out";
 * the session was never lost, the cached HTML was simply wrong.
 * Evidence: `shared/signout-diagnosis-2026-09-21.md` + `shared/signout-evidence/`.
 *
 * `/` is NO LONGER cacheable (owner-approved fix F1). Re-adding it is only
 * correct once the navbar stops depending on the request's session at
 * server-render time (e.g. it resolves auth client-side after hydration, so the
 * cached HTML is genuinely user-agnostic). `ssr-cache-policy.test.ts` locks both
 * halves of that reasoning: `/` is not cacheable, and the landing loader still
 * reads the session.
 *
 * ── The routes that remain cached ────────────────────────────────────────────
 * Cookie-agnostic marketing/SEO surfaces. Audited 2026-09-21: the map, industry
 * hub, hvac hub, the six cert hubs and the per-state landing pages contain no
 * `getCurrentUser` read at all; `/radar`'s few reads live inside its on-demand
 * scan server function (a JSON endpoint), not in its SSR render.
 */

/**
 * Exact pathnames (no trailing slash) that may carry the shared public edge
 * cache. Deliberately an explicit list — NOT a wildcard — so adding a route
 * here is a visible, reviewable decision.
 */
export const PUBLIC_SSR_CACHEABLE_EXACT_PATHS: readonly string[] = [
  "/map",
  "/radar",
  "/contracts-by-industry",
  "/contracts-hvac-mechanical",
];

/** Certification hub landing pages: `/<cert>-contracts`. */
const CERT_HUB_PATTERN = /^\/(?:8a|hubzone|sdvosb|set-aside|small-business|wosb)-contracts$/;

/** Per-state landing pages: `/contracts-in/<state-slug>`. */
const STATE_LANDING_PATTERN = /^\/contracts-in\/[a-z0-9-]+$/;

/** Collapse a query string and a single trailing slash before matching. */
function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  let path = pathname;
  const q = path.indexOf("?");
  if (q >= 0) path = path.slice(0, q);
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/**
 * Should this request's SSR response be stamped with the shared public edge
 * cache header? True only for GET on a reviewed, session-free route.
 *
 * Returns `false` for `/` unconditionally — see the R1 note above.
 */
export function isPublicSsrCacheable(method: string, pathname: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  const path = normalizePathname(pathname);
  // ── The front door is NEVER shared-cached (R1). It renders the session-
  //    dependent navbar, so a cached copy signs people out visually. ──────────
  if (path === "/") return false;
  if (PUBLIC_SSR_CACHEABLE_EXACT_PATHS.includes(path)) return true;
  if (CERT_HUB_PATTERN.test(path)) return true;
  if (STATE_LANDING_PATTERN.test(path)) return true;
  return false;
}
