import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

import { getCurrentUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import {
  buildContractMap,
  type ContractMapAggregate,
} from "~/lib/contract-map";
import {
  AUTOPSY_DRAFT_STORAGE_KEY,
  type AutopsyDraft,
} from "~/lib/autopsy-funnel";
// Contrax Grants price label — single source of truth shared with /grants
// (owner-mandated "$19/month"). Pure module, no server-only imports.
import { GRANTS_PRICE_LABEL } from "~/lib/grants";
// Real cached example AI Executive Brief — code-split so it never bloats
// the homepage main bundle or blocks hero render. Same component + same
// server fn as the standalone /example-brief page (single source of truth).
const ExampleBrief = lazy(() => import("~/components/ExampleBrief"));
// Contract Radar — the homepage HERO (owner spec 2026-09-04 v2). Rendered
// without its own heading (heading={false}); this page supplies the one <h1>.
import { HeroRadar } from "~/components/HeroRadar";

// ── Server Functions ──────────────────────────────────────────────────────────

// ── U.S. Contract Map — homepage live counter aggregate ───────────────────────
// Reuses the exact same server aggregation as /map (buildContractMap over the
// open-bid population with the shared low-content filter), so the homepage live
// counter is backed by the SAME real numbers as the full page -- never a
// separate or fabricated figure. State attribution + stated-value honesty rules
// are enforced inside buildContractMap (see lib/contract-map.ts).
// NOTE (owner order 2026-09-23): the compact homepage map EMBED was removed;
// this aggregation stays because the homepage counter reads totals.totalOpen
// from it. /map keeps using the same aggregation on its own.
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

// Homepage loader (owner spec 2026-09-04 v2): the radar hero + the honest live
// counts are all the data the page needs. The former recent-bids / today-bids /
// live-opportunities / alert-count fetches backed sections REMOVED from the page
// in this restructure, so they are gone here too — fewer DB round-trips per
// render, no dead fields. contractMap is still fetched: the hero's live
// "N open opportunities" counter renders from it (the compact homepage map that
// also used it was removed by owner order 2026-09-23).
const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const [businessName, user, bidStats, contractMap] = await Promise.all([
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
    getBidStats(),
    getContractMapAggregate(),
  ]);
  return { businessName, user, bidStats, contractMap };
});

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  loader: () => getLandingData(),
  component: Home,
  head: () => ({
    meta: [
      { title: "Contrax — Find Government Contracts Your Business Can Actually Win" },
      {
        name: "description",
        content:
          "Tell Contrax what your company does. We'll search thousands of federal, state, and local opportunities and show you the best matches — free, no account required, for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company" },
      { property: "og:title", content: "Contrax — Find Government Contracts Your Business Can Actually Win" },
      {
        property: "og:description",
        content:
          "Tell Contrax what your company does. We'll search thousands of federal, state, and local opportunities and show you the best matches — free, no account required, for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Find Government Contracts Your Business Can Actually Win" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Contrax — Find Government Contracts Your Business Can Actually Win" },
      {
        name: "twitter:description",
        content:
          "Tell Contrax what your company does. We'll search thousands of federal, state, and local opportunities and show you the best matches — free, no account required, for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Find Government Contracts Your Business Can Actually Win" },
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

  const { user, bidStats, contractMap } = Route.useLoaderData();

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

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PartnershipBanner />
      <Navbar user={user} />
      {/* ── 2. RADAR — the homepage hero (owner spec 2026-09-04 v2; hero copy
          updated to owner 09-07 copy) ──
          The interactive Contract Radar match-finder IS the hero. The heading
          block below carries the page's single <h1>; HeroRadar renders with
          heading={false} so the form sits under it with no competing h2.
          Same walk as /radar: trade/state/cert/size → real scan, first-3-free,
          full incumbent intel, anonymous locked-results card past the free cap,
          save-your-matches. The primary CTA above the fold links to /radar and
          fires homepage_radar_cta_clicked (owner 09-07). */}
      <section id="radar" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Contrax Radar</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Find government contracts your business can actually win.
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg leading-relaxed text-gray-600">
            Tell Contrax what your company does. We&apos;ll search thousands of federal, state, and local
            opportunities and show you the best matches.
          </p>
          {/* Primary CTA — owner 09-07 copy. Above the fold at 1440×900 (the
              PartnershipBanner stays slim; the radar embed below is tall). */}
          <div className="mt-8">
            <a
              href="/radar"
              onClick={() => trackEvent("homepage_radar_cta_clicked", "hero_primary")}
              className="inline-block rounded-xl bg-amber-500 px-10 py-4 text-lg font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 hover:shadow-md active:scale-[0.98]"
            >
              Find My Contracts →
            </a>
            <p className="mt-3 text-sm font-medium text-gray-700">
              Free · No account required
            </p>
          </div>
        </div>
        {/* The EXISTING radar embed — logic, analytics, and scan flow unchanged. */}
        <div className="mx-auto mt-8 max-w-5xl">
          <HeroRadar initialCert="all" heading={false} />
        </div>
        <div className="mx-auto mt-6 max-w-4xl text-center">
          {/* Honest dynamic counts — both numbers are ALREADY fetched by the
              loader (bidStats + contractMap); no new DB query is added. */}
          <p className="mt-2 text-xs font-medium text-gray-500">
            <strong>{contractMap.totals.totalOpen.toLocaleString("en-US")}</strong> open
            opportunities · <strong>{bidStats.agencyCount.toLocaleString("en-US")}</strong>{" "}
            agencies · Updated every 4 hours
          </p>
        </div>
        {/* Bid Scout secondary CTA (owner 2026-09-11, Phase B) — BELOW the hero
            and the Radar embed; the hero CTA + its homepage_radar_cta_clicked
            event are untouched. Label and destination are owner-exact. */}
        <div className="mx-auto mt-10 max-w-3xl text-center">
          <a
            href="/bid-scout?source=homepage"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-900 bg-white px-8 py-3.5 text-base font-bold text-slate-900 shadow-sm transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98]"
          >
            Have Contrax find opportunities for me
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 12h12" />
            </svg>
          </a>
          <p className="mt-2.5 text-xs font-medium text-gray-500">
            $99/month — five handpicked federal opportunities matched to your business, every Friday
          </p>
        </div>
      </section>
      {/* ── CONTRAX GRANTS — homepage section (owner order 2026-09-16) ──
          Slotted DIRECTLY between the Bid Scout callout (the last block inside
          the Radar section above) and the Award Autopsy section below, per the
          owner's exact home order:
          Radar hero → Bid Scout → Contrax Grants → Award Autopsy →
          Example AI Brief → Pricing.
          The compact Opportunity Map that used to sit between Award Autopsy and
          the Example AI Brief was REMOVED (owner order 2026-09-23). The full
          /map page + /map?state=<CODE> drill-down are untouched — the homepage
          simply no longer embeds them.
          Pure ADDITIVE callout: no state, no fetch, no analytics event, no new
          server fn — it links to the existing /grants page. Nothing above it
          changes, so the hero CTA stays above the fold at 1440×900. ── */}
      <ContraxGrantsPromo />
      {/* ── AWARD AUTOPSY — homepage section #2, immediately below the Radar
          hero (owner spec 2026-09-05). The second front door: for visitors who
          already bid-and-lost. ── */}
      <AwardAutopsyHero />
      {/* Real example AI Executive Brief — real bids, summarized. */}
      <Suspense fallback={null}>
        <ExampleBrief variant="embed" />
      </Suspense>
      <HowItWorks />
      {/* ── 6. Pricing (kept) ── */}
      <Pricing />
      {/* ── 8. Footer ── */}
      <Footer />
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar({ user }: { user: { id: number; email: string } | null }) {
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
              <a href="/alerts" aria-label="Bid alerts" className="relative inline-flex items-center rounded-lg px-3 py-2 text-lg text-gray-600 hover:text-gray-900">🔔</a>
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
                <a href="/alerts" onClick={closeMenu} className="block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900">🔔 Bid alerts</a>
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

// ── Contrax Grants — homepage section (owner order 2026-09-16) ───────────────
// The third product line on the homepage, slotted between the Radar hero (and
// its Bid Scout callout) and the Award Autopsy front door. Presentational only:
// no data fetch, no server fn, no analytics event, no DB — it renders instantly
// in the server HTML and just links to the existing /grants page. The price
// label is IMPORTED from the grants module so the homepage and /grants can
// never disagree on the number (owner-mandated "$19/month").
function ContraxGrantsPromo() {
  return (
    <section
      aria-label="Contrax Grants"
      className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8 lg:pb-16"
    >
      <div className="overflow-hidden rounded-3xl border border-amber-900/10 bg-gradient-to-b from-amber-50 to-white px-5 py-8 shadow-sm sm:px-8 sm:py-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Contrax Grants
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Find grants your organization actually qualifies for.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-gray-600">
            Contrax Grants searches federal grant opportunities on Grants.gov by keyword,
            applicant type, funding category, agency, and status — source-verbatim details,
            nothing invented.
          </p>
        </div>
        <div className="mt-8 text-center">
          <a
            href="/grants"
            className="inline-block rounded-xl bg-amber-500 px-8 py-3.5 text-base font-bold text-slate-950 shadow-sm transition-all hover:bg-amber-400 hover:shadow-md active:scale-[0.98]"
          >
            Search grants →
          </a>
          <p className="mt-3 text-sm font-semibold text-slate-700">
            Contrax Grants — {GRANTS_PRICE_LABEL}
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Award Autopsy — homepage section #2 (owner spec 2026-09-05) ───────────────
// The second front door, for visitors who already bid-and-lost. Single-field
// form writes a minimal draft to the SAME sessionStorage key the /autopsy
// funnel owns (AUTOPSY_DRAFT_STORAGE_KEY) and navigates there via the app
// router, so the funnel picks it up: /autopsy prefills its first field from
// the draft and the visitor completes agency + the rest there. The draft
// contract is honored exactly (same key, same shape); /autopsy's own funnel,
// events, and gift logic are untouched.
//
// Analytics: ONE new event (autopsy_home_cta, label autopsy_funnel, path /)
// fired once on section view (stage-0 entry) and again on submit-click. The
// admin autopsy-funnel view ignores it (not in AUTOPSY_EVENTS) so the 9
// owner-exact stage counts are unchanged; the visitor timeline renders it via
// EVENT_LABELS in tracking-intake.ts. No parallel system, no lead-score
// change, no DB change.
function AwardAutopsyHero() {
  const navigate = useNavigate();
  const [solicitation, setSolicitation] = useState("");
  const viewFired = useRef(false);

  // Stage-0 entry: the visitor saw the homepage autopsy section.
  useEffect(() => {
    if (viewFired.current) return;
    viewFired.current = true;
    trackEvent("autopsy_home_cta", "autopsy_funnel", "/");
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = solicitation.trim();
    if (!value) return;
    try {
      const draft: AutopsyDraft = {
        bidTitle: value,
        agency: "",
        naicsCode: "",
        estimatedValue: "",
      };
      window.sessionStorage.setItem(AUTOPSY_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* storage blocked — /autopsy starts empty; the visitor re-enters there */
    }
    trackEvent("autopsy_home_cta", "autopsy_funnel", "/");
    navigate({ to: "/autopsy" });
  };

  return (
    <section aria-label="Award Autopsy" className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8 lg:pb-16">
      <div className="overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-b from-emerald-50 to-white px-5 py-8 shadow-sm sm:px-8 sm:py-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Contrax Award Autopsy
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Lost a government bid? Find out what happened.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-gray-600">
            Don&apos;t just move on. Contrax compares available award information, winning price,
            incumbent history and competitive signals to help you understand the outcome.
          </p>
        </div>
        <form onSubmit={submit} className="mx-auto mt-8 max-w-2xl">
          <label htmlFor="home-autopsy-solicitation" className="block text-sm font-medium text-slate-700">
            Enter solicitation number:
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              id="home-autopsy-solicitation"
              value={solicitation}
              onChange={(e) => setSolicitation(e.target.value)}
              placeholder='e.g. "Janitorial Services, DHA Facilities, San Antonio"'
              autoComplete="off"
              className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
            <button
              type="submit"
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 active:scale-[0.98]"
            >
              Analyze My Lost Bid &rarr;
            </button>
          </div>
          <p className="mt-3 text-center text-sm font-medium text-slate-700">
            First Award Autopsy FREE · No credit card
          </p>
          <p className="mt-2 text-center text-xs text-slate-500">
            Award data comes from USAspending.gov (public federal contract data). Everything shown
            is real — competition counts are shown only when a source provides them.
          </p>
        </form>
      </div>
    </section>
  );
}

// ── U.S. Contract Map — homepage EMBED REMOVED (owner order 2026-09-23) ──────
// The compact homepage map (one color scale, hover totals tooltip, click-to-
// search per-state links, the "Explore the full map →" CTA) was removed from
// the homepage at the owner's request. This file therefore no longer imports
// US_MAP_VIEWBOX / US_STATE_PATHS, STATE_NAMES, MAP_BUCKETS / mapFillFor,
// mapCompactValueLabel or formatCompactMoney — all of them were map-only.
// What STAYS: the hero's live counter above, which still renders
// contractMap.totals.totalOpen from the SAME buildContractMap aggregation the
// loader runs (getContractMapAggregate — untouched). /map and its
// /map?state=<CODE> drill-down are a separate route and are untouched: they
// keep the full map, the color scale and the per-state totals.

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
        "1 Award Autopsy monthly — full analysis",
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
        "5 Award Autopsies monthly",
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
        "25 Award Autopsies monthly",
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
      "100 Award Autopsies monthly",
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
    <section id="pricing" className="pricing-section py-20 sm:py-28">
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
