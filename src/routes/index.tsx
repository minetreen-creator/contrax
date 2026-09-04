import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Menu, X } from "lucide-react";

import { getCurrentUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { getLiveOpportunities } from "~/lib/live-opportunities";
import { keywordPred } from "~/lib/open-bids";
import {
  buildContractMap,
  formatCompactMoney,
  STATE_NAMES,
  type ContractMapAggregate,
  type StateAggregate,
} from "~/lib/contract-map";
import { US_MAP_VIEWBOX, US_STATE_PATHS } from "~/lib/us-states-map";
// Real cached example AI Executive Brief — code-split so it never bloats
// the homepage main bundle or blocks hero render. Same component + same
// server fn as the standalone /example-brief page (single source of truth).
const ExampleBrief = lazy(() => import("~/components/ExampleBrief"));
// Live set-aside opportunities strip — server-rendered section (real bids rows
// via ~/lib/live-opportunities.ts). Imported as a plain function: it renders
// with the loader data (SSR and hydration), so no lazy/suspense needed.
import { LiveOpportunities } from "~/components/LiveOpportunities";
import { HeroRadar } from "~/components/HeroRadar";
import { getRadarAnswers } from "~/lib/radar-session";

// ── Types ─────────────────────────────────────────────────────────────────────
type Bid = {
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  location: string | null;
  created_at?: string | null;
  category?: string | null;
  description?: string | null;
};
type TodayBid = {
  title: string;
  agency: string;
  set_aside: string | null;
  location: string | null;
  due_date: string | null;
  created_at?: string | null;
};

// ── Server Functions ──────────────────────────────────────────────────────────

// Live Opportunities data — deduped at the SQL layer so a genuine duplicate
// row (same solicitation ingested by multiple state-keyword sync sources, e.g.
// `va` and `va_evirginia`) can NEVER surface as an adjacent twin card in the
// grid. DISTINCT ON (title, agency) keeps the most recently ingested row per
// solicitation, then orders the whole distinct set newest-first. The ingest
// guard in src/jobs/runner.ts prevents new duplicates from being written.
const getRecentBids = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data?: { q?: string } }) => {
    const q = data?.q?.trim() ?? "";
    const { sql } = await import("~/db");
    // naics_code is a migration-created column (migrations 007 + 012, and
    // src/db/schema.sql) present in prod, so keywordPred can reference it
    // directly — the old per-render `ALTER TABLE bids ADD COLUMN IF NOT EXISTS
    // naics_code` DDL (a DB write on every search render) is removed.
    const pred = keywordPred(q, sql);
    // Single round-trip: the deduped rows AND the honest post-filter, post-dedup
    // total backing this feed, folded in via COUNT(*) OVER(). The window is
    // computed over the full deduped set BEFORE the outer LIMIT truncates it, so
    // the count is identical to the former separate COUNT(*) query. When zero
    // rows match, rows[0] is undefined -> count 0, exactly like the old query.
    const rows = await sql()`
      SELECT title, agency, estimated_value, due_date, location, set_aside, created_at,
             COUNT(*) OVER()::int AS count
      FROM (
        SELECT DISTINCT ON (title, agency)
               title, agency, estimated_value, due_date, location, set_aside, created_at
        FROM bids
        WHERE ${sql().unsafe(LOW_CONTENT_SQL)} AND due_date > NOW() ${pred}
        ORDER BY title, agency, created_at DESC NULLS LAST
      ) t
      ORDER BY t.created_at DESC NULLS LAST
      LIMIT ${q ? 200 : 60}
    `;
    return { bids: rows as Bid[], count: Number((rows[0] as any)?.count || 0) };
  }
);
const getTodayBids = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data?: { q?: string } }) => {
    const q = data?.q?.trim() ?? "";
    const { sql } = await import("~/db");
    // Same naics_code guarantee as getRecentBids — no per-render ALTER here.
    const pred = keywordPred(q, sql);
    // Public teaser: titles only — no source URLs or descriptions for
    // unauthenticated visitors. Full detail lives behind the signup wall.
    // Single round-trip: rows + distinct count via COUNT(*) OVER(), computed
    // over the full deduped set before the outer LIMIT (identical to the old
    // separate COUNT query; zero rows -> count 0).
    const rows = await sql()`
      SELECT title, agency, set_aside, location, due_date, created_at,
             COUNT(*) OVER()::int AS count
      FROM (
        SELECT DISTINCT ON (title, agency)
               title, agency, set_aside, location, due_date, created_at
        FROM bids
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND due_date > NOW()
          AND ${sql().unsafe(LOW_CONTENT_SQL)} ${pred}
        ORDER BY title, agency, created_at DESC NULLS LAST
      ) t
      ORDER BY t.created_at DESC NULLS LAST
      LIMIT ${q ? 100 : 10}
    `;
    return {
      bids: rows as TodayBid[],
      count: Number((rows[0] as any)?.count || 0),
    };
  }
);

// ── U.S. Contract Map — homepage aggregate ────────────────────────────────────
// Reuses the exact same server aggregation as /map (buildContractMap over the
// open-bid population with the shared low-content filter), so the homepage map
// and its live counter are backed by the SAME real numbers as the full page --
// never a separate or fabricated figure. State attribution + stated-value
// honesty rules are enforced inside buildContractMap (see lib/contract-map.ts).
const getContractMapAggregate = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContractMapAggregate> => {
    const { sql } = await import("~/db");
    const rows = await sql()`
      SELECT location, set_aside, estimated_value, agency, category, due_date
      FROM bids
      WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
    `;
    return buildContractMap(rows as any);
  },
);


