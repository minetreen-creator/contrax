/**
 * Public edge-cache policy tests (bun test — deterministic, zero network).
 *
 * Regression guard for root cause R1 (`shared/signout-diagnosis-2026-09-21.md`):
 * `/` was shared-cached for 1h while its SSR render read the session, so a
 * signed-in visitor was served the cached signed-out navbar ("it keeps signing
 * me out"). Since owner 2026-10-02 the landing render is session-free (the
 * navbar resolves the viewer client-side), so `/` is cacheable again. The
 * precondition is locked below: the landing loader must not read the session
 * and the navbar must get no server-resolved user.
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

describe("ssr-cache-policy: the front door is cached now that it is session-free", () => {
  test('"/" is cacheable on GET, through normalization', () => {
    for (const p of ["/", "", "/?utm_source=x", "/?fbclid=1"]) {
      expect(isPublicSsrCacheable("GET", p)).toBe(true);
    }
    expect(PUBLIC_SSR_CACHEABLE_EXACT_PATHS).toContain("/");
  });
});

describe("ssr-cache-policy: session-dependent routes are never cached", () => {
  const sessionRoutes = [
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
    }
  });

  test("method casing does not matter (lowercase 'get' still caches)", () => {
    expect(isPublicSsrCacheable("get", "/map")).toBe(true);
  });
});

describe("ssr-cache-policy: `/` stays session-free (source guard for R1)", () => {
  test("the landing loader reads no session and the navbar gets no server user", () => {
    const landing = readRepoFile("src/routes/index.tsx");
    expect(landing).not.toContain("getCurrentUser");
    expect(landing).not.toContain("getUserFromRequest");
    expect(landing).not.toMatch(/<Navbar\s+user=/);
    expect(landing).not.toMatch(/<SiteHeader\s+user=/);
    expect(landing).toContain("return <SiteHeader />;");
  });

  test("the launcher delegates to this policy instead of re-inlining a `/` rule", () => {
    const launcher = readRepoFile("vercel-entry.ts");
    expect(launcher).toContain("isPublicSsrCacheable(");
    // The old inline predicate: a `/`-matches-root rule re-inlined in the
    // launcher would silently reintroduce R1.
    expect(launcher).not.toContain('url.pathname === "/"');
  });
});

describe("FAR/DFARS clause library is edge-cached (owner 2026-10-02)", () => {
  test("/clauses and clause/part pages are cacheable on GET only", () => {
    expect(isPublicSsrCacheable("GET", "/clauses")).toBe(true);
    expect(isPublicSsrCacheable("GET", "/clauses/52.219-14")).toBe(true);
    expect(isPublicSsrCacheable("GET", "/clauses/15.407-5")).toBe(true);
    expect(isPublicSsrCacheable("GET", "/clauses/252.204-7012")).toBe(true);
    expect(isPublicSsrCacheable("POST", "/clauses/52.219-14")).toBe(false);
    expect(isPublicSsrCacheable("GET", "/clauses/52.219-14/extra")).toBe(false);
  });

  test("the clause routes read no session at SSR time", () => {
    for (const f of ["index.tsx", "$clauseNumber.tsx"]) {
      const src = readFileSync(join(import.meta.dir, "..", "routes", "clauses", f), "utf8");
      expect(src).not.toContain("getCurrentUser");
      expect(src).not.toContain("getUserFromRequest");
    }
  });
});
