import { createFileRoute } from "@tanstack/react-router";
import { HomeMaxProof } from "~/components/HomeMaxProof";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { ArrowRight } from "lucide-react";
import { HomeContractFinder } from "~/components/HomeContractFinder";
import { HomeStateMap } from "~/components/HomeStateMap";
import { PATHWAY_LINE, PATHWAY_STEPS } from "~/lib/pathway";

import { trackEvent } from "~/lib/track";
import { CASA, CASA_PRICE_NOTE, TAMPA_FACTS, TAMPA_HEADLINE, TAMPA_PATH } from "~/lib/tampa";
import { BRAND_MESSAGE, BRAND_STEPS } from "~/lib/brand-message";
import { STARTER_PASS_NOTE } from "~/lib/starter-pass";
import { STARTER_FIRST_MONTH_PRICE as STARTER_PRICE } from "~/lib/starter-offer";
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
import { featuredMegaprojects, MEGA_SECTORS, megaMoney, megaprojectHref, megaTotals, type Megaproject } from "~/lib/megaprojects";

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
// Homepage megaprojects highlight (owner 2026-11-07: "we need to highlight megaprojects on the main
// page"): the newest and biggest entries from the same list /megaprojects shows. Null on any failure,
// so the section simply hides.
const getMegaprojectsHighlight = async (): Promise<{ featured: Megaproject[]; projects: number; amount: number } | null> => {
  try {
    const { default: list } = (await import("../../public/data/megaprojects.json")) as { default: Megaproject[] };
    const totals = megaTotals(list);
    return { featured: featuredMegaprojects(list, 4), projects: totals.projects, amount: totals.amount };
  } catch {
    return null;
  }
};

const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const [businessName, bidStats, contractMap, megaprojects] = await Promise.all([
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
    getMegaprojectsHighlight(),
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
  return { businessName, bidStats, contractMap, megaprojects, maxProofCurrent };
});

// ── Route ─────────────────────────────────────────────────────────────────────

const PAGE_TITLE = "Contrax | Your next government customer starts here";
const PAGE_DESCRIPTION =
  "Open government bids for your trade in your state: cities, counties, school districts, state and federal. See your best match before you sign up. Starter is $5 for 30 days, no automatic renewal.";

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
const SERIF = "[font-family:Charter,'Iowan_Old_Style',Georgia,serif]";