// Honest "Tracking N active solicitations across M agencies" hero stat.
// N = number of DISTINCT active (due_date > now()) solicitations deduped on
// the natural key (title, agency) — NOT the raw COUNT(*) which is inflated by
// the ~11k duplicate rows ingested when multiple state-keyword sync sources
// return the same national solicitation (20,809 raw rows vs 9,646 distinct,
// and only 5,057 distinct ACTIVE as of 2026-08-18). Never report an inflated
// or fabricated figure.
const getBidStats = async (): Promise<{ activeCount: number; agencyCount: number }> => {
  try {
    const { sql } = await import("~/db");
    const [bids, agencies] = await Promise.all([
      sql()`SELECT COUNT(*)::int AS count FROM (SELECT DISTINCT title, agency FROM bids WHERE due_date > NOW()) d`,
      sql()`SELECT COUNT(DISTINCT agency)::int AS count FROM bids WHERE due_date > NOW()`,
    ]);
    return {
      activeCount: Number((bids[0] as any)?.count || 0),
      agencyCount: Number((agencies[0] as any)?.count || 0),
    };
  } catch {
    // bids table may not exist yet — hide the stat row entirely
    return { activeCount: 0, agencyCount: 0 };
  }
};

const getLandingData = createServerFn({ method: "GET" }).handler(async ({ data }: { data?: { q?: string } }) => {
  const q = data?.q?.trim() ?? "";
  const { sql } = await import("~/db");
  const [businessName, user, recentBids, todayBids, bidStats, contractMap, liveOpportunities] = await Promise.all([
    (async () => {
      try {
        const cfg = JSON.parse(await readFile("site.json", "utf8")) as {
          businessName?: string;
        };
        return cfg.businessName?.trim() ?? "Contrax";
      } catch {
        return "Contrax";
      }
    })(),
    getCurrentUser(),
    getRecentBids({ data: { q } }),
    getTodayBids({ data: { q } }),
    getBidStats(),
    getContractMapAggregate(),
    getLiveOpportunities(),
  ]);
  const { bids, count: openCount } = recentBids;
  let alertCount = 0;
  if (user) {
    try {
      await sql()`CREATE TABLE IF NOT EXISTS bid_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bid_id INTEGER NOT NULL REFERENCES bids(id), alert_type TEXT DEFAULT 'new_match', is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id, alert_type))`;
      const rows = await sql()`SELECT COUNT(*)::int AS count FROM bid_alerts WHERE user_id=${user.id} AND is_read=false`;
      alertCount = Number((rows[0] as any)?.count || 0);
    } catch { /* table or query failed — safe to return 0 */ }
  }
  return { businessName, user, bids, alertCount, bidStats, todayBids, contractMap, openCount, liveOpportunities, q };
});

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  // q must be a STRING even when the URL value is all-digits. TanStack's default
  // search parser JSON/coerces `?q=238220` into the NUMBER 238220; the old
  // `typeof search.q === "string"` guard then dropped it silently (NAICS query
  // vanished -> feed stayed unfiltered and the URL was rewritten to /?qa=...).
  // Accept string OR number and coerce to a canonical string so a NAICS/trade
  // query is honored like any other keyword.
  validateSearch: (search: Record<string, unknown>) => ({
    q:
      typeof search.q === "string" || typeof search.q === "number"
        ? String(search.q)
        : undefined,
  }),
  // CRITICAL for client-side navigation: without loaderDeps the route match is
  // keyed ONLY on the pathname (matchId = route.id + path + loaderDepsHash, where
  // loaderDepsHash is "" when no loaderDeps is declared - see router.js
  // matchRoutes()). So the hero submit (navigate({ search: { q } }), / -> /?q=HVAC)
  // produced the SAME matchId -> the router reused the existing match's cached
  // "/" loader data and did NOT re-run the loader -> the feed stayed unfiltered
  // ("Showing 12 of 8018") even though the URL + hash updated (the 26KB
  // RSC-then-noop nav QA saw). Declaring loaderDeps folds q into the matchId
  // hash, so any q change creates a NEW match and the loader re-runs with the
  // new deps on the client too.
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps, location }) => {
    // Prefer deps (the validated search, always a string for both SSR first-load
    // and client transitions; wired from route.match.loaderDeps in load-matches).
    // Fall back to location.search for robustness and coerce numbers to strings
    // in case a value arrives as a raw number (e.g. NAICS). The old `context`
    // read is intentionally NOT used - verified on main that SSR hands the
    // loader `location` as a top-level arg and an EMPTY context.
    const depsQ = typeof deps?.q === "string" ? deps.q : "";
    const locSearch = (location?.search ?? {}) as { q?: unknown };
    const rawQ = depsQ || (locSearch.q == null ? "" : String(locSearch.q));
    return getLandingData({ data: { q: rawQ } });
  },
  component: Home,
  head: () => ({
    meta: [
      { title: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
      {
        name: "description",
        content:
          "Don't know which set-asides your 8(a), SDVOSB, WOSB, or HUBZone certification qualifies you for? Contrax matches you to live federal, state, and city solicitations and extracts the requirements, deadlines, and red flags — so you never miss a set-aside or waste a proposal.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company" },
      { property: "og:title", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
      {
        property: "og:description",
        content:
          "Don't know which set-asides your 8(a), SDVOSB, WOSB, or HUBZone certification qualifies you for? Contrax matches you to live federal, state, and city solicitations and extracts the requirements, deadlines, and red flags — so you never miss a set-aside or waste a proposal.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
      {
        name: "twitter:description",
        content:
          "Don't know which set-asides your 8(a), SDVOSB, WOSB, or HUBZone certification qualifies you for? Contrax matches you to live federal, state, and city solicitations and extracts the requirements, deadlines, and red flags — so you never miss a set-aside or waste a proposal.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company" }],
  }),
});

// ── Official Partnership Announcement (Veterans Against Diabetes) ──────────────
// Static, self-contained announcement band rendered at the very top of the
// homepage (above the Navbar). Pure presentational copy — no buttons, no
// checkout wiring, no pricing/gating changes. Rendered as part of the Home
// component tree so it is included in the server-rendered HTML on first load.
function PartnershipBanner() {
  return (
    <section className="border-b border-amber-500/20 bg-slate-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2.5 text-center sm:px-6">
        <p className="text-xs font-medium leading-snug text-slate-200 sm:text-sm">
          <span className="font-bold text-amber-300">Official Partnership:</span>{" "}
          Veterans Against Diabetes members get ~25% off paid plans for their first
          12 months —{" "}
          <a
            href="/vad"
            className="font-semibold text-amber-300 underline decoration-amber-400/40 underline-offset-2 transition-colors hover:text-amber-200"
          >
            Learn more →
          </a>
        </p>
      </div>
    </section>
  );
}

// ── Page Component ────────────────────────────────────────────────────────────

function Home() {

  const { user, bids, alertCount, bidStats, todayBids, contractMap, liveOpportunities, q } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    description:
      "Tell Contrax what your business does. Radar finds government opportunities that match — live set-asides for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses, with bid documents explained and proposals drafted so certified firms can compete and win.",
    url: "https://www.contrax.company",
    logo: "https://www.contrax.company/logo-square.png",
    email: "hello@contrax.company",
  };

  // Single selection source of truth for the "I am a:" Personalization Hook.
  // Shared by the top-of-page selector (stat + CTA) and the Live Award Feed
  // chip row (feed filter) — one state, two mirrored controls.
  const [certId, setCertId] = useState("all");
  const selectCert = (id: string) => {
    if (id === certId) return; // already active — no event, no refetch
    trackEvent("feed_filter_click", id); // fire-and-forget, never blocks UI
    setCertId(id);
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PartnershipBanner />
      <Navbar user={user} alertCount={alertCount} />
      <Hero bidStats={bidStats} openOppCount={contractMap.totals.totalOpen} cert={certId} q={q || ""} onSelectCert={selectCert} />
      {/* Contract Radar match-finder — embedded in the homepage hero region
          (owner-directed 2026-09-04): the same interactive walk (trade/state/
          cert/size → real scan, first-3-free, full incumbent intel, gate at
          match 4, save-your-matches lead capture) as /radar. */}
      <HeroRadar initialCert={certId} />
      {/* U.S. Contract Map — directly under the radar finder (owner direction
          2026-09-04): same real SAM.gov + state & city solicitations aggregate,
          repositioned straight after the match-finder. */}
      <OpportunityMap aggregate={contractMap} />
      {/* Live set-aside opportunities — right under the map; real bids table
          rows wired to the AI Executive Brief flow. Vanishes entirely when
          there are zero open bids (undefined-safe empty guard). */}
      <LiveOpportunities bids={liveOpportunities} />
      {/* Real example AI Executive Brief — real bids, summarized. */}
      <Suspense fallback={null}>
        <ExampleBrief variant="embed" />
      </Suspense>
      <HowItWorks />
      <ProductShowcase />
      <Pricing />
      <OpenOpportunities bids={bids} todayBids={todayBids} openCount={contractMap.totals.totalOpen} q={q || ""} user={user} />
      <WaitlistSection />
      <Footer />
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar({ user, alertCount }: { user: { id: number; email: string } | null; alertCount: number }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    window.location.href = "/";
  };
  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center" aria-label="Contrax home">
          <img src="/logo.png" alt="Contrax" className="h-9 w-auto" />
        </a>

        <a
          href="https://www.facebook.com/profile.php?id=61593835047770"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
          aria-label="Contrax on Facebook"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22 12.06C22 6.51 17.52 2 12 2S2 6.51 2 12.06c0 5.01 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.78-3.91 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33V22c4.78-.76 8.44-4.93 8.44-9.94z"/>
          </svg>
          Facebook
        </a>

        {/* Desktop nav — unchanged, hidden below lg */}
        <div className="hidden items-center gap-3 lg:flex">
          {user ? (
            <>
              <a href="/competitors" className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900">Competitors</a>
              <a href="/evaluate" className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900">🔴 Red Team</a>
              <a href="/alerts" aria-label="Bid alerts" className="relative inline-flex items-center rounded-lg px-3 py-2 text-lg text-gray-600 hover:text-gray-900">🔔{alertCount > 0 && <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{alertCount}</span>}</a>
              <a
                href="/dashboard"
                className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800"
              >
                Dashboard
              </a>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
              >
                {loggingOut ? "Signing out..." : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <a
                href="/pricing"
                className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900"
              >
                Pricing
              </a>
              <a
                href="/example-brief"
                className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900"
              >
                Example Brief
              </a>
              <a
                href="/demo"
                className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900"
              >
                Request a demo
              </a>
              <a
                href="/login"
                className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
              >
                Sign In
              </a>
              <a
                href="/signup"
                onClick={() => trackEvent("hero_cta_click", "nav")}
                className="inline-flex items-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 hover:shadow-md"
              >
                Find Opportunities
              </a>
            </>
          )}
        </div>

        {/* Mobile hamburger — visible below lg */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="inline-flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 lg:hidden"
        >
          <span className="relative inline-flex h-5 w-5">
            <X
              className={`absolute inset-0 h-5 w-5 transition-all duration-300 ease-in-out ${
                menuOpen ? "rotate-0 opacity-100" : "rotate-90 opacity-0"
              }`}
            />
            <Menu
              className={`absolute inset-0 h-5 w-5 transition-all duration-300 ease-in-out ${
                menuOpen ? "-rotate-90 opacity-0" : "rotate-0 opacity-100"
              }`}
            />
          </span>
        </button>
      </div>

      {/* Mobile slide-down panel — same links as desktop */}
      <div
        id="mobile-nav"
        aria-hidden={!menuOpen}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out lg:hidden ${
          menuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden" inert={!menuOpen}>
          <div className="space-y-2 border-t border-gray-100 px-6 pb-6 pt-4">
            {user ? (
              <>
                <a href="/competitors" onClick={closeMenu} className="block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900">Competitors</a>
                <a href="/alerts" onClick={closeMenu} className="block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900">🔔 Bid alerts{alertCount > 0 ? ` (${alertCount})` : ""}</a>
                <a href="/evaluate" onClick={closeMenu} className="block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900">🔴 Red Team</a>
                <a
                  href="/dashboard"
                  onClick={closeMenu}
                  className="block w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800"
                >
                  Dashboard
                </a>
                <button
                  onClick={() => {
                    closeMenu();
                    handleLogout();
                  }}
                  disabled={loggingOut}
                  className="block w-full rounded-lg border border-gray-200 px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
                >
                  {loggingOut ? "Signing out..." : "Sign out"}
                </button>
              </>
            ) : (
              <>
                <a
                  href="/pricing"
                  onClick={closeMenu}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                >
                  Pricing
                </a>
                <a
                  href="/example-brief"
                  onClick={closeMenu}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                >
                  Example Brief
                </a>
                <a
                  href="/demo"
                  onClick={closeMenu}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                >
                  Request a demo
                </a>
                <a
                  href="/login"
                  onClick={closeMenu}
                  className="block w-full rounded-lg border border-gray-200 px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                >
                  Sign In
                </a>
                <a
                  href="/signup"
                  onClick={() => {
                    closeMenu();
                    trackEvent("hero_cta_click", "nav");
                  }}
                  className="block w-full rounded-lg bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 hover:shadow-md"
                >
                  Find Opportunities
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

// ── Certification chips for the hero "I am a:" selector ─────────────────────
const CERT_CHIPS = [
  { id: "all", label: "All set-asides", code: null as string | null },
  { id: "8a", label: "8(a)", code: "8A" },
  { id: "sdvosb", label: "SDVOSB", code: "SDVOSBC" },
  { id: "wosb", label: "WOSB", code: "WOSB" },
  { id: "hubzone", label: "HUBZone", code: "HZC" },
  { id: "sb", label: "Small Business", code: "SBA" },
];

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero({
  bidStats,
  openOppCount,
  cert,
  q,
  onSelectCert,
}: {
  bidStats: { activeCount: number; agencyCount: number };
  openOppCount: number;
  cert: string;
  q: string;
  onSelectCert: (id: string) => void;
}) {
  const navigate = useNavigate();
  // Keep the search box in sync with the URL's ?q= param: initialize it from q
  // on first paint (a fresh /?q=HVAC load shows "HVAC" in the box) and re-sync
  // whenever the route's q changes (hero submit navigation, or the clear-search
  // link dropping q). Typing mutates local tradeQ only, so it never fights this.
  const [tradeQ, setTradeQ] = useState(q || "");
  useEffect(() => {
    setTradeQ(q || "");
  }, [q]);
  // hero_search telemetry is submit-only: the input's onChange (below) only
  // mutates local state and never fires tracking, so typing can't emit a flood
  // of events. The dedupe ref additionally swallows a double-submit / rapid-
  // Enter repeat of the SAME query within 1.5s, so one real search records
  // exactly one event (a genuinely new search still fires).
  const lastSearchFired = useRef<{ key: string; at: number } | null>(null);
  // Instant "Trade / Keyword" search (owner-directed): typing a trade, NAICS, or
  // state once and pressing Enter lands on the keyword-filtered Open
  // Opportunities feed (/?q=...#open-opportunities), filtered server-side so the
  // SSR HTML carries the matches. The CTA always shows the REAL active
  // solicitation count (bidStats.activeCount) — never a fabricated figure.
  // "Explore Bids →" routes to Contract Radar, pre-filtered to the typed trade
  // and the selected certification, so the visitor lands straight on their
  // matching Radar cards (owner-directed). The radar route accepts `trade` and
  // `cert` search params; both are omitted when empty/"all" (radar then defaults
  // cert to sb). Homepage cert ids map 1:1 to radar's valid set except "all" --
  // only a real cert id is emitted.
  const handleTradeSearch = (e: FormEvent) => {
    e.preventDefault();
    const trade = tradeQ.trim();
    if (trade) {
      // Fire only on an actual submit (never per keystroke). Dedupes an
      // identical query re-submitted within 1.5s so a single search action
      // records exactly one event. Fire-and-forget, never blocks UI.
      const now = Date.now();
      const last = lastSearchFired.current;
      if (!last || last.key !== trade || now - last.at > 1500) {
        lastSearchFired.current = { key: trade, at: now };
        trackEvent("hero_search", trade);
      }
    }
    // Pass-through parity with /radar deep-link params (trade/state/cert/
    // size): the hero's persisted radar answers (localStorage, written by any
    // radar scan incl. the embedded hero finder) supply state + size when the
    // visitor has chosen them; trade + cert come from the hero controls. Size
    // is included only when it is a real size id (never a default invented
    // here) so /radar never receives a fabricated size preference.
    const RADAR_CERTS = ["8a", "sdvosb", "wosb", "hubzone", "sb"] as const;
    const search: Record<string, string> = {};
    if (trade) search.trade = trade;
    if (cert !== "all" && (RADAR_CERTS as readonly string[]).includes(cert)) {
      search.cert = cert;
    }
    // Whatever trade/state/cert/size inputs the hero exposes, state + size
    // flow through via the shared radar-answers store (same key + shape the
    // /radar walk and the embedded hero finder write) — never invented here.
    try {
      const saved = getRadarAnswers();
      const st = (saved?.state || "").trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(st)) search.state = st;
      const sz = (saved?.sizePref || "").trim();
      if (["under250k", "under1m", "under10m", "any"].includes(sz)) search.size = sz;
    } catch { /* storage unavailable — hero search still works without size */ }
    navigate({ to: "/radar", search });
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[url('data:image/png;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
      <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-12 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-1.5 text-center text-sm font-medium text-blue-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            ⚡ FOR 8(a) · SDVOSB · WOSB · HUBZONE CERTIFIED FIRMS
          </div>


          <h1 className="max-w-4xl text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-5xl">
            Find government contracts that actually fit your business.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-blue-100/80 sm:text-xl">
            Contrax matches your 8(a), SDVOSB, WOSB, or HUBZone certification to
            real federal, state, and city solicitations — then pulls out the
            requirements, key dates, and red flags. No more guessing which bids
            you qualify for, or digging through bloated PDFs.
          </p>

          {/* "I am a:" certification selector — reuses the shared cert state so
              picking a cert filters the Live Award Feed below (same chips/logic as
              the feed's own row). Fires the existing feed_filter_click event. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm font-semibold text-blue-200/80">I am a:</span>
            {CERT_CHIPS.filter((c) => c.id !== "all").map((chip) => {
              const isActive = cert === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => onSelectCert(chip.id)}
                  aria-pressed={isActive}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? "border-amber-400 bg-amber-400/20 text-amber-200"
                      : "border-white/15 bg-white/5 text-blue-100/80 hover:border-white/30 hover:text-white"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* Instant Trade / Keyword search — the hero's first call to action.
              Full-width on mobile, input + button row on desktop. */}
          <div className="mt-6">
            <form
              onSubmit={handleTradeSearch}
              action="/radar"
              method="get"
              role="search"
              aria-label="Search open solicitations by trade, NAICS, or state"
              className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-amber-400/25 bg-white/[0.06] p-4 shadow-xl shadow-black/20 backdrop-blur-md sm:flex-row sm:items-center sm:p-3"
            >
              <div className="flex flex-1 items-center gap-3 rounded-xl bg-white/95 px-4">
                <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  name="trade"
                  value={tradeQ}
                  onChange={(e) => setTradeQ(e.target.value)}
                  placeholder={'Enter your trade, NAICS, or state (e.g. "HVAC", "Janitorial", "Texas")'}
                  aria-label="Enter your trade, NAICS, or state"
                  className="w-full bg-transparent py-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-amber-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]"
              >
                🔍 Find Opportunities for My Company — Free
              </button>
            </form>
            <p className="mt-2.5 text-center text-xs font-medium text-blue-200/70">
              {openOppCount.toLocaleString()} open opportunities across {bidStats.agencyCount.toLocaleString()} agencies — synced every 4 hours · No credit card
            </p>
          </div>

          {/* Free Professional trial — the strongest demo CTA on the homepage.
              Contract Radar stays as a secondary/ghost link below it. */}
          <div className="mt-5">
            <a
              href="/signup?plan=professional"
              onClick={() => trackEvent("hero_cta_click", "start_trial")}
              className="mx-auto block w-full max-w-3xl rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-4 text-center text-base font-extrabold text-slate-950 shadow-xl shadow-amber-500/25 transition-all hover:from-amber-300 hover:to-amber-400 active:scale-[0.99] sm:text-lg"
            >
              🚀 Get my first Executive Brief — free 14-day Pro trial
            </a>
            <p className="mt-2 text-center text-xs font-medium text-blue-200/60">
              No credit card required · Full Professional features on your first use · Auto-downgrades to free Basic after 14 days
            </p>
            <a
              href="/radar"
              onClick={() => trackEvent("hero_cta_click", "radar_activate")}
              className="mt-2.5 block text-center text-sm font-medium text-blue-200/80 underline-offset-4 transition-colors hover:text-white hover:underline"
            >
              📡 Or try Contract Radar — your first 3 matches are free, with full incumbent intel
            </a>
          </div>

        </div>
      </div>
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
    </section>
  );
}

// ── U.S. Contract Map — homepage embed ───────────────────────────────────────
// A COMPACT version of the full /map page (owner spec: "Homepage: simplified
// map, one color scale, hover totals, click-to-search, live counter"). Reuses
// the exact same US SVG geometry (us-states-map.ts), the same per-state
// aggregate (buildContractMap — the identical server aggregation /map uses), and
// the SAME one color scale (MAP_BUCKETS/mapFillFor) as /map. Every number is
// REAL and SSR-rendered; the hover totals tooltip + gold selection are pure
// progressive enhancement layered on top. Clicking a state is a plain anchor to
// /map?state=<CODE> — the full page already handles the drill-down, so no JS is
// required for click-to-search.
const MAP_BUCKETS: { min: number; fill: string; label: string; glow?: boolean }[] = [
  { min: 0, fill: "#2b3a52", label: "No recorded open bids" },
  { min: 1, fill: "#5b8def", label: "1–25 open bids" },
  { min: 26, fill: "#3b74e8", label: "26–100" },
  { min: 101, fill: "#2557c9", label: "101–300" },
  { min: 301, fill: "#22c58b", label: ">300 — most active", glow: true },
];
function mapFillFor(count: number): { fill: string; glow: boolean } {
  let out = MAP_BUCKETS[0];
  for (const b of MAP_BUCKETS) if (count >= b.min) out = b;
  return { fill: out.fill, glow: !!out.glow };
}

function mapCompactValueLabel(agg: StateAggregate): string {
  if (agg.withValue <= 0) return "stated value not disclosed";
  return `${formatCompactMoney(agg.statedValue)} in stated value`;
}

function OpportunityMap({ aggregate }: { aggregate: ContractMapAggregate }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ code: string; x: number; y: number } | null>(null);
  const { totals } = aggregate;
  const hasData = totals.totalOpen > 0;

  const handleMove = (e: { clientX: number; clientY: number }, code: string) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHovered({ code, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Reset the hover tooltip when the pointer leaves the map container.
  useEffect(() => {
    const onLeave = () => setHovered(null);
    const el = containerRef.current;
    el?.addEventListener("mouseleave", onLeave);
    return () => el?.removeEventListener("mouseleave", onLeave);
  }, []);

  const hoverAgg = hovered ? aggregate.states[hovered.code] : null;

  return (
    <section className="bg-white py-12 sm:py-16" aria-label="U.S. Contract Map">
      <div className="mx-auto max-w-7xl px-6">
        <div className="overflow-hidden rounded-3xl border border-slate-700/60 bg-gradient-to-b from-slate-900 to-slate-950 px-5 py-8 text-slate-100 shadow-2xl shadow-slate-900/20 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Contrax Opportunity Map</p>
            <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
              Government opportunities across the country.
            </h2>
            <p className="mt-3 text-sm font-semibold text-slate-200">
              {hasData
                ? `${totals.totalOpen.toLocaleString()} open opportunities across 50 states + D.C. · synced every 4 hours`
                : "See where government money is moving."}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Explore federal, state, and local government opportunities across the United States. Contrax
              continuously updates its opportunity database so businesses can see where government work is available.
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Hover a state for its totals — click one for its open solicitations. Live from SAM.gov and state
              &amp; city solicitations — synced every 4 hours.
            </p>
          </div>

          <div
            ref={containerRef}
            className="relative mt-6 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/40 p-3 sm:p-4"
          >
            <svg
              viewBox={`0 0 ${US_MAP_VIEWBOX.width} ${US_MAP_VIEWBOX.height}`}
              className="w-full"
              role="img"
              aria-label="Map of US states showing open contract opportunities"
            >
              <defs>
                <filter id="homeMapGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#38bdf8" floodOpacity="0.85" />
                </filter>
              </defs>
              {Object.keys(US_STATE_PATHS).map((code) => {
                const agg = aggregate.states[code];
                const tooltip = agg
                  ? `${STATE_NAMES[code] ?? code}: ${agg.count} open bids · ${agg.setAsideCount} set-asides · ${mapCompactValueLabel(agg)}`
                  : `${STATE_NAMES[code] ?? code}: no recorded open bids`;
                const { fill, glow } = mapFillFor(agg?.count ?? 0);
                return (
                  <a
                    key={code}
                    href={`/map?state=${code}`}
                    onMouseMove={(e) => handleMove(e.nativeEvent as any, code)}
                    onMouseEnter={(e) => handleMove(e.nativeEvent as any, code)}
                    className="outline-none"
                    aria-label={tooltip}
                  >
                    <path
                      d={US_STATE_PATHS[code]}
                      fill={fill}
                      stroke="#0b1220"
                      strokeWidth="1"
                      className="cursor-pointer transition-all duration-150 hover:brightness-125"
                      style={glow ? { filter: "url(#homeMapGlow)" } : undefined}
                    />
                  </a>
                );
              })}
            </svg>

            {/* hover totals tooltip (progressive enhancement — map renders fine without) */}
            {hovered && hoverAgg ? (
              <div
                className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-600 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
                style={{
                  left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 700) - 260),
                  top: hovered.y + 14,
                }}
              >
                <div className="font-semibold text-white">
                  {STATE_NAMES[hovered.code] ?? hovered.code}:{" "}
                  {`${hoverAgg.count} open bids · ${hoverAgg.setAsideCount} set-asides · ${mapCompactValueLabel(hoverAgg)}`}
                </div>
                <div className="mt-1 text-slate-400">
                  {hoverAgg.closingSoon} closing this week · stated value across {hoverAgg.withValue} of{" "}
                  {hoverAgg.count} bids
                </div>
              </div>
            ) : hovered ? (
              <div
                className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-600 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
                style={{
                  left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 700) - 260),
                  top: hovered.y + 14,
                }}
              >
                <div className="font-semibold text-white">
                  {STATE_NAMES[hovered.code] ?? hovered.code}: no recorded open bids
                </div>
              </div>
            ) : null}

            {/* One color scale only, matching /map */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
              <span className="font-medium text-slate-300">Fewer</span>
              {MAP_BUCKETS.map((b) => (
                <span key={b.label} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: b.fill }} />
                  {b.label}
                </span>
              ))}
              <span className="text-slate-500">Brighter = more open opportunities</span>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <p className="text-center text-xs text-slate-500">
              Stated value is shown only across the opportunities that disclose one — never invented or padded.
            </p>
            <a
              href="/map"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400"
            >
              Explore the full map &rarr;
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}



// ── Product Showcase ──────────────────────────────────────────────────────────

const showcaseItems = [
  {
    emoji: "⚡",
    title: "Instant AI Executive Brief",
    description:
      "Skip the 80-page legal jargon. Get a plain-English 3-sentence summary of the actual scope of work in seconds.",
    href: "/radar",
    cta: "Search active bids",
  },
  {
    emoji: "✅",
    title: "Mandatory Qualifications Check",
    description:
      "Instantly see required trade licenses (TACLA, Electrical, GC), minimum insurance, bonding limits, and past performance clauses.",
    href: "/radar",
    cta: "See what's required",
  },
  {
    emoji: "⏰",
    title: "Critical Milestone Radar",
    description:
      "Never miss a mandatory pre-bid site walk or Q&A cutoff with real-time countdown alerts and verified dates.",
    href: "/signup?plan=basic",
    cta: "Start free",
  },
];

function ProductShowcase() {
  return (
    <section id="product-showcase" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
            Built for set-aside small businesses
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Win set-aside contracts the big firms miss
          </h3>
          <p className="mt-4 text-lg leading-relaxed text-gray-600">
            Contrax finds the set-asides you qualify for, decodes what each RFP really requires,
            and drafts compliant responses — so your 8(a), SDVOSB, WOSB, or HUBZone certification
            becomes a winning edge, not a checkbox.
          </p>
        </div>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {showcaseItems.map((item) => (
            <a
              key={item.title}
              href={item.href}
              className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl hover:shadow-slate-900/10"
            >
              <div className="flex items-center justify-center border-b border-gray-100 bg-gradient-to-br from-amber-50 to-white py-8 text-5xl">
                <span aria-hidden="true">{item.emoji}</span>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h4 className="text-lg font-bold text-slate-900">{item.title}</h4>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">
                  {item.description}
                </p>
                <span className="mt-4 inline-flex items-center text-sm font-semibold text-amber-600 transition-colors group-hover:text-amber-500">
                  {item.cta}
                  <svg
                    className="ml-1.5 h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </div>
            </a>
          ))}
        </div>

        {/* CTA — free trial + free score */}
        <div className="mt-14 flex flex-col items-center justify-between gap-8 rounded-2xl bg-slate-900 p-8 text-center shadow-lg sm:flex-row sm:p-10 sm:text-left">
          <div className="max-w-xl">
            <p className="text-2xl font-bold text-white">Your certification is your edge. Put it to work.</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Start free — set-aside-matched opportunities, RFP summaries, AI proposal drafting, and
              certification deadline tracking, all in one place. 14-day Professional trial — no credit card.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <a
              href="/signup?plan=professional"
              onClick={() => trackEvent("hero_cta_click", "product_showcase")}
              className="inline-flex items-center rounded-xl bg-amber-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
            >
              Start free trial →
            </a>
            <a
              href="/score"
              className="inline-flex items-center rounded-xl border border-slate-600 px-7 py-3.5 text-sm font-semibold text-slate-100 transition-all hover:border-slate-400 hover:text-white"
            >
              Score a solicitation free
            </a>
          </div>
        </div>
        <p className="mt-10 text-center text-sm text-gray-500">
          Real set-aside opportunities are live on this page — Contrax is how you go from seeing them to winning them.
        </p>
      </div>
    </section>
  );
}

// (LiveOpportunities + the bid feed own their set-aside label normalization.)



function OpenOpportunities({ bids, todayBids, openCount, q, user }: { bids: Bid[]; todayBids: { bids: TodayBid[]; count: number }; openCount: number; q: string; user: { id: number; email: string } | null }) {
  // Compact strip (owner-directed): the full preview + list + heading duplicated
  // the Opportunity Map, "Closing Soon", and How It Works sections above, so this
  // section is now a single non-repeating strip that keeps the #open-opportunities
  // anchor, the REAL open-solicitation count, and the ?q= "clear search" notice.
  // Data plumbing (loader -> recentBids/openCount/todayBids) and the call site
  // signature are left untouched; bids/todayBids are accepted but no longer used.
  const totalLabel = openCount.toLocaleString("en-US");
  // Login-aware CTA (owner-directed): logged-out visitors go through the signup
  // flow with attribution + next-step back to /dashboard; logged-in users go
  // straight to /dashboard.
  const browseTarget = user ? "/dashboard" : "/signup?source=browse_all&next=/dashboard";

  return (
    <section id="open-opportunities" className="bg-white py-10" aria-label="Open contract solicitations you can bid on now">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div>
          <p className="text-lg font-semibold text-slate-900">Open Opportunities</p>
          <p className="mt-1 text-sm text-gray-500">Fresh set-aside and open solicitations from SAM.gov and city procurement, pulled in as they post.</p>
        </div>
        {q ? (
          <p className="text-sm font-medium text-slate-700">
            Showing results for &ldquo;{q}&rdquo; &mdash;{" "}
            <a href="/#open-opportunities" className="font-semibold text-amber-600 underline-offset-2 hover:underline">
              clear search to browse every open solicitation
            </a>
          </p>
        ) : (
          <a href={browseTarget} className="shrink-0 font-semibold text-blue-700 transition-colors hover:text-blue-900">
            Browse all {totalLabel} open opportunities &rarr;
          </a>
        )}
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Search Your Trade",
      tagline: "Find the set-asides you qualify for",
      description:
        "Enter your trade or NAICS to see live set-aside solicitations matched to your 8(a), SDVOSB, WOSB, or HUBZone certification.",
      href: "/radar",
      cta: "Search the market",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      ),
    },
    {
      number: "02",
      title: 'Click "Get AI Executive Brief"',
      tagline: "AI extracts requirements with citations",
      description:
        "Our model extracts the mandatory requirements, milestones, and red flags from the solicitation description, citing the relevant text.",
      href: "/example-brief",
      cta: "See an example brief",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
    },
    {
      number: "03",
      title: "Bid With Confidence",
      tagline: "Know your odds in seconds",
      description:
        "Understand in seconds whether the job matches your capacity, licensing, and bonding before spending hours on a proposal.",
      href: "/signup?plan=basic",
      cta: "Start free",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
  ];

  return (
    <section id="how-it-works" className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            How it works
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Search. Brief. Bid.
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Find the RFPs in your industry, understand every requirement in seconds, and
            bid with confidence — all on Contrax.
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative flex flex-col rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                  {step.icon}
                </div>
                <span className="text-sm font-bold text-blue-600/60">{step.number}</span>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-sm font-semibold text-amber-600">{step.tagline}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-600">{step.description}</p>
              <a
                href={step.href}
                className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700"
              >
                {step.cta}
                <svg
                  className="ml-1.5 h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


// ── Pricing ───────────────────────────────────────────────────────────────────

function Pricing() {
  const plans = [
    {
      name: "Basic",
      price: "0",
      period: "/month",
      description: "Free forever. For small businesses scouting their first set-aside opportunities.",
      features: [
        "Basic Solicitations Search",
        "Up to 3 Saved Bids",
        "1 AI Executive Brief monthly",
        "Standard Set-Aside Filters",
      ],
      cta: "Start Free",
      slug: "basic",
      featured: false,
    },
    {
      name: "Starter",
      price: "19",
      period: "/month",
      description: "For businesses ready to build and track a real government-contracting pipeline.",
      features: [
        "Unlimited Saved Bids",
        "3 AI Executive Briefs monthly",
        "Daily NAICS Email Alerts",
        "CSV Pipeline Export",
      ],
      cta: "Find Opportunities for My Company",
      slug: "starter",
      featured: false,
    },
    {
      name: "Professional",
      price: "79",
      period: "/month",
      description: "For growing businesses that win more with full RFP intelligence — 50 AI Executive Briefs a month, incumbent pricing, and draft tools.",
      features: [
        "50 AI Executive Briefs a month — requirements, milestones & red flags",
        "Full Incumbent Intelligence & Past Pricing",
        "AI Match Scoring",
        "Draft Tools",
      ],
      cta: "Find Opportunities for My Company",
      slug: "professional",
      featured: true,
    },
  ];

  // Agency ($199/mo) is NOT part of the primary 3-tier matrix — kept separately
  // (Proposal Evaluator Red Team + team roles). Listed below the main grid.
  const agencyPlan = {
    name: "Agency",
    price: "199",
    period: "/month",
    description: "For firms managing multiple clients or large contract portfolios.",
    features: [
      "Everything in Professional",
      "200 AI Executive Briefs monthly",
      "Proposal Evaluator Red Team",
      "Team roles & permissions",
      "Integration connectors",
      "Win/loss bid tracking",
      "Team collaboration tools",
    ],
    cta: "Find Opportunities for My Company",
    slug: "agency",
  };

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
            Pricing
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Plans for every stage of growth
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Start small and scale up as your contracting pipeline grows. No long-term contracts
            required.
          </p>
          <p className="mt-3 text-sm font-medium text-slate-500">Start free on Basic — no card required. Your 14-day Professional trial starts on your first premium action. Cancel anytime.</p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border bg-white p-8 shadow-sm transition-all hover:shadow-lg ${
                plan.featured
                  ? "border-blue-500 ring-2 ring-blue-500/20 scale-[1.02] lg:scale-105"
                  : "border-gray-200"
              }`}
            >
              {plan.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-md">
                  Recommended
                </div>
              )}
              <div className="mb-6">
                <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-slate-900">${plan.price}</span>
                <span className="text-gray-500">{plan.period}</span>
              </div>
              <ul className="mb-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <svg
                      className={`mt-0.5 h-5 w-5 flex-shrink-0 ${plan.featured ? "text-blue-600" : "text-green-500"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
              <a href={`/signup?plan=${plan.slug}`} onClick={() => trackEvent("hero_cta_click", "pricing")} className={`block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${plan.featured ? "bg-amber-500 text-white" : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"}`}>{plan.cta}</a>
            </div>
          ))}
        </div>

        {/* Agency — kept separate from the primary 3-tier matrix */}
        <div className="mt-10">
          <div className="relative flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-slate-900">{agencyPlan.name}</h3>
              </div>
              <p className="mt-1 text-sm text-gray-500">{agencyPlan.description}</p>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-gray-600">
                {agencyPlan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-1.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-6 sm:mt-0 sm:text-right">
              <p className="text-3xl font-extrabold text-slate-900">
                ${agencyPlan.price}<span className="text-base font-normal text-gray-500">{agencyPlan.period}</span>
              </p>
              <a
                href={`/signup?plan=${agencyPlan.slug}`}
                onClick={() => trackEvent("hero_cta_click", "pricing")}
                className="mt-3 inline-block w-full rounded-xl border-2 border-slate-900 px-6 py-3 text-center text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98] sm:w-auto"
              >
                {agencyPlan.cta}
              </a>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-gray-500">
            Agency includes the Proposal Evaluator "Red Team" and team roles — available separately from the core tiers.
          </p>
        </div>

        {/* Billing note */}
        <p className="mt-8 text-center text-sm text-gray-500">
          Plans are billed monthly. Cancel anytime.
        </p>
        <p className="mt-3 text-center">
          <a href="/signup" onClick={() => trackEvent("hero_cta_click", "pricing")} className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
            Or start your 14-day Professional trial →
          </a>
        </p>
      </div>
    </section>
  );
}

// ── CTA ────────────────────────────────────────────────────────────────────────

function WaitlistSection() {
  return (
    <>
      <section className="bg-slate-900 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              You got the certification. Now find the contracts it unlocks.
            </h2>
            <p className="mt-4 text-lg text-blue-100/70">
              See your matches, read your first Executive Brief, and never miss a deadline again — free to start.
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="/signup"
                onClick={() => trackEvent("hero_cta_click", "cta_final")}
                className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl hover:shadow-amber-500/30 active:scale-[0.98]"
              >
                Find Opportunities for My Company
                <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a href="/signup" className="text-sm font-medium text-blue-300 hover:text-white transition-colors">
                No credit card required →
              </a>
            </div>
          </div>
        </div>
      </section>

    </>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-slate-900 py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700">
            <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <span className="text-lg font-bold text-white">Contrax</span>
        </div>
        <p className="text-sm text-gray-400">
          &copy; {new Date().getFullYear()} Contrax. All rights reserved.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <a href="/compare" className="text-sm text-gray-400 transition-colors hover:text-white">
            Compare
          </a>
          <a href="/clauses" className="text-sm text-gray-400 transition-colors hover:text-white">
            FAR Clause Library
          </a>
          <a href="/blog" className="text-sm text-gray-400 transition-colors hover:text-white">
            Blog
          </a>
          <a href="/about" className="text-sm text-gray-400 transition-colors hover:text-white">
            About
          </a>
          <a href="/set-aside-contracts" className="text-sm text-gray-400 transition-colors hover:text-white">
            Set-Aside Contracts
          </a>
          <a href="/contracts-by-industry" className="text-sm text-gray-400 transition-colors hover:text-white">
            Contracts by Industry
          </a>
          <a href="/vad" className="text-sm text-gray-400 transition-colors hover:text-white">
            Veterans Against Diabetes Pricing
          </a>
          <a href="/security" className="text-sm text-gray-400 transition-colors hover:text-white">
            Security
          </a>
          <a href="/privacy" className="text-sm text-gray-400 transition-colors hover:text-white">
            Privacy Policy
          </a>
          <a href="/terms" className="text-sm text-gray-400 transition-colors hover:text-white">
            Terms of Service
          </a>
          <a
            href="mailto:hello@contrax.company"
            className="text-sm text-gray-400 transition-colors hover:text-white"
          >
            hello@contrax.company
          </a>
        </div>
      </div>
    </footer>
  );
}
