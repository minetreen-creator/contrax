import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { sql } from "~/db";

// ── Types ─────────────────────────────────────────────────────────────────────
type Bid = {
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  location: string | null;
};

// ── Server Functions ──────────────────────────────────────────────────────────

const getRecentBids = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await sql()`
    SELECT title, agency, estimated_value, due_date, location
    FROM bids
    ORDER BY created_at DESC NULLS LAST
    LIMIT 50
  `;
  return rows as Bid[];
});

const getHealthcareBids = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await sql()`
    SELECT title, agency, estimated_value, due_date, location
    FROM bids
    WHERE LOWER(category) LIKE '%health%'
       OR LOWER(category) LIKE '%medical%'
       OR LOWER(title) LIKE '%health%'
       OR LOWER(title) LIKE '%medical%'
    ORDER BY created_at DESC NULLS LAST
    LIMIT 10
  `;
  return rows as Bid[];
});

const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const [businessName, user, bids, healthcareBids] = await Promise.all([
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
    getRecentBids(),
    getHealthcareBids(),
  ]);
  return { businessName, user, bids, healthcareBids };
});

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  loader: () => getLandingData(),
  component: Home,
  head: () => ({
    meta: [
      { title: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        name: "description",
        content:
          "Contrax helps 8(a), SDVOSB, WOSB, and HUBZone-certified businesses find set-aside opportunities, understand bid documents, and win more government contracts.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://contrax.company" },
      { property: "og:title", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        property: "og:description",
        content:
          "Contrax helps 8(a), SDVOSB, WOSB, and HUBZone-certified businesses find set-aside opportunities, understand bid documents, and win more government contracts.",
      },
      { property: "og:image", content: "https://contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      {
        name: "twitter:description",
        content:
          "Contrax helps 8(a), SDVOSB, WOSB, and HUBZone-certified businesses find set-aside opportunities, understand bid documents, and win more government contracts.",
      },
      { name: "twitter:image", content: "https://contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company" }],
  }),
});

// ── Page Component ────────────────────────────────────────────────────────────