function Home() {

  const { contractMap, megaprojects, maxProofCurrent } = Route.useLoaderData();
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
      <HomeContractFinder sample={sample} openTotal={contractMap?.totals?.totalOpen ?? 0} />
      {/* Owner 2026-11-10 ("one additional message near the top"): the line that ties the cards below together. */}
      <HomeExecutionLine />
      {/* Tampa partnership (owner 2026-11-10: "just below the main hero"): Contrax + Casa Blue Collar. */}
      <HomeTampaPartner />
      {/* Subs for primes (owner 2026-11-10: "below the new partnership card"): find and claim your business. */}
      <HomeSubsJoin />
      {/* The $5 Starter pass, right under the search (owner 2026-10-31 funnel
          check: the homepage never mentioned the offer). Owner 2026-11-09: it now
          also says what the 6 AM email brings (Auto-Pilot), and it is the only one. */}
      <StarterPassStrip />
      {/* The Contrax Pathway (owner 2026-11-09: "clean up the homepage and add these new
          features"): the owner's line and the four steps, in place of "How Contrax works". */}
      <HomePathway />
      {/* Before/after proof (owner 2026-11-08): a real bid's notice next to Max's real answer. */}
      {maxProofCurrent !== false ? <HomeMaxProof /> : null}
      {/* The Contrax app (owner 2026-11-07: "Today is launch day"). */}
      <HomeAppStrip />
      {/* Megaprojects (owner 2026-11-07): the big plants and highway jobs hiring local subs. */}
      {megaprojects ? <HomeMegaprojects {...megaprojects} /> : null}
      {/* Owner 2026-11-02 (design critique, "fix all"): one path down the page,
          sized for a small trade business: search, the $5 pass, how it works,
          the state map, Max, sub leads, and the $5 pass again to close. The
          federal money counter, contracts ending soon and the tools strip
          moved off the homepage (they told a lawn crew "not for you"). */}
      {/* "Spin the map" (owner 2026-10-29: "Do 3"): tap a state, then a trade. */}
      <HomeStateMap contractMap={contractMap} />
      {/* Owner 2026-11-09 ("yes add both links"): the gap map, contracts ending soon and the
          federal bids open to every business (listed apart when a Radar search names a trade). */}
      <ul className="mx-auto mt-4 flex max-w-[1120px] list-none flex-col items-center gap-2 px-4 text-center text-sm sm:px-6">
        <li>
          <a href="/gap-map" onClick={() => trackEvent("home_gap_map_click")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
            Federal money by state: where your trade's spending is big and few companies hold the work →
          </a>
        </li>
        <li>
          <a href="/recompetes" onClick={() => trackEvent("home_recompetes_click")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
            Contracts ending soon: federal work in your trade that will be bid again, and who holds it now →
          </a>
        </li>
        <li>
          <a href="/radar" onClick={() => trackEvent("home_open_to_all_click")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
            Federal bids open to every business, no certification needed: listed apart when you search your trade →
          </a>
        </li>
      </ul>
      {/* Owner 2026-11-09: the second $5 strip at the bottom repeated the first one; removed. */}
      <Footer />
    </div>
  );
}

// The Contrax Pathway on the homepage (owner 2026-11-09): the line and the four steps, each
// linked to its tool (src/lib/pathway.ts). Replaces the 3-card "How Contrax works" and the
// collapsed example AI brief.
function HomePathway() {
  return (
    <section aria-labelledby="pathway-title" className="mx-auto max-w-[1120px] px-4 pt-12 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">The Contrax Pathway</p>
      <h2 id="pathway-title" className={`${SERIF} mt-1 max-w-3xl text-[clamp(22px,2.8vw,30px)] leading-[1.2] font-bold`}>{PATHWAY_LINE}</h2>
      <ol className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PATHWAY_STEPS.map((s) => (
          <li key={s.n}>
            <a
              href={s.href}
              onClick={() => trackEvent("home_pathway_click", s.event)}
              className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 transition sm:p-5 hover:-translate-y-1 hover:border-blue-400 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900"
            >
              {/* Phones: the number sits beside the title and the long description is hidden, so the
                  four steps stay short (owner 2026-11-09: the stacked cards made the page longer). */}
              <div className="flex items-center gap-3 sm:block">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white dark:bg-white dark:text-slate-900">{s.n}</span>
                <h3 className="text-lg font-bold sm:mt-3">{s.name}</h3>
              </div>
              <p className="mt-1 flex-1 text-sm font-semibold text-blue-700 sm:flex-none dark:text-blue-300">{s.question}</p>
              <p className="mt-2 hidden flex-1 text-sm leading-relaxed text-slate-600 sm:block dark:text-slate-300">{s.what}</p>
              <p className="mt-3 flex items-center justify-between gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                {s.cta} <ArrowRight aria-hidden="true" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.access}</p>
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-center text-sm">
        <a href="/pathway" onClick={() => trackEvent("home_pathway_click", "pathway")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
          See the whole Pathway →
        </a>
      </p>
    </section>
  );
}

// Megaprojects highlight: newest and biggest projects from public/data/megaprojects.json.
function HomeMegaprojects({ featured, projects, amount }: { featured: Megaproject[]; projects: number; amount: number }) {
  if (!featured.length) return null;
  return (
    <section aria-labelledby="home-mega-title" className="mx-auto max-w-[1120px] px-4 pt-12 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">🏗️ Megaprojects</p>
          <h2 id="home-mega-title" className={`${SERIF} mt-1 text-[clamp(24px,3vw,30px)] leading-[1.15] font-bold`}>Big projects hiring local subcontractors</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {projects} plants, factories and highway jobs{megaMoney(amount) ? ` worth ${megaMoney(amount)}` : ""}: who's building them and how to get on the sub list.
          </p>
        </div>
        <a href="/megaprojects?source=home" onClick={() => trackEvent("home_megaprojects_click", "all")} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:text-blue-300">
          See all {projects} <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </a>
      </div>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {featured.map((p) => (
          <li key={p.slug}>
            <a
              href={`${megaprojectHref(p)}?source=home`}
              onClick={() => trackEvent("home_megaprojects_click", p.slug)}
              className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-1 hover:border-amber-400 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900"
            >
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {MEGA_SECTORS[p.sector]?.icon} {MEGA_SECTORS[p.sector]?.label} · {p.city}, {p.state}
              </p>
              <p className="mt-2 text-base font-bold leading-snug">{p.company}</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">{p.project}</p>
              {megaMoney(p.amount) ? <p className="mt-3 text-2xl font-extrabold text-emerald-700 dark:text-emerald-400">{megaMoney(p.amount)}</p> : null}
              {p.jobs ? <p className="text-xs text-slate-500 dark:text-slate-400">{p.jobs.toLocaleString("en-US")} jobs</p> : null}
              <p className="mt-auto pt-3 text-sm font-semibold text-blue-700 group-hover:text-blue-600 dark:text-blue-300">How to get on the sub list →</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// "From opportunity to execution." (owner 2026-11-10): Contrax doesn't stop at the bid list.
function HomeExecutionLine() {
  // Owner 2026-11-10: the whole marketing story is one line (src/lib/brand-message.ts).
  return (
    <section aria-labelledby="home-execution-title" className="mx-auto max-w-[1120px] px-4 pt-12 sm:px-6">
      <p className="text-center text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">From opportunity to execution</p>
      <h2 id="home-execution-title" className={`${SERIF} mt-1 text-center text-[clamp(26px,3.4vw,38px)] leading-[1.15] font-bold`}>{BRAND_MESSAGE}</h2>
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
    </section>
  );
}

// Tampa Contractor Support Network (owner 2026-11-09): a partnership with Casa Blue Collar.
// Every figure is TAMPA_FACTS (src/lib/tampa.ts), the same numbers the Tampa page shows.
function HomeTampaPartner() {
  return (
    <section aria-labelledby="home-tampa-title" className="mx-auto max-w-[1120px] px-4 pt-6 sm:px-6">
      <div className="grid gap-5 rounded-3xl border border-slate-200 bg-gradient-to-br from-sky-50 to-white p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr] dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">🌴 New in Tampa · Partnership</p>
          <h2 id="home-tampa-title" className={`${SERIF} mt-1 text-[clamp(24px,3vw,30px)] leading-[1.15] font-bold`}>
            {TAMPA_HEADLINE.win} {TAMPA_HEADLINE.house}, <span className="text-sky-700 dark:text-sky-300">{TAMPA_HEADLINE.saving}*</span>.
          </h2>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Contrax and {CASA.name} teamed up for contractors working Tampa government jobs: open bids, certified local subs, and housing for traveling crews.
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <dt className="sr-only">Federal construction in Tampa</dt>
              <dd className="text-2xl font-extrabold text-slate-900 dark:text-white">{TAMPA_FACTS.federalConstruction}</dd>
              <dd className="text-xs text-slate-600 dark:text-slate-400">federal construction work in Tampa last year</dd>
            </div>
            <div>
              <dt className="sr-only">Share to out-of-state firms</dt>
              <dd className="text-2xl font-extrabold text-slate-900 dark:text-white">{TAMPA_FACTS.outOfStateShare}</dd>
              <dd className="text-xs text-slate-600 dark:text-slate-400">went to firms based outside Florida</dd>
            </div>
            <div>
              <dt className="sr-only">Contracts ending soon</dt>
              <dd className="text-2xl font-extrabold text-slate-900 dark:text-white">{TAMPA_FACTS.endingSoonCount}</dd>
              <dd className="text-xs text-slate-600 dark:text-slate-400">contracts ({TAMPA_FACTS.endingSoonValue}) up for rebid in 12 months</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">
            Need subs for a Tampa job? <strong>{TAMPA_FACTS.registeredContractors}</strong> construction contractors in Tampa are registered for federal work.{" "}
            <a href={`${TAMPA_PATH}?source=home#team`} onClick={() => trackEvent("home_tampa_click", "subs")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
              Find Tampa subs →
            </a>
          </p>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{TAMPA_FACTS.asOf}. Source: {TAMPA_FACTS.source}. *{CASA_PRICE_NOTE}</p>
        </div>
        <div className="flex flex-col justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Housing referral partner</p>
          <p className="text-lg font-bold">{CASA.name}</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{CASA.tagline}: full kitchen, laundry, truck and trailer parking, minutes from the job. {CASA.ask}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {CASA.stats.filter((st) => st.value !== "3x").map((st) => `${st.value} ${st.label}`).join(" · ")} ·{" "}
            <a href={`tel:${CASA.tel}`} onClick={() => trackEvent("tampa_housing_referral_click", "home_phone")} className="font-semibold text-blue-700 dark:text-blue-300">{CASA.phone}</a> · {CASA.spanish}
          </p>
          <a
            href={`${TAMPA_PATH}?source=home`}
            onClick={() => trackEvent("home_tampa_click", "network")}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:bg-white dark:text-slate-900"
          >
            Tampa bids, subs and crew housing <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
          <a
            href={CASA.url}
            target="_blank"
            rel="sponsored noopener"
            onClick={() => trackEvent("tampa_housing_referral_click", "home")}
            className="text-center text-sm font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300"
          >
            Visit {CASA.name} →
          </a>
        </div>
      </div>
    </section>
  );
}

// For subcontractors (owner 2026-11-10): primes look for subs on Sub Finder; find your business
// (SAM.gov registration) and claim it. The search opens /sub-finder/join with the results.
function HomeSubsJoin() {
  return (
    <section aria-labelledby="home-subs-title" className="mx-auto max-w-[1120px] px-4 pt-6 sm:px-6">
      <div className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 lg:grid-cols-[1.2fr_1fr] dark:border-slate-700 dark:bg-slate-900">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">🔨 For subcontractors</p>
          <h2 id="home-subs-title" className={`${SERIF} mt-1 text-[clamp(24px,3vw,30px)] leading-[1.15] font-bold`}>Prime contractors are looking for you</h2>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Over 4,000 primes hold federal subcontracting plans, so they must give part of their government work to small businesses. They use Sub Finder to find local subs by
            trade, state and certification and send quote requests by email.
          </p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Registered in SAM.gov? Your business may already be in Sub Finder, one of over 160,000. Find it and claim it in two minutes.
          </p>
        </div>
        <form action="/sub-finder/join" method="get" onSubmit={() => trackEvent("home_subs_search", "submit")} className="flex flex-col justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950">
          <label className="text-sm font-semibold" htmlFor="home-subs-name">Find your business</label>
          <input id="home-subs-name" name="name" required minLength={3} placeholder="Business name" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 dark:border-slate-600" />
          <button type="submit" className="inline-flex items-center justify-center gap-1 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
            Find and claim it <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
          <a href="/sub-finder/join?source=home" onClick={() => trackEvent("home_subs_search", "join")} className="text-center text-sm font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
            Not registered? Get listed →
          </a>
        </form>
      </div>
    </section>
  );
}

// The Contrax app (owner 2026-11-07): what it does and how to install it,
// step by step, and plainly that phone alerts need a paid plan.
const APP_STEPS: { device: string; steps: string[] }[] = [
  {
    device: "iPhone",
    steps: [
      "Open contrax.company/app in Safari",
      "Tap the Share button ⬆️ at the bottom of the screen",
      "Scroll down and tap Add to Home Screen, then Add",
      "Open Contrax from your home screen, sign in and tap Turn on bid alerts",
    ],
  },
  {
    device: "Android",
    steps: [
      "Open contrax.company/app in Chrome",
      "Tap Install (or the menu ⋮, then Install app)",
      "Open Contrax from your home screen or app drawer",
      "Sign in and tap Turn on bid alerts",
    ],
  },
];

function HomeAppStrip() {
  return (
    <section id="app" aria-labelledby="home-app-title" className="mx-auto max-w-[1120px] px-4 pt-6 sm:px-6">
      <div className="rounded-2xl border border-slate-200 bg-[#0b1220] p-5 text-white sm:p-6 dark:border-slate-700">
        <div className="flex items-center gap-4">
          <img src="/app-icon-192.png" alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-2xl" />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">📱 New: the Contrax app</p>
            <h2 id="home-app-title" className={`${SERIF} text-[clamp(20px,2.6vw,26px)] leading-tight font-bold`}>Your phone buzzes when a bid in your trade posts</h2>
            <p className="mt-1 text-sm text-slate-300">Bids near you, reminders before saved bids are due, and winning prices. No app store: it installs from your browser in seconds.</p>
          </div>
        </div>
        {/* Owner 2026-11-09: the install steps sit behind one tap so they don't take permanent space. */}
        <details className="group mt-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-amber-300 hover:text-amber-200 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">How to install on iPhone or Android ↓</span>
            <span className="hidden group-open:inline">Hide the install steps ↑</span>
          </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {APP_STEPS.map((d) => (
            <div key={d.device} className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <p className="text-sm font-bold text-white">How to install on {d.device}</p>
              <ol className="mt-2 space-y-2 text-sm text-slate-200">
                {d.steps.map((step, i) => (
                  <li key={step} className="flex gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-950">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        </details>
        <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          🔐 <b>Phone alerts need a paid plan.</b> Anyone can install the app and browse bids near them. Bid alerts come with Starter: ${STARTER_PRICE} for your first 30 days, no automatic renewal.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <a
            href="/app?source=home"
            onClick={() => trackEvent("home_app_click", "open")}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
          >
            Open the Contrax app <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
          <a
            href="/upgrade?plan=starter&source=home-app"
            onClick={() => trackEvent("home_app_click", "starter")}
            className="inline-flex items-center justify-center rounded-xl border border-slate-600 px-5 py-3 text-sm font-semibold text-white hover:border-amber-300"
          >
            Get alerts with Starter, ${STARTER_PRICE}
          </a>
        </div>
      </div>
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
      { href: "/gap-map", label: "Opportunity gap map" },
      { href: "/roadmap", label: "Your roadmap" },
      { href: "/prime-finder", label: "Prime contractor finder" },
      { href: "/sub-finder", label: "Sub Finder" },
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
