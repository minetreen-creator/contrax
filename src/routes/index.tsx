import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { getCurrentUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import {
  buildContractMap,
  type ContractMapAggregate,
} from "~/lib/contract-map";
// HOMEPAGE GRANTS PLUS FAIL-SAFE (owner directive rev 327, 2026-09-23).
// The /grants page and this homepage tier row must ALWAYS agree about whether
// Grants Plus is purchasable; a differing rule would advertise "Get Grants Plus"
// directly above a "Coming soon" /grants page — the exact inconsistency the
// directive forbids. So the homepage uses the SAME pure decision helper /grants'
// own server surfaces use (isUpgradePromptEnabled reads GRANTS_UPGRADE_PROMPT_ENABLED;
// absent / non-"true" / non-"1" ⇒ false), resolved ONCE per request in the loader.
// `~/lib/grants` is a PURE module (no DB, no network, no builtins, and no env
// read at import time), so importing it here is safe on both sides of the
// render, and the value itself is only ever read server-side (see the loader).
import { isUpgradePromptEnabled } from "~/lib/grants";
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
        AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
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

/**
 * FAIL-SAFE decision for the homepage Grants Plus tier row (owner directive
 * rev 327, 2026-09-23): "if the Stripe price configuration or the subscription
 * availability signal becomes unavailable, surfaces must display 'Coming soon'
 * — NEVER a broken payment button."
 *
 * The homepage's ONLY signal is the SAME flag /grants already gates on
 * (`isUpgradePromptEnabled`), so the two pages can never disagree. This wrapper
 * adds the one thing a public page needs: it can NEVER throw. A missing
 * `process` object, an env absent from the runtime, or a hostile getter on the
 * process environment all resolve to `false` ⇒ the row falls back to "Coming
 * soon" instead of 500-ing the public homepage.
 *
 * PURE and exported so the fail-closed contract is unit-tested rather than
 * asserted by reading the source (tests/homepage-grants-failsafe.test.tsx).
 * Takes the env record as an ARGUMENT — it reads no global — so it stays
 * trivially testable and can never become a build-time/inlined read.
 */
export function resolveGrantsUpgradeEnabled(
  env: Record<string, string | undefined> | undefined | null,
): boolean {
  try {
    if (!env) return false;
    return isUpgradePromptEnabled(env);
  } catch {
    // Fail CLOSED: an unreadable signal is treated as "not available".
    return false;
  }
}

// Homepage loader (owner spec 2026-09-04 v2): the radar hero + the honest live
// counts are all the data the page needs. The former recent-bids / today-bids /
// live-opportunities / alert-count fetches backed sections REMOVED from the page
// in this restructure, so they are gone here too — fewer DB round-trips per
// render, no dead fields. contractMap is still fetched: the hero's live
// "N open opportunities" counter renders from it (the compact homepage map that
// also used it was removed by owner order 2026-09-23).
// grantsUpgradeEnabled (owner directive rev 327) is an ENV READ ONLY — it adds
// no DB query and no network call, and it is computed per request (the homepage
// is not in the public SSR cache allowlist: ssr-cache-policy isPublicSsrCacheable("/")
// === false), so a flag flip is reflected on the next render.
const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const [businessName, user, bidStats, contractMap, grantsUpgradeEnabled] = await Promise.all([
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
    // Server-only, per-request env read (the `typeof process` guard mirrors the
    // /api/grants/search one). Never throws — see resolveGrantsUpgradeEnabled.
    (async () =>
      resolveGrantsUpgradeEnabled(
        typeof process !== "undefined" ? process.env : undefined,
      ))(),
  ]);
  return { businessName, user, bidStats, contractMap, grantsUpgradeEnabled };
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

  const { user, bidStats, contractMap, grantsUpgradeEnabled } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    legalName: "Contrax LLC",
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
      <HomepageHero bidStats={bidStats} contractMap={contractMap} />
      <ProductPaths />
      <section id="radar" className="bg-slate-50 px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">Contrax Radar</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Search live government contracts
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Answer four questions to find federal, state, and local opportunities matched to your business.
          </p>
        </div>
        <div className="mx-auto mt-8 max-w-6xl">
          <HeroRadar initialCert="all" heading={false} compact />
        </div>
      </section>
      <FeaturedServices />
      <HowItWorks />
      <Pricing />
      <ContraxGrantsPromo grantsUpgradeEnabled={grantsUpgradeEnabled} />
      <FeaturePreviews />
      <FinalCta />
      <Footer />
    </div>
  );
}

