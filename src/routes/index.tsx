import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { Radar, KanbanSquare, ArrowRight, FileSearch } from "lucide-react";
import { HomeContractFinder } from "~/components/HomeContractFinder";
import { MoneyCounter } from "~/components/MoneyCounter";
import { NearYouCard } from "~/components/NearYouCard";
import { TownBuyingCallout } from "~/components/TownBuyingCallout";
import { OpportunityExplorer } from "~/components/OpportunityExplorer";
import { ExampleBrief } from "~/components/ExampleBrief";

import { trackEvent } from "~/lib/track";
import { SiteHeader } from "~/components/SiteHeader";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import {
  OPEN_BID_SQL,
  AWARD_NOTICE_EXCLUSION_SQL,
  CLOSED_EXCLUSION_SQL,
} from "~/lib/open-bids";
import {
  buildContractMap,
  type ContractMapAggregate,
} from "~/lib/contract-map";
import { getSdvosbSample } from "~/lib/sample-bids";

// ── Server Functions ──────────────────────────────────────────────────────────

// ── U.S. Contract Map — homepage live counter aggregate ───────────────────────
// Reuses the exact same server aggregation as /map (buildContractMap over the
// open-bid population with the shared low-content filter), so the homepage live
// counter is backed by the SAME real numbers as the full page -- never a
// separate or fabricated figure. State attribution + stated-value honesty rules
// are enforced inside buildContractMap (see lib/contract-map.ts).
// "Open" = a REAL deadline still ahead (OPEN_BID_SQL) and no award / justification
// notice: owner-approved 2026-10-19, so the counter can never again present a
// deadline-less notice (or a blended all-source figure) as an open federal bid.
// NOTE (owner order 2026-09-23): the compact homepage map EMBED was removed;
// this aggregation stays because the homepage counter reads totals.totalOpen
// (and its federalOpen / stateLocalOpen split) from it. /map keeps using the
// same aggregation on its own.
// Returns null when the query fails (DB unreachable, bids table missing) so a
// database blip hides the stats row instead of 500-ing the public homepage.
// Never substitute a zero or made-up count: the row is simply omitted.
const getContractMapAggregate = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContractMapAggregate | null> => {
    try {
      const { sql } = await import("~/db");
      const rows = await sql()`
        SELECT location, set_aside, estimated_value, agency, category, due_date, source
        FROM bids
        WHERE ${sql().unsafe(OPEN_BID_SQL)}
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
          AND ${sql().unsafe(AWARD_NOTICE_EXCLUSION_SQL)}
          AND ${sql().unsafe(CLOSED_EXCLUSION_SQL)}
      `;
      return buildContractMap(rows as any);
    } catch {
      return null;
    }
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
//
// NO SESSION READ (owner 2026-10-02): the navbar resolves the viewer in the
// browser (SiteHeader without a `user` prop), so this render is identical for
// every visitor and can be served from the edge cache.
const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const [businessName, bidStats, contractMap, endingSoon, endingByState] = await Promise.all([
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
    getBidStats(),
    getContractMapAggregate(),
    // Contracts Ending Soon (owner 2026-10-13): a live count from the USAspending
    // sync; null hides the section, never a made-up number.
    (async () => {
      try {
        const { recompeteTotals } = await import("~/lib/federal-trade-data.server");
        const t = await recompeteTotals(12);
        return t.count > 0 ? t : null;
      } catch {
        return null;
      }
    })(),
    // Money counter (owner 2026-10-17): per-state split of the same USAspending
    // window; {} hides the counter's state picker.
    (async () => {
      try {
        const { recompeteTotalsByState } = await import("~/lib/federal-trade-data.server");
        return await recompeteTotalsByState(12);
      } catch {
        return {};
      }
    })(),
  ]);
  return { businessName, bidStats, contractMap, endingSoon, endingByState };
});

// ── Route ─────────────────────────────────────────────────────────────────────

const PAGE_TITLE = "Contrax | Your next government customer starts here";
const PAGE_DESCRIPTION =
  "Describe your business and preview real government contract matches with clear reasons, requirements to verify, and next steps. Create a free account to keep your shortlist.";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [landing, sample] = await Promise.all([getLandingData(), getSdvosbSample()]);
    return { ...landing, sample };
  },
  component: Home,
  head: () => ({
    meta: [
      { title: PAGE_TITLE },
      { name: "description", content: PAGE_DESCRIPTION },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company" },
      { property: "og:title", content: PAGE_TITLE },
      { property: "og:description", content: PAGE_DESCRIPTION },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: PAGE_TITLE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: PAGE_TITLE },
      { name: "twitter:description", content: PAGE_DESCRIPTION },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: PAGE_TITLE },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company" }],
  }),
});

