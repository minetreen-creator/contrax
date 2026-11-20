import { SUPPLIER_ANY_STATE_NOTE, SUPPLIER_SAMPLE_COUNT_WORD, SUPPLIER_CLOSING_NOTE, SUPPLIER_FINE_PRINT_SHORT, SUPPLIER_HOME_ROW_STATES, SUPPLIER_INCLUDES, SUPPLIER_SUBHEAD, SUPPLIER_SAMPLE_STATES, supplierDay, supplierMoney, type SupplierSample } from "~/lib/supplier-report";
import { SupplierRequestForm } from "~/components/SupplierRequestForm";
import { PrivateBidsBlock } from "~/components/PrivateBidsBlock";
import { WinnersListOffer } from "~/components/WinnersListOffer";
import { createFileRoute } from "@tanstack/react-router";
import { HomeMaxProof } from "~/components/HomeMaxProof";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { ArrowRight } from "lucide-react";
import { HomeBidPreview } from "~/components/HomeBidPreview";
import { HomeContractFinder } from "~/components/HomeContractFinder";
import { HomeStateMap } from "~/components/HomeStateMap";

import { trackEvent } from "~/lib/track";
import { BRAND_MESSAGE, BRAND_STEPS } from "~/lib/brand-message";
import { BID_PREP_DELIVERY, BID_PREP_INCLUDES, BID_PREP_MIN_DAYS, BID_PREP_NO_PROMISE, BID_PREP_PRICE, BID_PREP_YOU_PROVIDE } from "~/lib/bid-prep";
import { STARTER_PASS_ANCHOR, STARTER_PASS_NOTE } from "~/lib/starter-pass";
import { SiteHeader } from "~/components/SiteHeader";
import { PUBLIC_OPEN_BIDS_WHERE } from "~/lib/open-count";
import {
  buildContractMap,
  type ContractMapAggregate,
} from "~/lib/contract-map";
import { getEverydaySample, type EverydaySampleBid } from "~/lib/sample-bids";
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
        WHERE ${sql().unsafe(PUBLIC_OPEN_BIDS_WHERE)}
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
export const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
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

const getSupplierSamples = createServerFn({ method: "GET" }).handler(async (): Promise<SupplierSample[]> => {
  const { loadSupplierSamples } = await import("~/lib/supplier-report.server");
  return loadSupplierSamples(SUPPLIER_SAMPLE_STATES);
});

// ── Route ─────────────────────────────────────────────────────────────────────

// Owner 2026-11-18 ("yes"): the site leads with the report for businesses that sell to contractors;
// a month of contractor traffic searched and did not pay. Contractors keep their search, lower down.
const PAGE_TITLE = "Contrax | The public construction jobs opening in your state, every week";
const PAGE_DESCRIPTION =
  "For suppliers, equipment rental, staffing and bonding firms: a weekly report of the public construction jobs opening in your state, federal awards and who won them. Contractors can search open government bids by trade and state.";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [landing, sample, supplierSamples] = await Promise.all([getLandingData(), getEverydaySample(), getSupplierSamples()]);
    return { ...landing, sample, supplierSamples };
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

  const { contractMap } = Route.useLoaderData();
  const { sample, supplierSamples } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    legalName: "Contrax LLC",
    description:
      "Contrax sends businesses that sell to contractors a weekly report of the public construction jobs opening in their state. It also helps businesses win government work two ways. Contractors and small businesses search open bids from cities, counties, school districts, state and federal agencies, matched to their trade and state. Companies with a sales team get a prepared report of the federal contracts ending in their line of work, who holds them and the open bids that fit.",
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
          proof → the $9 pass → the state map. The the
          Pathway, app, megaprojects and the extra tool links moved to their own pages and the footer. */}
      {/* Owner 2026-11-14 ("equal"): two customers, so the page opens with the choice between them,
          each with the same weight; the bid search follows as the do-it-yourself side's first step. */}
      {/* Owner 2026-11-18 ("do all"): the homepage is about one customer. Suppliers get the hero, real
          rows and the form; contractors get one block with the search, and everything else that was
          here lives on /contractors (ContractorSections below), one click away. */}
      <HomeSupplierHero samples={supplierSamples} />
      {supplierSamples.slice(0, SUPPLIER_HOME_ROW_STATES).map((one) => (
        <HomeSupplierRows key={one.state} sample={one} />
      ))}
      {/* Owner 2026-11-19 ("put this on the homepage"): the $29 state winners list, right under the sample winners. */}
      <section className="bg-[#f5f7fa] px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <WinnersListOffer source="/" place="home" />
        </div>
      </section>
      <HomePrivateBids />
      <section aria-labelledby="home-contractors-title" className="bg-[#07162e] px-4 pb-2 pt-8 text-white sm:px-8 sm:pt-10">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For contractors</p>
          <h2 id="home-contractors-title" className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl">Looking for government work to bid on?</h2>
          <p className="mt-2 text-sm text-slate-300">
            Pick your trade and state below.{" "}
            <a href="/contractors" className="font-semibold text-amber-400 underline underline-offset-4 hover:text-amber-300">
              Bid Prep, the $9 pass and everything else for contractors →
            </a>
          </p>
        </div>
      </section>
      <HomeContractFinder sample={sample} openTotal={contractMap?.totals?.totalOpen ?? 0} heading="h2" />
      <Footer />
    </div>
  );
}

