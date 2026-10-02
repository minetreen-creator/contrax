import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useState } from "react";

import { trackEvent } from "~/lib/track";
import { SiteHeader } from "~/components/SiteHeader";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import {
  buildContractMap,
  STATE_NAMES,
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
import { getSdvosbSample, type SampleBid } from "~/lib/sample-bids";
import { US_STATES } from "~/lib/states";

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
// Returns null when the query fails (DB unreachable, bids table missing) so a
// database blip hides the stats row instead of 500-ing the public homepage.
// Never substitute a zero or made-up count: the row is simply omitted.
const getContractMapAggregate = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContractMapAggregate | null> => {
    try {
      const { sql } = await import("~/db");
      const rows = await sql()`
        SELECT location, set_aside, estimated_value, agency, category, due_date
        FROM bids
        WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
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
// no DB query and no network call. The homepage is edge-cached for 1 hour
// (owner 2026-10-02, ssr-cache-policy), so a flag flip reaches the cached
// copy within the TTL.
//
// NO SESSION READ (owner 2026-10-02): the navbar resolves the viewer in the
// browser (SiteHeader without a `user` prop), so this render is identical for
// every visitor and can be served from the edge cache.
const getLandingData = createServerFn({ method: "GET" }).handler(async () => {
  const [businessName, bidStats, contractMap, grantsUpgradeEnabled] = await Promise.all([
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
    // Server-only, per-request env read (the `typeof process` guard mirrors the
    // /api/grants/search one). Never throws — see resolveGrantsUpgradeEnabled.
    (async () =>
      resolveGrantsUpgradeEnabled(
        typeof process !== "undefined" ? process.env : undefined,
      ))(),
  ]);
  return { businessName, bidStats, contractMap, grantsUpgradeEnabled };
});

// ── Route ─────────────────────────────────────────────────────────────────────

const PAGE_TITLE = "Contrax | Find federal bids your SDVOSB can actually win";
const PAGE_DESCRIPTION =
  "Tell us your trade and state. Contrax searches federal, state, and local solicitations and shows you the ones that fit, with source links and real deadlines. Free to search, no account required.";

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
// Static, self-contained announcement band rendered at the very top of the
// homepage (above the Navbar). Pure presentational copy — no buttons, no
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

  const { bidStats, contractMap, grantsUpgradeEnabled } = Route.useLoaderData();
  const { sample } = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Contrax",
    legalName: "Contrax LLC",
    description:
      "Tell Contrax what your business does. Radar finds government opportunities that match — live set-asides for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses, with bid documents explained and proposals drafted so certified firms can compete and win.",
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
      <PartnershipBanner />
      <Navbar />
      <Hero sample={sample} />
      <Stats bidStats={bidStats} contractMap={contractMap} />
      <Steps />
      <BidScoutCallout />
      {/* Kept light in both themes: the grants table is owner-locked light markup. */}
      <div className="mt-10 bg-[#f5f7fa] py-8 text-slate-900">
        <ContraxGrantsPromo grantsUpgradeEnabled={grantsUpgradeEnabled} />
      </div>
      <Footer />
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────
// The shared public header; it resolves the viewer in the browser.

function Navbar() {
  // No `user` prop: SiteHeader resolves the viewer client-side after mount, so
  // the server render is session-free and edge-cacheable.
  return <SiteHeader />;
}

// ── Hero: search form + live SDVOSB sample ────────────────────────────────────

// Each option's `q` is what /radar's trade box receives (?trade=); /radar
// expands it to NAICS codes. "Other" sends no trade so Radar asks for a NAICS.
const TRADES = [
  { label: "Janitorial", q: "janitorial" },
  { label: "Landscaping", q: "landscaping" },
  { label: "Trucking and hauling", q: "trucking" },
  { label: "Construction", q: "construction" },
  { label: "Security guards", q: "security guard" },
  { label: "IT services", q: "IT services" },
  { label: "Other (type your trade on the next step)", q: "" },
];

const SORTED_STATES = [...US_STATES].sort((a, b) =>
  (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b),
);

function formatDue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Hero({ sample }: { sample: SampleBid[] }) {
  const navigate = useNavigate();
  const [trade, setTrade] = useState(TRADES[0].q);
  const [state, setState] = useState("");

  const onSearch = () => {
    trackEvent("homepage_radar_cta_clicked", "hero_primary");
    // Results first (owner 2026-10-02): /radar scans as soon as it receives a
    // trade, with its broad defaults (Small Business, any size). No cert is
    // sent: an SDVOSB-only filter hides the unrestricted and state/local bids a
    // veteran-owned firm can also bid; the visitor narrows it on the results.
    const search: Record<string, string> = {};
    if (trade) search.trade = trade;
    if (state) search.state = state;
    navigate({ to: "/radar", search: search as never });
  };

  const select =
    "w-full rounded-lg border border-[#dde3ec] bg-[#f5f7fa] px-2.5 py-3 text-base text-[#0f1f38] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#8fbaf5] dark:border-[#24334f] dark:bg-[#0b1424] dark:text-[#e7edf7]";

  return (
    <section className="bg-gradient-to-b from-[#0f2747] to-[#173763] pt-11 pb-20 text-white md:pt-16 md:pb-22 dark:from-[#0a1930] dark:to-[#10264a]">
      <div
        className={`mx-auto grid max-w-[1120px] items-center gap-9 px-4 sm:px-6 ${
          sample.length ? "md:grid-cols-[1.05fr_.95fr] md:gap-14" : ""
        }`}
      >
        <div>
          <h1 className={`${SERIF} text-[clamp(34px,4.6vw,52px)] leading-[1.15] font-bold tracking-[-.015em]`}>
            Find federal bids your SDVOSB can actually win
          </h1>
          <p className="mt-5 mb-7 max-w-[31em] text-lg text-[#b9c7dc]">
            Tell us your trade and state. We search federal, state, and local solicitations and show
            you the ones that fit, with source links and real deadlines.
          </p>
          <form
            className={`${CARD} max-w-[500px] p-[22px]`}
            aria-label="Contract search"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="home-trade" className="mb-1.5 block text-[13px] font-semibold">Your trade</label>
                <select id="home-trade" className={select} value={trade} onChange={(e) => setTrade(e.target.value)}>
                  {TRADES.map((t) => (
                    <option key={t.label} value={t.q}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="home-state" className="mb-1.5 block text-[13px] font-semibold">Your state</label>
                <select id="home-state" className={select} value={state} onChange={(e) => setState(e.target.value)}>
                  <option value="">Any state</option>
                  {SORTED_STATES.map((code) => (
                    <option key={code} value={code}>{STATE_NAMES[code] ?? code}</option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className={BTN}>See my matches</button>
            <small className="mt-3 block text-[13px] text-[#56647a] dark:text-[#9fb0c8]">
              Sources linked on every result. No invented deadlines or eligibility. Free to search, no
              account required.
            </small>
          </form>
          <p className="mt-4 text-[15px] text-[#b9c7dc]">
            Prefer it delivered?{" "}
            <a href="#scout" className="text-white underline">Get Friday picks</a>
          </p>
        </div>

        {sample.length > 0 && (
          <aside className={`${CARD} overflow-hidden`} aria-label="Open SDVOSB set-asides">
            <div className="border-b border-[#dde3ec] px-[22px] py-[18px] dark:border-[#24334f]">
              <h2 className={`${SERIF} text-xl leading-[1.15] font-bold`}>
                Open SDVOSB set-asides, closing soon
              </h2>
              <div className="mt-1 text-[13px] text-[#56647a] dark:text-[#9fb0c8]">
                Live from today's data · free to search
                <span className="ml-1.5 inline-block rounded-full bg-[#f6eed9] px-2 py-0.5 text-xs font-semibold text-[#8a6a1d] dark:bg-[#2b2413] dark:text-[#e0c078]">
                  SDVOSB set-aside
                </span>
              </div>
            </div>
            {sample.map((bid) => (
              <a
                key={bid.id}
                href={`/bid/${bid.id}`}
                className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-[#dde3ec] px-[22px] py-3.5 no-underline last:border-b-0 hover:bg-[#f5f7fa] dark:border-[#24334f] dark:hover:bg-[#0b1424]"
              >
                <b className="line-clamp-2 font-semibold">{bid.title}</b>
                <span className="text-sm font-semibold whitespace-nowrap text-[#b4321f] dark:text-[#f08a76]">
                  {formatDue(bid.due_date) && `Due ${formatDue(bid.due_date)}`}
                </span>
                <span className="col-span-2 text-[13px] text-[#56647a] dark:text-[#9fb0c8]">
                  {[bid.agency, bid.location].filter(Boolean).join(" · ")}
                </span>
              </a>
            ))}
          </aside>
        )}
      </div>
    </section>
  );
}

// ── Live stats (same aggregation as /map; see getLandingData) ─────────────────

function Stats({
  bidStats,
  contractMap,
}: {
  bidStats: { activeCount: number; agencyCount: number };
  contractMap: ContractMapAggregate | null;
}) {
  if (!contractMap) return null;
  const stats = [
    { value: contractMap.totals.totalOpen.toLocaleString("en-US"), label: "open opportunities" },
    { value: bidStats.agencyCount.toLocaleString("en-US"), label: "agencies represented" },
    { value: "Every 4 hours", label: "contract data refreshed" },
  ];
  return (
    <div className="-mt-11">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <div className={`${CARD} grid border border-[#dde3ec] md:grid-cols-3 dark:border-[#24334f]`}>
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`px-[26px] py-[22px] ${
                i > 0 ? "border-t border-[#dde3ec] md:border-t-0 md:border-l dark:border-[#24334f]" : ""
              }`}
            >
              <b className="block font-[Georgia,serif] text-[30px]">{s.value}</b>
              <span className="text-sm text-[#56647a] dark:text-[#9fb0c8]">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

function Steps() {
  const steps = [
    {
      title: "Search your trade",
      body: "Enter your trade and state to see live set-aside solicitations matched to your certification.",
      href: "/radar",
    },
    {
      title: "Read the AI brief",
      body: "Get the mandatory requirements, milestones, and red flags, with citations to the solicitation text.",
      href: "/example-brief",
    },
    {
      title: "Decide before you bid",
      body: "Check the job against your capacity, licensing, and bonding before spending hours on a proposal.",
      href: "/bid-fit-review",
    },
  ];
  return (
    <section className="pt-18">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <h2 className={`${SERIF} max-w-[20em] text-[clamp(26px,3.4vw,34px)] leading-[1.15] font-bold`}>
          From search to bid decision in three steps
        </h2>
        <div className="mt-7 grid gap-5 md:grid-cols-3">
          {steps.map((s) => (
            <a
              key={s.title}
              href={s.href}
              className="block rounded-xl border border-[#dde3ec] bg-white p-6 no-underline hover:border-[#1c5fbf] dark:border-[#24334f] dark:bg-[#131f35] dark:hover:border-[#6aa3f0]"
            >
              <h3 className={`${SERIF} mb-2 text-[19px] leading-[1.15] font-bold`}>{s.title}</h3>
              <p className="m-0 text-[15px] text-[#56647a] dark:text-[#9fb0c8]">{s.body}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
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
              <a href="/bid-fit-review" className="underline">Bid Fit Review</a> is $99 once.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  const links = [
    { href: "/grants", label: "Grants" },
    { href: "/contract-payments", label: "Payments tracker" },
    { href: "/blog", label: "Blog" },
    { href: "/about", label: "About" },
    { href: "/vad", label: "Veterans Against Diabetes Pricing" },
    { href: "/security", label: "Security" },
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
    { href: "mailto:contrax.companyllc@gmail.com", label: "contrax.companyllc@gmail.com" },
  ];
  return (
    <footer className="pt-14 pb-9 text-sm text-[#56647a] dark:text-[#9fb0c8]">
      <div className="mx-auto flex max-w-[1120px] flex-wrap gap-x-6 gap-y-2 border-t border-[#dde3ec] px-4 pt-6 sm:px-6 dark:border-[#24334f]">
        <span>&copy; {new Date().getFullYear()} Contrax LLC</span>
        {links.map((l) => (
          <a key={l.href} href={l.href} className="hover:text-[#0f1f38] dark:hover:text-white">
            {l.label}
          </a>
        ))}
      </div>
    </footer>
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
    <section aria-label="Contrax Grants" className="py-2">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#8a6a1d]">
            Contrax Grants
          </p>
          <h2 className={`${SERIF} mt-3 text-[clamp(26px,3.4vw,34px)] leading-[1.15] font-bold text-[#0f1f38]`}>
            Find grants your organization actually qualifies for.
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[#56647a]">
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

        <p className="mt-6 text-xs text-gray-500">
          Prices in US dollars. Verified nonprofits keep free grant search with no credit card, no
          trial, and no expiration.
        </p>
      </div>
    </section>
  );
}
