import { createFileRoute } from "@tanstack/react-router";
import { HomeMaxProof } from "~/components/HomeMaxProof";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { ArrowRight } from "lucide-react";
import { HomeContractFinder } from "~/components/HomeContractFinder";
import { HomeStateMap } from "~/components/HomeStateMap";

import { trackEvent } from "~/lib/track";
import { BRAND_MESSAGE, BRAND_STEPS } from "~/lib/brand-message";
import { STARTER_PASS_NOTE } from "~/lib/starter-pass";
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
import { getEverydaySample } from "~/lib/sample-bids";
import { MAX_PROOF, maxProofStillCurrent } from "~/lib/max-proof";

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
// "N open opportunities" counter renders from it, and so does the "Spin the
// map" state map (owner 2026-10-29: "Do 3"; an earlier compact map was removed
// 2026-09-23).
//
// NO SESSION READ (owner 2026-10-02): the navbar resolves the viewer in the
// browser (SiteHeader without a `user` prop), so this render is identical for
// every visitor and can be served from the edge cache.
const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const [businessName, bidStats, contractMap] = await Promise.all([
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
  ]);
  // Date accuracy (owner 2026-11-09): the Max example shows only while its bid's due date in the
  // database still matches the example. Hidden on a confirmed mismatch; shown if the check fails.
  let maxProofCurrent = true;
  try {
    const { sql } = await import("~/db");
    const rows = (await sql()`SELECT due_date FROM bids WHERE id = ${MAX_PROOF.bidId}`) as { due_date: string | null }[];
    if (rows.length) maxProofCurrent = maxProofStillCurrent(rows[0].due_date);
  } catch (e) {
    console.warn("[home] Max example date check failed (shown):", (e as Error).message);
  }
  return { businessName, bidStats, contractMap, maxProofCurrent };
});

// ── Route ─────────────────────────────────────────────────────────────────────

const PAGE_TITLE = "Contrax | Your next government customer starts here";
const PAGE_DESCRIPTION =
  "Open government bids for your trade and state, from cities, counties, schools, state and federal buyers. See your best match free. Starter is $5 for 30 days.";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [landing, sample] = await Promise.all([getLandingData(), getEverydaySample()]);
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
      { property: "og:image:width", content: "1254" },
      { property: "og:image:height", content: "1254" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: PAGE_TITLE },
      { name: "twitter:description", content: PAGE_DESCRIPTION },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: PAGE_TITLE },
    ],
    // The customer app manifest (owner 2026-11-08): lets Chrome offer "Install Contrax" on the homepage.
    links: [{ rel: "canonical", href: "https://www.contrax.company" }, { rel: "manifest", href: "/app.webmanifest" }],
  }),
});

// ── Page Component ────────────────────────────────────────────────────────────

// Shared page tokens (2026 redesign). Light values first, dark via `dark:`.

function Home() {

  const { contractMap, maxProofCurrent } = Route.useLoaderData();
  const { sample } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    legalName: "Contrax LLC",
    description:
      "Contrax finds open government bids for small trade businesses (landscaping, janitorial, HVAC, plumbing, welding, construction and more) from cities, counties, school districts, state and federal agencies, matched to your trade and state.",
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
      {/* Homepage cleanup (owner 2026-11-10: "follow your recommendations"): five sections, one path
          down the page. Search → the one message (subs folded into its step 2) → the AI assistant's
          proof → the $5 pass → the state map. The the
          Pathway, app, megaprojects and the extra tool links moved to their own pages and the footer. */}
      <HomeContractFinder sample={sample} openTotal={contractMap?.totals?.totalOpen ?? 0} />
      <HomeExecutionLine />
      {/* Before/after proof (owner 2026-11-08): a real bid's notice next to Max's real answer. */}
      {maxProofCurrent !== false ? <HomeMaxProof /> : null}
      {/* The $5 Starter pass (src/lib/starter-pass.ts): the only offer on the page. */}
      <StarterPassStrip />
      {/* "Spin the map" (owner 2026-10-29: "Do 3"): tap a state, then a trade. */}
      <HomeStateMap contractMap={contractMap} />
      <Footer />
    </div>
  );
}