// ── Official Partnership Announcement (Veterans Against Diabetes) ──────────────
// Static, self-contained announcement band rendered just above the footer
// (moved from the top of the page, owner 2026-10-04). Pure presentational copy — no buttons, no
// checkout wiring, no pricing/gating changes.
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

// Shared page tokens (2026 redesign). Light values first, dark via `dark:`.
const SERIF = "[font-family:Charter,'Iowan_Old_Style',Georgia,serif]";
const CARD =
  "rounded-xl bg-white text-[#0f1f38] shadow-[0_1px_2px_rgba(15,39,71,.08),0_8px_24px_rgba(15,39,71,.10)] dark:bg-[#131f35] dark:text-[#e7edf7] dark:shadow-[0_1px_2px_rgba(0,0,0,.4),0_8px_24px_rgba(0,0,0,.35)]";
const BTN =
  "mt-3.5 block w-full cursor-pointer rounded-lg border-0 bg-[#1c5fbf] px-5 py-3.5 text-center font-semibold text-white hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#8fbaf5] dark:bg-[#6aa3f0] dark:text-[#08172e]";

function Home() {

  const { bidStats, contractMap, endingSoon, endingByState } = Route.useLoaderData();
  const { sample } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    legalName: "Contrax LLC",
    description:
      "Tell Contrax what your business does. Radar finds government opportunities that match — live set-asides for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses, with each opportunity explained and proposals drafted so certified firms can compete and win.",
    url: "https://www.contrax.company",
    logo: "https://www.contrax.company/logo-square.png",
    email: "contrax.companyllc@gmail.com",
  };

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-[#0f1f38] dark:bg-[#0b1424] dark:text-[#e7edf7]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <HomeContractFinder sample={sample} />
      {/* "What's open near you?" (owner 2026-10-21): real open-bid count for the
          visitor's state, client-fetched; renders nothing until it has one. */}
      <NearYouCard />
      {/* "What's Your Town Buying?" (owner 2026-10-23). */}
      <TownBuyingCallout />
      {/* Shorter homepage (owner 2026-10-17): the stats row folds into the
          money counter, and its "contracts ending" figure replaces the
          separate Contracts Ending Soon box. */}
      <MoneyCounter contractMap={contractMap} ending={endingSoon} endingByState={endingByState} agencyCount={bidStats.agencyCount} />
      <OpportunityExplorer />
      <HowItWorks />
      <LaunchpadPromo />
      <BidScoutCallout />
      <MoreFromContrax />
      {/* Moved from the very top (owner 2026-10-04) so the headline is the first thing people read. */}
      <PartnershipBanner />
      <Footer />
    </div>
  );
}

// What Contrax does, in three cards (owner 2026-10-17: the former "Find /
// Track / Learn" cards and "three steps" section merged; learning now lives in
// the Launchpad section).
function HowItWorks() {
  const paths = [
    { title: "Find contracts", description: "Search live opportunities by trade and state, with reasons you can check.", href: "/radar", Icon: Radar },
    { title: "Decide before you bid", description: "Read the AI brief: requirements, milestones and red flags, cited to the solicitation.", href: "/example-brief", Icon: FileSearch },
    { title: "Track your bids", description: "Keep bids, contacts and follow-ups moving in one workspace.", href: "/pipeline", Icon: KanbanSquare },
  ];
  return (
    <section aria-labelledby="how-it-works-title" className="mx-auto max-w-[1120px] px-4 pt-12 sm:px-6">
      <h2 id="how-it-works-title" className={`${SERIF} text-[clamp(24px,3vw,30px)] leading-[1.15] font-bold`}>How Contrax works</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {paths.map(({ title, description, href, Icon }, i) => (
          <a key={title} href={href} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-blue-400 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{i + 1}</span>
              <Icon aria-hidden="true" className="h-6 w-6 text-blue-600 dark:text-blue-300" />
            </div>
            <h3 className="mt-4 flex items-center justify-between gap-3 text-lg font-bold">{title}<ArrowRight aria-hidden="true" className="h-4 w-4 text-blue-600 dark:text-blue-300" /></h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{description}</p>
          </a>
        ))}
      </div>
      {/* Owner 2026-10-19 (item 5): step 2's real after-state, directly under the
          three cards. This is the EXISTING example-brief embed (variant="embed"):
          it renders the real cached AI Executive Brief from the database, labels
          every word of it EXAMPLE, and renders NOTHING when no currently-valid
          cached example exists — that honesty contract is untouched and nothing
          here is fabricated or screenshotted. When it hides itself, only the
          link to the standalone page (which has an honest empty state) remains. */}
      <div className="mt-6">
        <ExampleBrief variant="embed" />
        <p className="mt-4 text-center text-sm">
          <a
            href="/example-brief"
            className="font-semibold text-blue-700 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:text-blue-300"
          >
            See the full example brief →
          </a>
        </p>
      </div>
    </section>
  );
}