// Two customers, equal billing (owner 2026-11-14: "equal"). The site teaches a contractor to win the
// work themselves, and prepares the research for a company that would rather read one report.
// The choice is the first thing on the page; neither card is styled as the main one.
export const HOME_HEADLINE = "Win government work. Find it yourself, or have it prepared for you.";
const HOME_LANES = [
  {
    key: "diy",
    tag: "Do it yourself",
    title: "I want to find and win the work myself",
    detail: "Search open bids in your trade and state, get the new ones by email each morning, and let Contrax show you how to bid.",
    who: "For contractors and small businesses",
    cta: "Search open bids",
    href: "#find-bids",
    moreLabel: "Also:",
    more: [
      { label: "City and county bids", href: "/local-bids?source=home_lane" },
      { label: "Pricing", href: "/pricing?source=home_lane" },
      // Owner 2026-11-17: the paperwork service is offered from the top of the page, not only lower down.
      { label: "$199 Bid Prep", href: "#bid-prep" },
    ],
  },
  {
    key: "dfy",
    // Owner 2026-11-17: "Done for you" now names Bid Prep alone; this card is the reports for sales teams.
    tag: "Expiring contract reports",
    title: "Show me the contracts ending in my trade",
    // Owner 2026-11-16: name the scale. Every figure here is in REPORT_INCLUDES (src/lib/pipeline-report.ts).
    detail: "We send a report of the federal contracts ending in your line of work over the next 12 months: the 25 largest with who holds each one, the agency and the value, and the 10 companies holding the most. One report or every month.",
    who: "For companies with someone who sells to government",
    cta: "Read a real report",
    // Show the report before the price.
    href: "/sample-report?source=home_lane",
    // A cleaning or HVAC contractor should land on numbers their own size, not federal IT.
    moreLabel: "Samples by trade:",
    more: [
      { label: "Janitorial", href: "/sample-report?m=va-janitorial&source=home_lane" },
      { label: "HVAC and plumbing", href: "/sample-report?m=tx-hvac&source=home_lane" },
      { label: "IT services", href: "/sample-report?source=home_lane_it" },
    ],
  },
];

/**
 * Everything the homepage showed contractors before 2026-11-18, in the same order. Rendered by
 * /contractors (src/routes/contractors.tsx); the homepage keeps only the search.
 */
export function ContractorSections({
  sample,
  contractMap,
  maxProofCurrent,
}: {
  sample: EverydaySampleBid[];
  contractMap: Parameters<typeof HomeStateMap>[0]["contractMap"];
  maxProofCurrent: boolean;
}) {
  return (
    <>
      <HomeChoice heading="h1" />
      <HomeContractFinder sample={sample} openTotal={contractMap?.totals?.totalOpen ?? 0} heading="h2" />
      <HomeBidPreview />
      <HomeBidPrep />
      <HomeExecutionLine sample={sample} />
      {maxProofCurrent !== false ? <HomeMaxProof /> : null}
      <StarterPassStrip />
      <HomeStateMap contractMap={contractMap} />
    </>
  );
}