function HomepageHero({
  bidStats,
  contractMap,
}: {
  bidStats: { activeCount: number; agencyCount: number };
  contractMap: ContractMapAggregate;
}) {
  return (
    <header className="relative overflow-hidden border-b border-slate-200 bg-white">
      <div className="absolute inset-x-0 top-0 -z-0 h-80 bg-gradient-to-b from-blue-50/70 to-transparent" />
      <div className="relative mx-auto max-w-7xl px-4 py-14 text-center sm:px-6 sm:py-20 lg:px-8">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-700">Government opportunity intelligence</p>
        <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-bold tracking-[-0.035em] text-slate-950 sm:text-5xl lg:text-6xl">
          Find the right government opportunity—without searching alone.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">
          Contrax helps businesses find contracts and organizations find grants, with source-linked details and practical next steps.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#radar"
            onClick={() => trackEvent("homepage_radar_cta_clicked", "hero_primary")}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-700 px-7 py-3 text-base font-bold text-white shadow-sm transition-colors hover:bg-blue-800 sm:w-auto"
          >
            Search contracts
          </a>
          <a
            href="/grants"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-7 py-3 text-base font-bold text-slate-900 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 sm:w-auto"
          >
            Search grants
          </a>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3">
          <div className="px-5 py-4 sm:border-r sm:border-slate-200">
            <p className="text-2xl font-bold text-slate-950">{contractMap.totals.totalOpen.toLocaleString("en-US")}</p>
            <p className="mt-1 text-sm text-slate-600">open opportunities</p>
          </div>
          <div className="border-y border-slate-200 px-5 py-4 sm:border-y-0 sm:border-r">
            <p className="text-2xl font-bold text-slate-950">{bidStats.agencyCount.toLocaleString("en-US")}</p>
            <p className="mt-1 text-sm text-slate-600">agencies represented</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-2xl font-bold text-slate-950">Every 4 hours</p>
            <p className="mt-1 text-sm text-slate-600">contract data refreshed</p>
          </div>
        </div>

        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-slate-600" aria-label="Contrax data standards">
          <li>Federal, state and local sources</li>
          <li>Source-linked details</li>
          <li>No invented deadlines or eligibility</li>
        </ul>
      </div>
    </header>
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
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center" aria-label="Contrax home">
          <img src="/logo.png" alt="Contrax" className="h-11 w-auto" />
        </a>

        <div className="hidden items-center gap-3 lg:flex">
          <a href="/radar" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-950">Contracts</a>
          <a href="/grants" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-950">Grants</a>
          <a href="/pricing" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-950">Pricing</a>
          <a href="/learn" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-950">Resources</a>
          {user ? (
            <>
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
                Get Started
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
            <a href="/radar" onClick={closeMenu} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Contracts</a>
            <a href="/grants" onClick={closeMenu} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Grants</a>
            <a href="/pricing" onClick={closeMenu} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Pricing</a>
            <a href="/learn" onClick={closeMenu} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Resources</a>
            {user ? (
              <>
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
                  Get Started
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

// ── Choose a path ────────────────────────────────────────────────────────────

function ProductPaths() {
  const paths = [
    {
      eyebrow: "Government contracts",
      title: "Find work your business can pursue",
      description:
        "Search live federal, state, and local solicitations by trade, location, certification, and contract size.",
      href: "/radar",
      cta: "Search contracts →",
      accent: "border-blue-200 bg-blue-50/60",
      ctaClass: "text-blue-700",
    },
    {
      eyebrow: "Government grants",
      title: "Find funding that fits your organization",
      description:
        "Search federal grants, use Grants Plus for ongoing tracking, or order hands-on research from the founder.",
      href: "/grants",
      cta: "Search grants →",
      accent: "border-amber-200 bg-amber-50/60",
      ctaClass: "text-amber-700",
    },
  ];

  return (
    <section aria-label="Choose your Contrax path" className="border-b border-slate-200 bg-white py-12 sm:py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Choose your path</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">What are you looking for today?</h2>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {paths.map((path) => (
            <a
              key={path.title}
              href={path.href}
              className={`group rounded-2xl border p-7 shadow-sm transition-colors hover:border-slate-400 ${path.accent}`}
            >
              <p className="text-sm font-bold uppercase tracking-wider text-slate-600">{path.eyebrow}</p>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">{path.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-slate-600">{path.description}</p>
              <span className={`mt-5 inline-flex text-sm font-bold ${path.ctaClass}`}>{path.cta}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturePreviews() {
  const features = [
    {
      eyebrow: "Award Autopsy",
      title: "Understand why a bid was lost",
      description: "Review available award information, winning price, incumbent history, and competitive signals.",
      href: "/autopsy",
      cta: "Analyze an award",
    },
    {
      eyebrow: "AI Executive Brief",
      title: "Understand an RFP before you bid",
      description: "Turn a long solicitation into requirements, milestones, source citations, and practical red flags.",
      href: "/example-brief",
      cta: "View an example brief",
    },
  ];

  return (
    <section aria-label="More Contrax tools" className="border-t border-slate-200 bg-white py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-5 md:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-7">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-700">{feature.eyebrow}</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{feature.title}</h2>
              <p className="mt-3 text-base leading-7 text-slate-600">{feature.description}</p>
              <a href={feature.href} className="mt-6 inline-flex font-bold text-blue-700 hover:text-blue-900">
                {feature.cta} →
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="bg-slate-950 py-14 text-white sm:py-16" aria-labelledby="final-cta-heading">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <h2 id="final-cta-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          Ready to find your next opportunity?
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-slate-300">
          Start with a free contract scan or search current federal grants.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="/radar" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-7 py-3 font-bold text-white hover:bg-blue-500">
            Search contracts
          </a>
          <a href="/grants" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-600 px-7 py-3 font-bold text-white hover:border-slate-400 hover:bg-slate-900">
            Search grants
          </a>
        </div>
      </div>
    </section>
  );
}

function FeaturedServices() {
  return (
    <section aria-label="Founder-assisted services" className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Bid Scout · $99/month</p>
              <h2 className="mt-2 text-xl font-bold text-slate-950">Five handpicked federal opportunities every Friday</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Founder-assisted matching for businesses that want qualified opportunities brought to them.</p>
            </div>
            <a href="/bid-scout?source=homepage" className="mt-5 shrink-0 rounded-xl bg-slate-900 px-5 py-3 text-center text-sm font-bold text-white hover:bg-slate-800 sm:mt-0">Explore Bid Scout</a>
          </div>
          <div className="flex flex-col rounded-2xl border border-amber-200 bg-amber-50/50 p-7 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Personalized grant report · $49 once</p>
              <h2 className="mt-2 text-xl font-bold text-slate-950">Get a focused grant-opportunity report</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Founder-researched matches, eligibility observations, deadlines, official links, and recommended next steps.</p>
            </div>
            <a href={GRANTS_REPORT_PAYMENT_LINK} target="_blank" rel="noopener noreferrer" className="mt-5 shrink-0 rounded-xl bg-amber-500 px-5 py-3 text-center text-sm font-bold text-slate-950 hover:bg-amber-400 sm:mt-0">Get the $49 report</a>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">Matches and funding are not guaranteed. Grant writing and submission are not included.</p>
      </div>
    </section>
  );
}

// ── Contrax Grants — homepage section (owner order 2026-09-16; three-tier
//    pricing table owner-locked 2026-09-23, business plan revs 305/306) ───────
// The third product line on the homepage, slotted between the Radar hero (and
// its Bid Scout callout) and the Award Autopsy front door. Presentational only:
// no data fetch, no server fn, no analytics event, no DB — it renders instantly
// in the server HTML and links out to the existing /grants page.
//
// The tier names, prices, "best for" lines and "Included" text below are the
// owner's verbatim wording (rev 306) — do NOT reword them. The three boundaries
// the presentation must respect: (1) Nonprofit Free is genuinely useful, not a
// disguised trial; (2) Grants Plus sells convenience, monitoring and deeper
// tools — not access to something nonprofits were promised free; (3) the $49
// report is OPTIONAL human assistance, never required, and its row states that
// matches and funding are NOT guaranteed and that it does NOT include writing
// or submitting the grant application.
//
// The $49 CTA points at the LIVE Stripe payment link for the Personalized Grant
// Opportunity Report (product prod_VJT6jJs5GSmzjH / price price_1UIqApR…), as an
// external link in a new tab. The shared grants price-label constant still lives
// in ~/lib/grants and is still imported by /grants (both untouched) — this
// homepage block no longer renders that label, so its import was dropped here
// only, and it is gone from this file's import list entirely.
const GRANTS_REPORT_PAYMENT_LINK = "https://buy.stripe.com/8x26oJcpV9fCcos7eEf7i0b";

// FAIL-SAFE label (owner directive rev 327, 2026-09-23) — the exact words /grants
// already shows when the upgrade signal is unavailable. Owner copy: do not alter.
const GRANTS_COMING_SOON_LABEL = "Coming soon";

type GrantsTier = {
  name: string;
  price: string;
  period: string;
  bestFor: string;
  included: string;
  ctaLabel: string;
  ctaHref: string;
  external?: boolean;
  /**
   * FAIL-SAFE (owner directive rev 327): this tier's CTA is only live while the
   * subscription-upgrade signal is available. When it is not, the CTA renders as
   * plain non-interactive text — never a payment link and never a button that
   * could break. Everything else about the row (name, price, copy) is unchanged.
   */
  gatedByUpgradeSignal?: boolean;
  /** Only the $49 report carries the required not-guaranteed / no-submission line. */
  disclaimer?: string;
};

const GRANTS_TIERS: GrantsTier[] = [
  {
    name: "Nonprofit Free",
    price: "$0",
    period: "forever",
    bestFor: "Verified 501(c)(3) organizations",
    included:
      "Basic grant search, standard filters, grant previews and official application links. No credit card, trial, or expiration.",
    ctaLabel: "Search grants →",
    ctaHref: "/grants",
  },
  {
    name: "Grants Plus",
    price: "$19",
    period: "/month",
    bestFor: "Businesses and nonprofits wanting ongoing tools",
    included:
      "Unlimited searches and full grant details, advanced filters, saved opportunities, deadline tracking, weekly matching alerts, and enhanced summaries.",
    ctaLabel: "Get Grants Plus →",
    ctaHref: "/grants",
    gatedByUpgradeSignal: true,
  },
  {
    name: "Personalized Grant Opportunity Report",
    price: "$49",
    period: "one-time",
    bestFor: "Organizations wanting hands-on research",
    included:
      "Founder-researched report identifying the strongest opportunities, eligibility observations, deadlines, official links, reasons each grant may fit, and recommended next steps. Delivered within three business days.",
    ctaLabel: "Get the $49 Report →",
    ctaHref: GRANTS_REPORT_PAYMENT_LINK,
    external: true,
    disclaimer:
      "Optional — free grant search remains available to verified nonprofits. Matches and funding are not guaranteed, and this report does not include writing or submitting the grant application.",
  },
];

/**
 * The homepage Contrax Grants tier table (owner order 2026-09-16; three-tier
 * table + copy owner-locked 2026-09-23).
 *
 * FAIL-SAFE (owner directive rev 327, 2026-09-23): `grantsUpgradeEnabled` is the
 * loader's server-side read of the SAME upgrade signal /grants gates on. When it
 * is false/absent the gated tier ("Grants Plus") renders its CTA as plain,
 * non-interactive text — never a payment link, never a button — so an
 * unavailable Stripe configuration or subscription signal can never surface a
 * broken payment affordance. When it is true the row renders exactly as it did
 * before this directive (byte-identical markup; the <a> below keeps its original
 * indentation so a diff shows it as untouched context). The other two rows are
 * never gated. Optional with a FAIL-CLOSED default: a caller that forgets the
 * prop gets the "Coming soon" fallback, never a live payment CTA.
 */
export function ContraxGrantsPromo({
  grantsUpgradeEnabled = false,
}: {
  grantsUpgradeEnabled?: boolean;
}) {
  return (
    <section
      aria-label="Contrax Grants"
      className="border-y border-slate-200 bg-slate-50 py-14 sm:py-16"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-600">
            Contrax Grants
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Find grants your organization actually qualifies for.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-gray-600">
            Contrax Grants searches federal grant opportunities on Grants.gov by keyword,
            applicant type, funding category, agency, and status — source-verbatim details,
            nothing invented. Basic grant search is free for verified nonprofits, and it stays
            free.
          </p>
        </div>

        <div className="mt-9 grid gap-5 lg:grid-cols-3">
        {GRANTS_TIERS.map((tier) => {
          // FAIL-SAFE (owner directive rev 327): an unavailable upgrade signal
          // turns the gated tier's CTA into plain non-interactive text. No href,
          // no button, no payment link — nothing that can break.
          const ctaGated =
            tier.gatedByUpgradeSignal === true && !grantsUpgradeEnabled;
          return (
          <div
            key={tier.name}
            className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
          >
            <h3 className="text-xl font-bold text-slate-900">{tier.name}</h3>
            <p className="mt-1 text-sm text-gray-500">{tier.bestFor}</p>
            <p className="mt-5">
              <span className="text-4xl font-extrabold text-slate-900">{tier.price}</span>{" "}
              <span className="text-gray-500">{tier.period}</span>
            </p>
            <p className="mt-5 flex-1 text-sm leading-relaxed text-gray-700">
              <span className="font-semibold text-slate-900">Included: </span>
              {tier.included}
            </p>
            {tier.disclaimer ? (
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
                {tier.disclaimer}
              </p>
            ) : null}
            {/* FAIL-SAFE (owner directive rev 327, 2026-09-23): with the upgrade
                signal unavailable the gated CTA becomes plain, non-interactive
                text — text-only, so there is no href, no button and no payment
                link to break. The <a> below is the pre-directive markup verbatim
                at its original indentation, so when the signal IS available the
                row renders byte-identically to the launched page. */}
            {ctaGated ? (
              <p
                data-grants-cta="coming-soon"
                className="mt-6 block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold text-gray-500"
              >
                {GRANTS_COMING_SOON_LABEL}
              </p>
            ) : (
            <a
              href={tier.ctaHref}
              target={tier.external ? "_blank" : undefined}
              rel={tier.external ? "noopener noreferrer" : undefined}
              className={`mt-6 block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${
                tier.external
                  ? "bg-amber-500 text-white hover:bg-amber-400"
                  : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"
              }`}
            >
              {tier.ctaLabel}
            </a>
            )}
          </div>
          );
        })}
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          Prices in US dollars. Verified nonprofits keep free grant search with no credit card, no
          trial, and no expiration.
        </p>
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

  return (
    <section id="pricing" className="pricing-section py-16 sm:py-20">
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

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border bg-white p-7 shadow-sm transition-all hover:shadow-lg ${
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

        {/* Billing note */}
        <p className="mt-8 text-center text-sm text-gray-500">
          Plans are billed monthly. Cancel anytime.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center">
          <a href="/signup" onClick={() => trackEvent("hero_cta_click", "pricing")} className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
            Or start your 14-day Professional trial →
          </a>
          <a href="/pricing" className="text-sm font-semibold text-blue-700 hover:text-blue-800">See all plans, including Agency →</a>
        </div>
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
          &copy; {new Date().getFullYear()} Contrax LLC. All rights reserved.
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