function Home() {
  const { businessName, user, bids, healthcareBids } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    description:
      "Contrax is the contract intelligence platform for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses — finding set-aside opportunities, explaining bid documents, and drafting proposals so certified firms can compete and win.",
    url: "https://contrax.company",
    logo: "https://contrax.company/logo-square.png",
    email: "hello@contrax.company",
  };


  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar user={user} />
      <Hero businessName={businessName} />
      <ProductShowcase />
      <BidTicker bids={bids} />
      {healthcareBids.length > 0 && <HealthcareOpportunities bids={healthcareBids} />}
      <HowItWorks />
      <Example />
      <WhoItsFor />
      <ROICalculator />
      <CompetitorComparison />
      <LeadCapture />
      <Pricing />
      <WaitlistSection />
      <Footer />
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar({ user }: { user: { id: number; email: string } | null }) {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    window.location.href = "/";
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center" aria-label="Contrax home">
          <img src="/logo.png" alt="Contrax" className="h-9 w-auto" />
        </a>

        <div className="flex items-center gap-3">
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
                href="/pricing"
                className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-all hover:text-gray-900"
              >
                Pricing
              </a>
              <a
                href="/login"
                className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
              >
                Sign In
              </a>
              <a
              href="/signup"
              className="inline-flex items-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 hover:shadow-md"
              >
              Get Started
              </a>
              </>
              )}
              </div>
              </div>
              </nav>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero({ businessName }: { businessName: string }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[url('data:image/png;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
      <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-28 sm:pb-32 sm:pt-36 lg:pb-40 lg:pt-44">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-1.5 text-sm font-medium text-blue-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            Contract Intelligence Platform
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Built for the businesses{" "}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              America&apos;s procurement system was designed to help.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100/80 sm:text-xl">
            Not another database of RFPs. {businessName} is your contract intelligence platform for 8(a), SDVOSB, WOSB, and
            HUBZone-certified businesses — matching you to set-aside opportunities, summarizing what
            matters, and drafting proposals so you can compete and win more contracts.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="/signup"
              className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl hover:shadow-amber-500/30 active:scale-[0.98]"
            >
              Start Free Trial
              <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center rounded-xl px-6 py-4 text-base font-medium text-blue-100 transition-colors hover:text-white"
            >
              See how it works
              <svg className="ml-1.5 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </a>
          </div>
        </div>
      </div>
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
    </section>
  );
}

// ── Product Showcase ──────────────────────────────────────────────────────────

const showcaseItems = [
  {
    src: "/screenshots/score-tool.png",
    alt: "Can I Win This? — Contrax solicitation scoring tool",
    badge: "Free · no login",
    title: "Can I Win This?",
    description:
      "Paste any solicitation and get an instant win-probability analysis across 9 dimensions — GO, CAUTIOUS, or NO-GO. Free, no login required.",
    href: "/score",
    cta: "Score a solicitation",
  },
  {
    src: "/screenshots/copilot.png",
    alt: "Contract Intelligence Copilot — Contrax strategist",
    badge: "Strategist",
    title: "Contract Intelligence Copilot",
    description:
      "Your strategist knows your certifications, active bids, and win/loss history. Ask it anything about your pipeline — it answers with your context in mind.",
    href: "/copilot",
    cta: "Meet the copilot",
  },
  {
    src: "/screenshots/hero.png",
    alt: "Contrax full platform overview",
    badge: "Full platform",
    title: "The Complete Platform",
    description:
      "Set-aside-first bid matching, proposal drafting, compliance checks, pricing intelligence, and team workspaces — built for certified small businesses.",
    href: "/signup",
    cta: "Get started",
  },
];

function ProductShowcase() {
  return (
    <section id="product-showcase" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
            Product Tour
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            See Contrax in Action
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            From a free win-probability check to a strategist that knows your bid history —
            here&apos;s what you can do in your first five minutes.
          </p>
        </div>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {showcaseItems.map((item) => (
            <a
              key={item.title}
              href={item.href}
              className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl hover:shadow-slate-900/10"
            >
              <div className="relative overflow-hidden border-b border-gray-100">
                <img
                  src={item.src}
                  alt={item.alt}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[1280/577] w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-amber-300 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {item.badge}
                </span>
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

        {/* See it in Word CTA */}
        <div className="mt-12 flex flex-col items-center justify-between gap-6 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-8 text-center shadow-sm sm:flex-row sm:p-10 sm:text-left">
          <div>
            <p className="text-xl font-bold text-slate-900">See Contrax inside Microsoft Word</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Watch the Word plugin redline a live RFP response — clause suggestions, compliance
              checks, and risk flags appear right in the document as you work.
            </p>
          </div>
          <a
            href="/signup"
            className="inline-flex flex-shrink-0 items-center gap-2.5 rounded-xl bg-amber-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
          >
            Start Free Trial
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Live Bid Ticker ───────────────────────────────────────────────────────────

function BidTicker({ bids }: { bids: Bid[] }) {
  if (bids.length === 0) {
    return (
      <section className="bg-white py-14">
      <div className="mx-auto max-w-7xl px-6 text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <h2 className="text-2xl font-bold text-slate-900">Live Opportunities</h2>
          </div>
          <p className="text-gray-500">Real government contracts being tracked right now</p>
          <p className="mt-2 text-sm text-gray-400">Bid data will appear here once the sync runs.</p>
        </div>
      </section>
    );
  }

  // Dedupe by title + agency, then double for seamless scroll
  const seen = new Set<string>();
  const unique = bids.filter((b) => {
    const key = `${b.title}|${b.agency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const tickerBids = unique.length > 0 ? [...unique, ...unique] : [];

  return (
    <section className="overflow-hidden bg-white py-14">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-8 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <h2 className="text-2xl font-bold text-slate-900">Live Opportunities</h2>
        </div>
        <p className="mb-6 text-gray-500">Real government contracts being tracked right now</p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track {
          display: flex;
          gap: 1rem;
          width: max-content;
          animation: ticker-scroll 30s linear infinite;
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
      `}} />

      <div className="ticker-track px-6">
        {tickerBids.map((bid, i) => (
          <div
            key={i}
            className="w-72 flex-shrink-0 rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
          >
            <span className="mb-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              {bid.agency}
            </span>
            <p
              className="line-clamp-1 text-sm font-medium text-slate-800"
              title={bid.title}
            >
              {bid.title.length > 80 ? bid.title.slice(0, 80) + "..." : bid.title}
            </p>
            <div className="mt-2 flex items-center justify-between">
              {bid.estimated_value ? (
                <span className="text-xs font-semibold text-green-600">
                  {bid.estimated_value}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Value TBD</span>
              )}
              {bid.location ? (
                <span className="ml-2 truncate text-xs text-gray-400">
                  {bid.location}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Healthcare Opportunities ───────────────────────────────────────────────────

function HealthcareOpportunities({ bids }: { bids: Bid[] }) {
  return (
    <section className="bg-gradient-to-br from-blue-50 to-white py-14">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-8 flex items-center gap-2">
          <span className="text-2xl">🏥</span>
          <h2 className="text-2xl font-bold text-slate-900">Healthcare Staffing Opportunities</h2>
        </div>
        <p className="mb-8 text-gray-500">
          Nursing, physician, and clinical staffing contracts from federal, state, and local agencies.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bids.map((bid, i) => (
            <div
              key={i}
              className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-blue-300"
            >
              <span className="mb-2 inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                {bid.agency.length > 40 ? bid.agency.slice(0, 40) + "..." : bid.agency}
              </span>
              <p
                className="line-clamp-2 text-sm font-semibold text-slate-800"
                title={bid.title}
              >
                {bid.title}
              </p>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                {bid.location && <span>{bid.location}</span>}
                {bid.due_date && (
                  <span className="text-amber-600 font-medium">
                    Due {new Date(bid.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        {bids.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">
            No healthcare staffing bids right now — check back soon or{" "}
            <a href="/signup" className="text-blue-600 underline">sign up</a> to get alerts when new ones post.
          </p>
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
      title: "Tell us what you do",
      description:
        "Describe your business — like “We install commercial flooring” — and set your location and industry preferences. No complex setup required.",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      ),
    },
    {
      number: "02",
      title: "We find your matches",
      description:
        "Contrax monitors federal and city procurement sites daily, filtering thousands of opportunities to surface only the ones relevant to your business.",
      icon: (
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      ),
    },
    {
      number: "03",
      title: "Win more contracts",
      description:
        "Get plain-English summaries, drafted proposal responses, and compliance checklists for every opportunity — so you submit faster and win more.",
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
            How It Works
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            From search to submission in three steps
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Stop spending hours digging through procurement portals. Contrax automates the entire
            workflow.
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                {step.icon}
              </div>
              <span className="text-sm font-bold text-blue-600/60">{step.number}</span>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-3 text-gray-600 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Example / See It In Action ────────────────────────────────────────────────

function Example() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
            Simulation — See It In Action
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            How a landscaping company wins more work
          </h3>
          <p className="mt-2 text-sm text-amber-700">This is a simulated dashboard showing how Contrax works for a fictional business. Real results vary by industry, location, and market conditions.</p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
          {/* Top bar */}
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 sm:px-8">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 rounded-full bg-red-400" />
              <span className="flex h-3 w-3 rounded-full bg-yellow-400" />
              <span className="flex h-3 w-3 rounded-full bg-green-400" />
              <span className="ml-3 text-sm font-medium text-gray-500">Contrax Dashboard</span>
            </div>
          </div>
          {/* Content */}
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
              {/* Left: scenario */}
              <div className="flex-1 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-green-100 text-2xl">
                    🌿
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Business Profile</p>
                    <p className="text-lg font-semibold text-slate-900">
                      GreenScape Landscaping
                    </p>
                    <p className="text-sm text-gray-500">VA &bull; NC &bull; DC metro</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Landscaping", "Snow Removal", "Grounds Maintenance"].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-gray-600">
                  A landscaping company serving Virginia, North Carolina, and DC signs up with three
                  service categories. Contrax immediately begins scanning.
                </p>
              </div>

              {/* Right: results */}
              <div className="flex-1 space-y-5 rounded-xl border border-gray-100 bg-gray-50/60 p-6 sm:p-8">
                <p className="text-sm font-semibold uppercase tracking-widest text-gray-400">
                  This Week&rsquo;s Results
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl bg-white p-4 text-center shadow-sm">
                    <p className="text-3xl font-bold text-blue-600">14</p>
                    <p className="mt-1 text-sm text-gray-500">New Matches</p>
                  </div>
                  <div className="rounded-xl bg-white p-4 text-center shadow-sm">
                    <p className="text-3xl font-bold text-amber-500">12</p>
                    <p className="mt-1 text-sm text-gray-500">Days to Bid</p>
                  </div>
                  <div className="rounded-xl bg-white p-4 text-center shadow-sm sm:col-span-1 col-span-2">
                    <p className="text-3xl font-bold text-green-600">$180K</p>
                    <p className="mt-1 text-sm text-gray-500">Est. Contract Value</p>
                  </div>
                </div>
                <div className="space-y-3 pt-3">
                  <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                    </svg>
                    <p className="text-sm text-gray-700">
                      Required documents flagged and organized
                    </p>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                    </svg>
                    <p className="text-sm text-gray-700">
                      Drafted proposal based on previous winning submissions
                    </p>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                    </svg>
                    <p className="text-sm text-gray-700">
                      Compliance checklist ready for review
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Who It's For ──────────────────────────────────────────────────────────────

function WhoItsFor() {
  const categories = [
    { name: "Construction", icon: "🏗️" },
    { name: "IT Services", icon: "💻" },
    { name: "Landscaping", icon: "🌿" },
    { name: "Janitorial", icon: "🧹" },
    { name: "Security", icon: "🛡️" },
    { name: "HVAC", icon: "❄️" },
    { name: "Plumbing & Electrical", icon: "🔧" },
    { name: "Marketing Agencies", icon: "📊" },
    { name: "Manufacturing", icon: "🏭" },
    { name: "Healthcare", icon: "🏥" },
  ];

  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            Who It&rsquo;s For
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Built for certified businesses that win government work
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            Contrax is purpose-built for minority-, veteran-, and women-owned businesses pursuing
            8(a), SDVOSB, WOSB, and HUBZone set-aside contracts.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {categories.map((cat) => (
            <div
              key={cat.name}
              className="flex flex-col items-center gap-3 rounded-xl border border-gray-200/60 bg-white p-6 text-center shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <span className="text-2xl">{cat.icon}</span>
              <span className="text-sm font-semibold text-slate-800">{cat.name}</span>
            </div>
          ))}
        </div>

        {/* Set-aside focus */}
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 text-center sm:p-8">
            <svg className="mx-auto mb-4 h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-bold text-slate-900">Set-Aside Matching</h3>
            <p className="mt-2 text-gray-600">Automatically match bids to your certifications: 8(a), SDVOSB, WOSB, HUBZone</p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 text-center sm:p-8">
            <svg className="mx-auto mb-4 h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499l2.125 5.111 5.518.442-4.204 3.602 1.285 5.385L12 14.654l-4.204 2.885 1.285-5.385-4.204-3.602 5.518-.442L12.52 3.5a.562.562 0 01-1.04 0z" />
            </svg>
            <h3 className="text-lg font-bold text-slate-900">Built around the set-aside journey</h3>
            <p className="mt-2 text-gray-600">Designed to help minority-, veteran-, and women-owned businesses identify and pursue the set-aside contracts their certifications make possible.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── ROI Calculator ────────────────────────────────────────────────────────────

function ROICalculator() {
  const [hoursPerWeek, setHoursPerWeek] = useState(10);
  const [bidsPerYear, setBidsPerYear] = useState(12);
  const [avgContractValue, setAvgContractValue] = useState(50000);

  const hourlyRate = 75;
  const contraxCost = 149;
  const timeSavingsPercent = 0.8;

  const monthlyTimeSavings = (hoursPerWeek * 4) * timeSavingsPercent;
  const monthlyManualCost = hoursPerWeek * 4 * hourlyRate;
  const annualSavings = (monthlyManualCost - contraxCost) * 12;

  const barMax = Math.max(monthlyManualCost, contraxCost);
  const manualBarPct = Math.min(100, (monthlyManualCost / barMax) * 100);
  const contraxBarPct = Math.min(100, (contraxCost / barMax) * 100);

  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            ROI Calculator
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            What&rsquo;s bid searching costing you?
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            See how much time and money Contrax saves your business
          </p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-2">
          {/* Left: Inputs */}
          <div className="space-y-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
            {/* Slider 1: Hours per week */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Hours per week spent searching for bids
                </label>
                <span className="text-sm font-bold text-blue-600">{hoursPerWeek}h</span>
              </div>
              <input
                type="range"
                min="1"
                max="40"
                step="1"
                value={hoursPerWeek}
                onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>1h</span>
                <span>40h</span>
              </div>
            </div>

            {/* Slider 2: Bids per year */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Bids submitted per year
                </label>
                <span className="text-sm font-bold text-blue-600">{bidsPerYear}</span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                value={bidsPerYear}
                onChange={(e) => setBidsPerYear(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>1</span>
                <span>100</span>
              </div>
            </div>

            {/* Slider 3: Average contract value */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Average contract value
                </label>
                <span className="text-sm font-bold text-blue-600">
                  ${avgContractValue.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                min="5000"
                max="5000000"
                step="5000"
                value={avgContractValue}
                onChange={(e) => setAvgContractValue(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>$5K</span>
                <span>$5M</span>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              Based on an internal hourly rate of <strong>$75/hr</strong>. Contrax saves
              an estimated <strong>80%</strong> of bid-searching time.
            </p>
          </div>

          {/* Right: Results */}
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 shadow-sm sm:p-8">
            <h3 className="mb-6 text-lg font-bold text-slate-900">
              Your Savings Breakdown
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-blue-100 py-3">
                <span className="text-sm text-gray-600">Monthly time savings</span>
                <span className="text-sm font-bold text-slate-800">
                  {monthlyTimeSavings.toFixed(1)} hours/month
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-blue-100 py-3">
                <span className="text-sm text-gray-600">Monthly cost of manual searching</span>
                <span className="text-sm font-bold text-red-500">
                  ${monthlyManualCost.toLocaleString()}/mo
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-blue-100 py-3">
                <span className="text-sm text-gray-600">Your cost with Contrax Professional</span>
                <span className="text-sm font-bold text-green-600">$149/mo</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-sm font-semibold text-slate-800">Annual savings</span>
                <span className="text-lg font-bold text-green-600">
                  ${annualSavings.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Visual comparison bars */}
            <div className="mt-6 rounded-xl bg-white p-4 shadow-sm">
              <p className="mb-3 text-center text-xs text-gray-500">
                Monthly cost comparison
              </p>
              <div className="flex items-end gap-4" style={{ height: "80px" }}>
                <div className="flex flex-1 flex-col items-center">
                  <span className="mb-1 text-xs font-bold text-red-500">
                    ${monthlyManualCost.toLocaleString()}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-red-200"
                    style={{ height: `${manualBarPct}%` }}
                  />
                </div>
                <div className="flex flex-1 flex-col items-center">
                  <span className="mb-1 text-xs font-bold text-green-600">$149</span>
                  <div
                    className="w-full rounded-t-md bg-green-400"
                    style={{ height: `${contraxBarPct}%` }}
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-between text-xs text-gray-500">
                <span>Manual searching</span>
                <span>With Contrax</span>
              </div>
            </div>

            <a
              href="/signup"
              className="mt-6 block w-full rounded-xl bg-amber-500 px-6 py-3 text-center text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]"
            >
              Get Started
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Competitor Comparison ─────────────────────────────────────────────────────

function CompetitorComparison() {
  const criteria = [
    {
      label: "Bid discovery",
      tooltip: "Who finds opportunities for you?",
      contrax: { value: "Scans federal and city procurement sites daily", positive: true },
      manual: { value: "You search SAM.gov, state portals & city sites manually", positive: false },
      consultant: { value: "Consultant checks known sources during business hours", positive: false },
      tools: { value: "Requires you to set up searches & filters yourself", positive: false },
    },
    {
      label: "Time to proposal",
      tooltip: "How fast from finding to submitting?",
      contrax: { value: "Hours — drafts in minutes", positive: true },
      manual: { value: "Days to weeks — research + writing from scratch", positive: false },
      consultant: { value: "Days — depends on their availability & backlog", positive: false },
      tools: { value: "Days — you still write the content", positive: false },
    },
    {
      label: "Monthly cost",
      tooltip: "What it costs per month",
      contrax: { value: "$49–$399/month", positive: true },
      manual: { value: "Hundreds in lost staff hours", positive: false },
      consultant: { value: "$3,000–$10,000+/month retainer", positive: false },
      tools: { value: "$200–$1,000/month", positive: false },
    },
    {
      label: "Proposal quality",
      tooltip: "Drafted vs. manual vs. template",
      contrax: { value: "Tailored drafts for each RFP", positive: true },
      manual: { value: "Depends entirely on your writing skills", positive: false },
      consultant: { value: "Professional — but expensive", positive: false },
      tools: { value: "Template-based — generic, not tailored", positive: false },
    },
    {
      label: "Learning curve",
      tooltip: "How easy to get started",
      contrax: { value: "Minutes — simple onboarding wizard", positive: true },
      manual: { value: "Steep — must learn each procurement system", positive: false },
      consultant: { value: "None — they handle it, but onboarding takes weeks", positive: false },
      tools: { value: "Moderate to steep — complex configuration required", positive: false },
    },
    {
      label: "Coverage",
      tooltip: "Federal, state, local?",
      contrax: { value: "Federal + state + local, all in one place", positive: true },
      manual: { value: "Limited to the sites you have time to check", positive: false },
      consultant: { value: "Usually focused on federal or their specialty", positive: false },
      tools: { value: "Varies — many only cover federal (SAM.gov)", positive: false },
    },
  ];

  const columns = [
    {
      name: "Contrax",
      subtitle: "Contract Intelligence",
      key: "contrax" as const,
      highlight: true,
      icon: (
        <img src="/logo-square.png" alt="Contrax" className="h-6 w-6 object-contain" />
      ),
    },
    {
      name: "Manual Bidding",
      subtitle: "DIY Approach",
      key: "manual" as const,
      highlight: false,
      icon: (
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      ),
    },
    {
      name: "Consultant",
      subtitle: "Hired Help",
      key: "consultant" as const,
      highlight: false,
      icon: (
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
        </svg>
      ),
    },
    {
      name: "Other Tools",
      subtitle: "Generic RFP Software",
      key: "tools" as const,
      highlight: false,
      icon: (
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
  ];

  const Check = () => (
    <svg className="h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );

  const Cross = () => (
    <svg className="h-5 w-5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  const Neutral = () => (
    <svg className="h-5 w-5 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
    </svg>
  );

  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section heading */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            Why Contrax?
          </h2>
          <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Why small businesses choose Contrax
          </h3>
          <p className="mt-4 text-lg text-gray-600">
            See how Contrax stacks up against the alternatives — and why it&rsquo;s the fastest way from bid discovery to signed contract.
          </p>
        </div>

        {/* Desktop table */}
        <div className="mt-14 hidden overflow-hidden rounded-2xl border border-gray-200 shadow-sm lg:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-5 text-sm font-semibold text-slate-700">
                    <span className="sr-only">Criteria</span>
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-5 py-5 text-center ${col.highlight ? "bg-blue-50/60" : ""}`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${col.highlight ? "bg-slate-900" : "bg-gray-100"}`}>
                          {col.icon}
                        </div>
                        <span className={`text-sm font-bold ${col.highlight ? "text-blue-700" : "text-slate-700"}`}>
                          {col.name}
                        </span>
                        <span className="text-xs text-gray-400">{col.subtitle}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {criteria.map((row) => (
                  <tr key={row.label} className="transition-colors hover:bg-gray-50/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{row.label}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-400">{row.tooltip}</p>
                    </td>
                    {columns.map((col) => {
                      const cell = row[col.key];
                      return (
                        <td
                          key={col.key}
                          className={`px-5 py-4 text-center ${col.highlight ? "bg-blue-50/30" : ""}`}
                        >
                          <div className="flex flex-col items-center gap-1.5">
                            <div className="flex items-center justify-center gap-2">
                              {cell.positive ? <Check /> : <Cross />}
                            </div>
                            <p className={`text-xs leading-relaxed ${col.highlight ? "font-medium text-slate-800" : "text-gray-500"}`}>
                              {cell.value}
                            </p>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="mt-14 space-y-8 lg:hidden">
          {columns.map((col) => (
            <div
              key={col.key}
              className={`overflow-hidden rounded-2xl border shadow-sm ${
                col.highlight
                  ? "border-blue-500 ring-2 ring-blue-500/20 bg-gradient-to-br from-blue-50 to-white"
                  : "border-gray-200 bg-white"
              }`}
            >
              <div className={`flex items-center gap-3 px-6 py-4 ${col.highlight ? "bg-blue-100/50" : "bg-gray-50"}`}>
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${col.highlight ? "bg-slate-900" : "bg-gray-100"}`}>
                  {col.icon}
                </div>
                <div>
                  <p className={`text-base font-bold ${col.highlight ? "text-blue-700" : "text-slate-700"}`}>
                    {col.name}
                  </p>
                  <p className="text-xs text-gray-400">{col.subtitle}</p>
                </div>
                {col.highlight && (
                  <span className="ml-auto rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                    Best choice
                  </span>
                )}
              </div>
              <div className="divide-y divide-gray-100 px-6 py-2">
                {criteria.map((row) => {
                  const cell = row[col.key];
                  return (
                    <div key={row.label} className="flex items-start gap-3 py-3">
                      {cell.positive ? (
                        <Check />
                      ) : (
                        <Neutral />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                        <p className={`text-xs leading-relaxed ${col.highlight ? "text-slate-600" : "text-gray-500"}`}>
                          {cell.value}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <a
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-900 px-8 py-3 text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98]"
          >
            See plans
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Guide CTA ─────────────────────────────────────────────────────────────────

function LeadCapture() {
  return (
    <section className="bg-slate-900 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Free Guide: Win Your First Government Contract
          </h2>
          <p className="mt-4 text-lg text-blue-100/70">
            A step-by-step checklist for small businesses — from SAM.gov registration to your first award. No sign-up required.
          </p>
          <div className="mt-8">
            <a
              href="/guide"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]"
            >
              Read the free guide →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}


// ── Pricing ───────────────────────────────────────────────────────────────────

function Pricing() {
  const plans = [
    {
      name: "Starter",
      price: "49",
      period: "/month",
      description: "For small businesses getting started with government contracting.",
      features: [
        "Bid alerts for up to 3 categories",
        "Plain-English bid summaries",
        "SAM.gov bid matching (daily sync)",
        "Up to 2 location preferences",
        "Certification deadline tracking",
      ],
      cta: "Get Started",
      slug: "starter",
      featured: false,
    },
    {
      name: "Professional",
      price: "149",
      period: "/month",
      description: "For growing businesses that want to scale their contracting pipeline.",
      features: [
        "Everything in Starter",
        "Unlimited bid tracking",
        "AI proposal drafting",
        "Win probability scoring",
        "Compliance tracking",
        "AI chat support",
      ],
      cta: "Get Started",
      slug: "professional",
      featured: true,
    },
    {
      name: "Agency",
      price: "399",
      period: "/month",
      description: "For firms managing multiple clients or large contract portfolios.",
      features: [
        "Everything in Professional",
        "Up to 10 user accounts",
        "API access",
        "Custom proposal templates",
        "Team collaboration tools",
        "AI onboarding assistant",
      ],
      cta: "Get Started",
      slug: "agency",
      featured: false,
    },
  ];

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
              <a href={`/signup?plan=${plan.slug}`} className={`block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${plan.featured ? "bg-amber-500 text-white" : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"}`}>{plan.cta}</a>
            </div>
          ))}
        </div>

        {/* Billing note */}
        <p className="mt-8 text-center text-sm text-gray-500">
          Plans are billed monthly. Cancel anytime.
        </p>
        <p className="mt-3 text-center">
          <a href="/signup" className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
            Or start your free trial →
          </a>
        </p>
      </div>
    </section>
  );
}

// ── CTA ────────────────────────────────────────────────────────────────────────

function WaitlistSection() {
  return (
    <section className="bg-slate-900 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to find your next government contract?
          </h2>
          <p className="mt-4 text-lg text-blue-100/70">
            Start finding and winning more contracts today with a plan built for your business.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="/signup"
              className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl hover:shadow-amber-500/30 active:scale-[0.98]"
            >
              Get Started
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
        <div className="flex items-center gap-5">
          <a href="/compare" className="text-sm text-gray-400 transition-colors hover:text-white">
            Compare
          </a>
          <a href="/about" className="text-sm text-gray-400 transition-colors hover:text-white">
            About
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