/**
 * Businesses taking bids (owner 2026-11-18, "do all 5"): the two owners asked that day both said yes
 * to a free listing at once, and one drew a contractor's inquiry within hours. Shows only published
 * requests (~/lib/private-bids); nothing renders when there are none.
 */
function HomePrivateBids() {
  return <PrivateBidsBlock variant="home" />;
}

/** Real rows under the supplier hero: this week's new jobs and the latest federal awards. Nothing when there are none. */
function HomeSupplierRows({ sample }: { sample: SupplierSample }) {
  if (sample.newJobs.length === 0 && sample.awards.length === 0) return null;
  return (
    <section aria-label={`${sample.stateName} this week`} className="bg-white px-4 py-6 text-slate-900 sm:px-8 sm:py-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
        {sample.newJobs.length > 0 && (
          <div>
            <h2 className="text-lg font-bold">New in {sample.stateName} this week</h2>
            <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
              {sample.newJobs.slice(0, 4).map((j) => (
                <li key={j.id} className="px-4 py-3">
                  <a href={`/bid/${j.id}`} className="font-semibold text-slate-900 underline-offset-4 hover:underline">{j.title}</a>
                  <p className="text-sm text-slate-600">{j.agency}{j.agency ? " · " : ""}bids due {supplierDay(j.due)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sample.awards.length > 0 && (
          <div>
            <h2 className="text-lg font-bold">Just awarded in {sample.stateName} (federal)</h2>
            <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
              {sample.awards.slice(0, 3).map((a, i) => (
                <li key={i} className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{a.company}{a.where ? ` (${a.where})` : ""}: {supplierMoney(a.amount)}</p>
                  <p className="text-sm text-slate-600">{a.what}{a.what ? " · " : ""}awarded {supplierDay(a.date)}</p>
                  {a.address && <p className="text-sm text-slate-600">{a.address}</p>}
                  {a.contact && <p className="text-sm text-slate-600">Contact on file: {a.contact}</p>}
                  <p className="text-sm">
                    {a.site && (
                      <>
                        <a href={a.site} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-900">Company website →</a>
                        <span className="text-slate-400"> · </span>
                      </>
                    )}
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-900">Federal award record →</a>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function HomeChoice({ heading = "h2" }: { heading?: "h1" | "h2" }) {
  const Title = heading;
  return (
    <section aria-labelledby="home-choice-title" className="bg-[#07162e] px-4 pb-2 pt-8 text-white sm:px-8 sm:pt-12">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For contractors</p>
        <Title id="home-choice-title" className="mt-2 max-w-4xl text-[1.5rem] font-extrabold leading-[1.12] tracking-tight [text-wrap:balance] sm:text-4xl">
          {HOME_HEADLINE}
        </Title>
        <ul className="mt-6 grid gap-3 sm:mt-8 sm:grid-cols-2">
          {HOME_LANES.map((lane) => (
            <li key={lane.key}>
              <a
                href={lane.href}
                onClick={() => trackEvent("home_lane_click", lane.key)}
                className="group flex flex-col rounded-2xl border border-white/15 bg-white/5 p-5 transition hover:-translate-y-0.5 hover:border-amber-400 hover:bg-white/10 sm:min-h-[15rem]"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">{lane.tag}</span>
                <span className="mt-1 text-lg font-bold sm:text-xl">{lane.title}</span>
                <span className="mt-1 text-sm text-slate-300">{lane.detail}</span>
                <span className="mt-2 text-xs text-slate-400">{lane.who}</span>
                <span className="mt-auto pt-3 text-sm font-semibold text-amber-300 group-hover:text-amber-200">{lane.cta} →</span>
              </a>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-400">
                <span>{lane.moreLabel}</span>
                {lane.more.map((m) => (
                  <a key={m.href} href={m.href} onClick={() => trackEvent("home_lane_click", `${lane.key}_more`)} className="font-semibold text-slate-200 underline underline-offset-2 hover:text-amber-300">
                    {m.label}
                  </a>
                ))}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Bid Prep on the homepage (owner 2026-11-17: "shouldn't the bid prep be on the homepage?"). The
 * service is bought on a bid's own page, so this says what it is and sends the visitor to pick a bid.
 * Every line comes from src/lib/bid-prep.ts, the same words the bid page and the checkout use.
 */
function HomeSupplierHero({ samples }: { samples: SupplierSample[] }) {
  return (
    <section id="suppliers" aria-labelledby="home-suppliers-title" className="bg-slate-950 px-4 py-10 text-white sm:px-8 sm:py-16">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For businesses that sell to contractors</p>
          <h1 id="home-suppliers-title" className="mt-3 text-[1.75rem] font-extrabold leading-[1.12] tracking-tight [text-wrap:balance] sm:text-5xl">
            Know which public jobs are opening in your state before your competitors do
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
            {SUPPLIER_SUBHEAD}
          </p>
          <ul className="mt-5 space-y-2 text-sm text-slate-200 sm:text-base">
            {SUPPLIER_INCLUDES.map((f) => (
              <li key={f} className="flex gap-2"><span aria-hidden className="text-amber-400">✓</span><span>{f}</span></li>
            ))}
          </ul>
          {samples.length > 0 && (
            <table className="mt-6 w-full max-w-lg text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-400">
                  <th scope="col" className="pb-2 font-normal">Public construction jobs</th>
                  <th scope="col" className="pb-2 font-normal">Open now</th>
                  <th scope="col" className="pb-2 font-normal">New this week</th>
                  <th scope="col" className="pb-2 font-normal">Closing in 7 days</th>
                </tr>
              </thead>
              <tbody>
                {/* Largest first (2026-11-20): the reader sees the biggest states before the smallest. */}
                {[...samples].sort((a, b) => b.open - a.open).map((one) => (
                  <tr key={one.state} className="border-t border-white/10">
                    <th scope="row" className="py-2 font-semibold">{one.stateName}</th>
                    <td className="py-2 text-xl font-bold">{one.open}</td>
                    <td className="py-2 text-xl font-bold">{one.newThisWeek}</td>
                    <td className="py-2 text-xl font-bold">{one.closingSoon}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 max-w-lg text-sm text-slate-300">{SUPPLIER_CLOSING_NOTE}</p>
          <p className="mt-2 max-w-lg text-sm text-slate-400">{SUPPLIER_ANY_STATE_NOTE}</p>
          <p className="mt-4 text-sm text-slate-300">
            <a href="/suppliers#sample" className="font-semibold text-amber-400 underline underline-offset-4 hover:text-amber-300">See this week's full sample for all {SUPPLIER_SAMPLE_COUNT_WORD} states →</a>
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {SUPPLIER_FINE_PRINT_SHORT}{" "}
            <a href="/suppliers" className="underline underline-offset-2 hover:text-slate-200">What is in the report</a>
          </p>
        </div>
        <SupplierRequestForm where="home_hero" />
      </div>
    </section>
  );
}

function HomeBidPrep() {
  return (
    <section id="bid-prep" aria-labelledby="home-bid-prep-title" className="mx-auto max-w-[1120px] scroll-mt-20 px-4 pt-10 sm:px-6">
      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5 sm:p-7 dark:bg-emerald-950/30">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Done-for-you Bid Prep · {BID_PREP_PRICE} one time</p>
        <h2 id="home-bid-prep-title" className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">Found a bid but hate the paperwork? We prepare it for you.</h2>
        <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">You put in your prices and sign. We handle every form, compliance check and attachment.</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-sm font-bold">What we do</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
              {BID_PREP_INCLUDES.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold">What you provide</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
              {BID_PREP_YOU_PROVIDE.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm font-bold">When you get it</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
              <li>⏱ Delivered within {BID_PREP_DELIVERY} of your company details, and before your deadline</li>
              <li>💵 Send your details within a day of paying. If we then miss the deadline, you get a full refund</li>
            </ul>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{BID_PREP_NO_PROMISE}</p>
          </div>
        </div>
        <a
          href="#find-bids"
          onClick={() => trackEvent("home_bid_prep_click", "find")}
          className="mt-5 inline-block rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-500"
        >
          Pick a bid for us to prepare →
        </a>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Offered on state, county, city and school bids with {BID_PREP_MIN_DAYS} or more days left. Open the bid and press "Prepare this bid for me".
        </p>
      </div>
    </section>
  );
}

// "From opportunity to execution." (owner 2026-11-10): Contrax doesn't stop at the bid list.
function HomeExecutionLine({ sample = [] }: { sample?: EverydaySampleBid[] }) {
  // Owner 2026-11-16: the same search link appeared four times in two scrolls. Step 1 now shows what
  // arrives each morning, built from the same real open bids as the examples above; never invented.
  const morning = sample.slice(0, 2);
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
              {i === 0 && morning.length > 0 ? (
                <span className="mt-3 block rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Your morning email · real bids open today</span>
                  {morning.map((b) => (
                    <span key={b.id} className="mt-2 block border-t border-slate-200 pt-2 text-xs dark:border-slate-700">
                      <span className="block font-semibold text-slate-900 line-clamp-1 dark:text-white">{b.title}</span>
                      <span className="block text-slate-500 dark:text-slate-400">{[b.trade, b.location].filter(Boolean).join(" · ")}</span>
                    </span>
                  ))}
                </span>
              ) : null}
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
      {/* Owner 2026-11-14: tell teams that already work in an AI assistant that Contrax plugs into it. */}
      <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-300">
        Use an AI assistant?{" "}
        <a href="/teams?source=home_ai#ai" onClick={() => trackEvent("home_ai_click", "connect")} className="font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300">
          Connect Contrax to Claude and other assistants →
        </a>
      </p>
    </section>
  );
}

// The $5 Starter pass offer (src/lib/starter-pass.ts), one compact strip.
function StarterPassStrip({ where = "strip" }: { where?: "strip" | "closing" }) {
  return (
    <section aria-label={where === "closing" ? "Start Contrax Starter for $9" : "Contrax Starter for $9"} className={`mx-auto max-w-[1120px] px-4 sm:px-6 ${where === "closing" ? "mt-12 mb-12" : "mt-8"}`}>
      <div className="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-blue-900 dark:bg-blue-950/40">
        <div>
          <p className="text-lg font-bold text-slate-900 dark:text-white">📬 New bids in your trade, in your inbox every morning at 6 AM</p>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            Auto-Pilot reads each one against your business and leads with the best fits: pursue, partner or pass, and why.
          </p>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{STARTER_PASS_NOTE}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{STARTER_PASS_ANCHOR}</p>
        </div>
        <a
          href="/pricing?source=home_strip"
          onClick={() => trackEvent("home_starter_pass_click", where)}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500"
        >
          Start for $9 <ArrowRight aria-hidden="true" className="h-4 w-4" />
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
      // Owner 2026-11-18: suppliers lead the site; contractors have their own page.
      { href: "/suppliers", label: "For suppliers" },
      { href: "/contractors", label: "For contractors" },
      { href: "/private-bids", label: "Private bid requests" },
      { href: "/radar", label: "Search bids" },
      { href: "/local-bids", label: "City & County Bids" },
      { href: "/pricing", label: "Pricing" },
      // Owner 2026-11-14 ("teams arent on the footer"): one link, here, so the four columns stay
      // about the same length (owner 2026-11-11).
      { href: "/teams", label: "For sales teams" },
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

// Owner 2026-11-14: the comparison pages get footer links without a fifth column, so the four
// columns stay about the same length (owner 2026-11-11). One row under them.
const FOOTER_COMPARE_LINKS = [
  { href: "/compare/highergov", label: "Contrax vs. HigherGov" },
  { href: "/compare/govtribe", label: "Contrax vs. GovTribe" },
  { href: "/compare/cleatus", label: "Contrax vs. CLEATUS" },
  { href: "/compare", label: "All comparisons" },
];

export function Footer() {
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
        <nav aria-label="Compare" className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-[#dde3ec] py-4 dark:border-[#24334f]">
          <span className="font-semibold text-[#0f1f38] dark:text-white">Compare</span>
          {FOOTER_COMPARE_LINKS.map((link) => (
            <a key={link.href} href={link.href} className={linkClass}>{link.label}</a>
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
