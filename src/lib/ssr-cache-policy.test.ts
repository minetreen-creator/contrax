/**
 * Public edge-cache policy tests (bun test — deterministic, zero network).
 *
 * Regression guard for root cause R1 (`shared/signout-diagnosis-2026-09-21.md`):
 * `/` was shared-cached for 1h while its SSR render reads the session, so a
 * signed-in visitor was served the cached signed-out navbar ("it keeps signing
 * me out"). Two halves are locked here:
 *   A. `/` is not cacheable, and the other cookie-agnostic marketing routes
 *      still are (so the fix does not silently drop the cache everywhere);
 *   B. the landing loader still reads the session — i.e. the reason `/` must
 *      stay uncacheable is still true. If someone later makes the navbar
 *      client-resolved, half B fails loudly and forces a deliberate re-review of
 *      the policy instead of a silent re-add.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isPublicSsrCacheable,
  PUBLIC_SSR_CACHEABLE_EXACT_PATHS,
} from "./ssr-cache-policy";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const readRepoFile = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

describe("ssr-cache-policy: the front door is never shared-cached (R1)", () => {
  test('"/" is not cacheable', () => {
    expect(isPublicSsrCacheable("GET", "/")).toBe(false);
  });

  test('"/" stays uncacheable through normalization (empty, trailing slash, query)', () => {
    for (const p of ["", "//", "/?utm_source=x", "/?fbclid=1"]) {
      expect(isPublicSsrCacheable("GET", p)).toBe(false);
    }
  });

  test("no cached route pattern can ever match the root", () => {
    expect(PUBLIC_SSR_CACHEABLE_EXACT_PATHS).not.toContain("/");
    expect(PUBLIC_SSR_CACHEABLE_EXACT_PATHS.every((p) => p !== "/")).toBe(true);
  });
});

describe("ssr-cache-policy: session-dependent routes are never cached", () => {
  const sessionRoutes = [
    // the front door (renders <Navbar user={user} />)
    "/",
    // guarded app surfaces
    "/dashboard",
    "/onboarding",
    "/pipeline",
    "/settings",
    "/settings/integrations",
    "/tracking",
    "/alerts",
    "/learnings",
    "/partners",
    "/compliance",
    "/workspace",
    "/upgrade",
    "/welcome",
    "/copilot",
    "/competitors",
    "/evaluate",
    "/score",
    // auth surfaces
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/post-checkout",
    "/bid-scout/success",
    // admin + API
    "/admin/users",
    "/api/auth/me",
    "/api/dashboard-data",
  ];

  test("every session-reading page/API route returns false", () => {
    for (const p of sessionRoutes) {
      expect({ path: p, cacheable: isPublicSsrCacheable("GET", p) }).toEqual({
        path: p,
        cacheable: false,
      });
    }
  });
});

describe("ssr-cache-policy: cookie-agnostic marketing/SEO routes keep the cache", () => {
  const stillCached = [
    "/map",
    "/radar",
    "/contracts-by-industry",
    "/contracts-hvac-mechanical",
    "/8a-contracts",
    "/hubzone-contracts",
    "/sdvosb-contracts",
    "/set-aside-contracts",
    "/small-business-contracts",
    "/wosb-contracts",
    "/contracts-in/texas",
    "/contracts-in/new-york",
    "/contracts-in/district-of-columbia",
  ];

  test("all previously-cached non-`/` routes are still cacheable", () => {
    for (const p of stillCached) {
      expect({ path: p, cacheable: isPublicSsrCacheable("GET", p) }).toEqual({
        path: p,
        cacheable: true,
      });
    }
  });

  test("a single trailing slash normalizes to the same decision", () => {
    for (const p of stillCached) {
      expect(isPublicSsrCacheable("GET", `${p}/`)).toBe(true);
    }
  });

  test("unknown / look-alike paths are NOT cacheable (explicit allowlist, not a wildcard)", () => {
    const mustNotCache = [
      "/contracts-in", // no state slug
      "/contracts-in/", // no state slug
      "/contracts-in/TEXAS", // uppercase slug never matches
      "/contracts-in/texas/extra", // deeper segment
      "/8a-contract", // singular typo
      "/map/state", // deeper segment
      "/contracts-by-industry/foo",
      "/radar/scan",
      "/grants",
      "/state-grants",
      "/pricing",
      "/random-not-a-page",
    ];
    for (const p of mustNotCache) {
      expect({ path: p, cacheable: isPublicSsrCacheable("GET", p) }).toEqual({
        path: p,
        cacheable: false,
      });
    }
  });
});

describe("ssr-cache-policy: only GET is cacheable", () => {
  test("non-GET methods are never cached, even on a cacheable path", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(isPublicSsrCacheable(method, "/map")).toBe(false);
      expect(isPublicSsrCacheable(method, "/")).toBe(false);
    }
  });

  test("method casing does not matter (lowercase 'get' still caches)", () => {
    expect(isPublicSsrCacheable("get", "/map")).toBe(true);
  });
});

describe("ssr-cache-policy: the reason `/` is uncacheable is still true (source guard)", () => {
  test("the landing loader still resolves the session and feeds the navbar", () => {
    const landing = readRepoFile("src/routes/index.tsx");
    expect(landing).toContain("getCurrentUser()");
    expect(landing).toMatch(/<Navbar\s+user=\{user\}/);
  });

  test("the launcher delegates to this policy instead of re-inlining a `/` rule", () => {
    const launcher = readRepoFile("vercel-entry.ts");
    expect(launcher).toContain("isPublicSsrCacheable(");
    // The old inline predicate: a `/`-matches-root rule re-inlined in the
    // launcher would silently reintroduce R1.
    expect(launcher).not.toContain('url.pathname === "/"');
  });
});