// From the CEO and Contrax Grants, one line each (owner 2026-10-17: shorter
// homepage; the full pages are one click away).
function MoreFromContrax() {
  const items = [
    { label: "From the CEO", body: "Nearly 3× more federal bids: 5,700+ open, updated every night from SAM.gov.", href: "/from-the-ceo", cta: "See what's new" },
    { label: "Contrax Grants", body: "Find federal grants your organization qualifies for. No cost for verified nonprofits.", href: "/grants", cta: "Search grants" },
  ];
  return (
    <section aria-label="More from Contrax" className="mx-auto mt-12 mb-12 grid max-w-[1120px] gap-4 px-4 sm:px-6 md:grid-cols-2">
      {items.map((it) => (
        <a key={it.label} href={it.href} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{it.label}</p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{it.body}</p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-blue-700 dark:text-blue-300">{it.cta} →</span>
        </a>
      ))}
    </section>
  );
}

// Contrax Launchpad (owner 2026-10-17): the courses and the Launchpad tools
// presented as one section under the Launchpad name.
const LAUNCHPAD_TOOLS = [
  { title: "Capability statement builder", body: "Build it with a live preview, then print it, save a PDF or email it to yourself." },
  { title: "Registration checklist", body: "Track the registrations, records and certifications your buyers require." },
  { title: "Bid plan", body: "Size up a real opportunity, decide to bid or pass, and set your next step." },
];
const LAUNCHPAD_COURSES = [
  { level: "Introductory · 15 minutes", title: "Government Contracting Basics", body: "Five short lessons on finding bids, set-asides and sizing up opportunities.", href: "/learn/government-contracting", accent: "text-amber-700 dark:text-amber-300", button: "bg-amber-500 text-slate-950 hover:bg-amber-400" },
  { level: "Intermediate · About 65 minutes", title: "Preparing a Government Contract Bid", body: "Eight lessons on capability statements, compliance, pricing and submission.", href: "/learn/intermediate-government-contracting", accent: "text-blue-700 dark:text-blue-300", button: "bg-blue-700 text-white hover:bg-blue-800" },
  { level: "Advanced · About 70 minutes", title: "Government Contracting Strategy and Management", body: "Six lessons on pursuit strategy, teaming, pricing risk and contract performance.", href: "/learn/advanced-government-contracting", accent: "text-emerald-700 dark:text-emerald-300", button: "bg-emerald-700 text-white hover:bg-emerald-800" },
];