// "From opportunity to execution." (owner 2026-11-10): Contrax doesn't stop at the bid list.
function HomeExecutionLine() {
  // Owner 2026-11-10: the whole marketing story is one line (src/lib/brand-message.ts).
  return (
    <section aria-labelledby="home-execution-title" className="mx-auto max-w-[1120px] px-4 pt-12 sm:px-6">
      <p className="text-center text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">From opportunity to execution</p>
      <h2 id="home-execution-title" className={`mt-1 text-center text-[clamp(26px,3.4vw,38px)] leading-[1.15] font-bold`}>{BRAND_MESSAGE}</h2>
      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {BRAND_STEPS.map((st, i) => (
          <li key={st.title}>
            <a
              href={`${st.href}?source=home_message`}
              onClick={() => trackEvent("home_message_step_click", String(i + 1))}
              className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300">Step {i + 1}</span>
              <span className="mt-1 text-lg font-bold">{st.title}</span>
              <span className="mt-1 text-sm text-slate-600 dark:text-slate-300">{st.detail}</span>
              <span className="mt-auto pt-3 text-sm font-semibold text-blue-700 group-hover:text-blue-600 dark:text-blue-300">{st.cta} →</span>
            </a>
          </li>
        ))}
      </ol>
      {/* Subs (owner 2026-11-10 cleanup: the separate "find and claim your business" card folded in here). */}
      <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-300">
        A subcontractor?{" "}
        <a href="/sub-finder/join?source=home" onClick={() => trackEvent("home_subs_search", "join")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
          Get listed so contractors find you
        </a>{" "}
        ·{" "}
        <a href="/subs-wanted" onClick={() => trackEvent("home_subs_search", "board")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
          See public or private jobs that need subs →
        </a>
      </p>
    </section>
  );
}

// The $5 Starter pass offer (src/lib/starter-pass.ts), one compact strip.
function StarterPassStrip({ where = "strip" }: { where?: "strip" | "closing" }) {
  return (
    <section aria-label={where === "closing" ? "Start Contrax Starter for $5" : "Contrax Starter for $5"} className={`mx-auto max-w-[1120px] px-4 sm:px-6 ${where === "closing" ? "mt-12 mb-12" : "mt-8"}`}>
      <div className="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-blue-900 dark:bg-blue-950/40">
        <div>
          <p className="text-lg font-bold text-slate-900 dark:text-white">📬 New bids in your trade, in your inbox every morning at 6 AM</p>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            Auto-Pilot reads each one against your business and leads with the best fits: pursue, partner or pass, and why.
          </p>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{STARTER_PASS_NOTE}</p>
        </div>
        <a
          href="/pricing?source=home_strip"
          onClick={() => trackEvent("home_starter_pass_click", where)}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500"
        >
          Start for $5 <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </a>
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

// ── Footer ────────────────────────────────────────────────────────────────────

const FOOTER_GROUPS = [
  {
    title: "Explore",
    links: [
      // Owner 2026-11-03 ("do 2 and 3"): only the search and the $5 pass are
      // offered until there are paying customers; the other products stay
      // reachable by their own links.
      { href: "/radar", label: "Search bids" },
      { href: "/local-bids", label: "City & County Bids" },
      { href: "/pricing", label: "Pricing" },
      { href: "/blog", label: "Blog" },
    ],
  },
  {
    // Owner 2026-11-09: the Contrax Pathway tools.
    title: "Win contracts",
    links: [
      { href: "/pathway", label: "The Contrax Pathway" },
      { href: "/gap-map", label: "Gap Map" },
      { href: "/roadmap", label: "Your Roadmap" },
      { href: "/co-op-contracts", label: "Co-op contracts" },
      // Moved off the homepage (owner 2026-11-10 cleanup).
      { href: "/recompetes", label: "Contracts ending soon" },
    ],
  },
  {
    // Owner 2026-11-11 ("fix this too"): one column held ten links beside two of four. The
    // prime and subcontractor tools get their own column so the four are about even.
    title: "Primes and subs",
    links: [
      { href: "/prime-finder", label: "Prime Finder" },
      { href: "/sub-finder", label: "Sub Finder" },
      { href: "/subs-wanted", label: "Subs Wanted" },
      { href: "/megaprojects", label: "Megaprojects" },
      { href: "/tampa-contractors", label: "Tampa: bids and subs" },
    ],
  },
  {
    title: "About Contrax",
    links: [
      { href: "/about", label: "About" },
      { href: "/our-story", label: "Our Story" },
      { href: "/from-the-ceo", label: "From the CEO" },
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
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-[#dde3ec] py-8 lg:grid-cols-4 lg:gap-10 dark:border-[#24334f]">
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