function LaunchpadPromo() {
  return (
    <section aria-labelledby="launchpad-title" className="mx-auto mt-12 max-w-[1120px] px-4 sm:px-6">
      <div className="overflow-hidden rounded-2xl border border-[#dde3ec] bg-white dark:border-[#24334f] dark:bg-slate-900">
        <div className="bg-gradient-to-br from-[#0b1f45] via-[#12357a] to-[#0b1f45] p-6 text-white sm:p-8">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Free · Self-paced · No account needed</p>
          <h2 id="launchpad-title" className="mt-2 text-3xl font-bold">Contrax Launchpad</h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-200">
            Everything you need to go after your first government contract, in one place: three courses with completion
            certificates, a capability statement builder, a registration checklist and a bid plan.
          </p>
          <a href="/launchpad" onClick={() => trackEvent("launchpad_home_click")} className="mt-5 inline-flex rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
            Open Contrax Launchpad →
          </a>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {LAUNCHPAD_TOOLS.map((t) => (
              <div key={t.title} className="rounded-xl border border-white/15 bg-white/5 p-4">
                <h3 className="font-bold text-white">{t.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Courses</h3>
          <div className="mt-4 grid gap-5 lg:grid-cols-3">
            {LAUNCHPAD_COURSES.map((c) => (
              <article key={c.href} className="flex flex-col rounded-xl border border-slate-200 p-5 dark:border-slate-700">
                <p className={`text-xs font-bold uppercase tracking-wide ${c.accent}`}>{c.level}</p>
                <h4 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{c.title}</h4>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{c.body} Includes quizzes and a printable certificate.</p>
                <a href={c.href} aria-label={`Start course: ${c.title}`} className={`mt-4 self-start rounded-xl px-5 py-3 text-sm font-bold transition ${c.button}`}>
                  Start course →
                </a>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────
// The shared public header; it resolves the viewer in the browser.

function Navbar() {
  // No `user` prop: SiteHeader resolves the viewer client-side after mount, so
  // the server render is session-free and edge-cacheable.
  return <SiteHeader />;
}

// ── Bid Scout callout ($99/month, same price as /bid-scout) ───────────────────

function BidScoutCallout() {
  return (
    <section id="scout" className="scroll-mt-4 pt-18">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <div className="grid items-center gap-9 rounded-[14px] bg-[#0f2747] p-7 text-white md:grid-cols-[1.15fr_.85fr] md:gap-10 md:p-11 dark:bg-[#0a1930]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-[#e0c078]">
              Bid Scout · done for you
            </p>
            <h2 className={`${SERIF} mt-3 text-[clamp(26px,3.4vw,34px)] leading-[1.15] font-bold`}>
              Five handpicked federal bids, every Friday
            </h2>
            <p className="mt-4 max-w-[32em] text-[#b9c7dc]">
              Skip the searching. Each Friday we send five open federal opportunities that fit your
              trade, with the deadline, what's required, and why it's a match.
            </p>
          </div>
          <div className={`${CARD} p-6`}>
            <div className="font-[Georgia,serif] text-[40px] font-bold">
              $99<small className="text-base font-normal text-[#56647a] dark:text-[#9fb0c8]"> / month</small>
            </div>
            <div>Cancel anytime.</div>
            <a href="/bid-scout?source=homepage" className={`${BTN} no-underline`}>
              Start Bid Scout
            </a>
            <div className="mt-3.5 text-sm text-[#56647a] dark:text-[#9fb0c8]">
              Want a second opinion on one bid? A one-page{" "}
              <a href="/bid-fit-review" className="underline">Bid Fit Review</a> is $49 once.
            </div>
            <div className="mt-2 text-sm text-[#56647a] dark:text-[#9fb0c8]">
              Get found by prime contractors:{" "}
              <a href="/suppliers/join?source=homepage" className="underline">add your company to the supplier directory</a>.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

const FOOTER_GROUPS = [
  {
    title: "Explore",
    links: [
      { href: "/local-bids", label: "City & County Bids" },
      { href: "/grants", label: "Grants" },
      { href: "/contract-payments", label: "Payments Tracker" },
      { href: "/blog", label: "Blog" },
    ],
  },
  {
    title: "For Businesses",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/data", label: "Bid Data API" },
      { href: "/leads", label: "Award Leads" },
      { href: "/suppliers", label: "Supplier Directory" },
    ],
  },
  {
    title: "About Contrax",
    links: [
      { href: "/about", label: "About" },
      { href: "/our-story", label: "Our Story" },
      { href: "/from-the-ceo", label: "From the CEO" },
      { href: "/vad", label: "Veterans Against Diabetes" },
      { href: "mailto:contrax.companyllc@gmail.com", label: "Contact" },
    ],
  },
];

const FOOTER_LEGAL_LINKS = [
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

function Footer() {
  const linkClass = "inline-block rounded-sm py-1 leading-6 hover:text-[#0f1f38] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current dark:hover:text-white";
  return (
    <footer className="pt-14 pb-9 text-sm text-[#56647a] dark:text-[#9fb0c8]">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <nav aria-label="Footer" className="grid grid-cols-1 gap-8 border-t border-[#dde3ec] py-8 sm:grid-cols-3 sm:gap-10 dark:border-[#24334f]">
          {FOOTER_GROUPS.map((group) => (
            <div key={group.title} className="min-w-0">
              <h2 className="mb-3 font-semibold text-[#0f1f38] dark:text-white">{group.title}</h2>
              <ul className="m-0 list-none space-y-1 p-0">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className={linkClass}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="flex flex-col gap-4 border-t border-[#dde3ec] pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-[#24334f]">
          <span>&copy; {new Date().getFullYear()} Contrax LLC</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-1">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <a key={link.href} href={link.href} className={linkClass}>{link.label}</a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
