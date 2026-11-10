import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { money } from "~/lib/gap-map";
import { trackEvent } from "~/lib/track";
import { PATHWAY_LINE, PATHWAY_STEPS as STEPS } from "~/lib/pathway";

/**
 * /pathway — the Contrax Pathway (owner 2026-11-09): four connected capabilities that take a small
 * business from "where is the work?" to winning it, under the owner's positioning line. The figures
 * are live counts from data Contrax already syncs (USAspending.gov and the SBA/GSA prime
 * directories); each is left out if it cannot be read.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "The Contrax Pathway: How to Get Into the Business of Winning Government Contracts";
const DESC =
  "Contrax doesn't just show you government contracts. It shows you how to get into the business of winning them: know your market, get your plan, find the bids that fit, and team with the primes.";

const getPathwayStats = createServerFn({ method: "GET" }).handler(async () => {
  const out: { spend: number | null; fiscalYear: number | null; ending12: number | null; planPrimes: number | null } = {
    spend: null,
    fiscalYear: null,
    ending12: null,
    planPrimes: null,
  };
  try {
    const { sql } = await import("~/db");
    const s = (await sql()`
      SELECT SUM(total_amount)::float8 AS spend, MAX(fiscal_year)::int AS fy FROM federal_trade_spending
      WHERE fiscal_year = (SELECT MAX(fiscal_year) FROM federal_trade_spending)
        -- Cybersecurity's codes (541512, 541519) are inside IT services: counting both would double it.
        AND trade_slug <> 'cybersecurity'
    `) as { spend: number | null; fy: number | null }[];
    out.spend = s[0]?.spend ? Number(s[0].spend) : null;
    out.fiscalYear = s[0]?.fy ?? null;
    const e = (await sql()`
      SELECT COUNT(DISTINCT award_key)::int AS n FROM recompete_contracts WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '12 months'
    `) as { n: number }[];
    out.ending12 = e[0]?.n ?? null;
    const p = (await sql()`SELECT COUNT(DISTINCT uei)::int AS n FROM subcontract_primes`) as { n: number }[];
    out.planPrimes = p[0]?.n ?? null;
  } catch (err) {
    console.warn("[pathway] stats unavailable:", (err as Error).message);
  }
  return out;
});

export const Route = createFileRoute("/pathway")({
  loader: () => getPathwayStats(),
  component: () => (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <PathwayPage />
    </div>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/pathway` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/pathway` }],
  }),
});

function PathwayPage() {
  const stats = Route.useLoaderData();
  const figures = [
    stats.spend ? { value: money(stats.spend), label: `federal spending in the trades Contrax covers${stats.fiscalYear ? ` (FY${stats.fiscalYear})` : ""}` } : null,
    stats.ending12 ? { value: stats.ending12.toLocaleString("en-US"), label: "federal contracts ending in the next 12 months" } : null,
    stats.planPrimes ? { value: stats.planPrimes.toLocaleString("en-US"), label: "prime contractors with subcontracting plans" } : null,
  ].filter(Boolean) as { value: string; label: string }[];

  return (
    <main>
      <section className="bg-gradient-to-b from-slate-900 to-slate-800 px-4 py-14 text-white">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">The Contrax Pathway</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-5xl">{PATHWAY_LINE}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-slate-300">
            Four connected steps: know your market, get your plan, find the bids that fit, and team with the primes that already hold the work.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href="/roadmap" onClick={() => trackEvent("pathway_cta", "roadmap_hero")} className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 hover:bg-slate-100">
              Start with my roadmap
            </a>
            <a href="/gap-map" onClick={() => trackEvent("pathway_cta", "gap_map_hero")} className="rounded-xl border border-slate-500 px-5 py-3 text-sm font-bold text-white hover:border-slate-300">
              See where the work is
            </a>
          </div>
          {figures.length ? (
            <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-3">
              {figures.map((f) => (
                <div key={f.label} className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                  <p className="text-2xl font-extrabold">{f.value}</p>
                  <p className="mt-1 text-xs text-slate-400">{f.label}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <ol className="space-y-6">
          {STEPS.map((s) => (
            <li key={s.n} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-[64px_1fr_220px] md:items-start">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-xl font-extrabold text-white">{s.n}</span>
              <div>
                <h2 className="text-xl font-bold text-slate-900">{s.name}</h2>
                <p className="mt-0.5 text-sm font-semibold text-blue-700">{s.question}</p>
                <p className="mt-2 text-sm text-slate-700">{s.what}</p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
              <div className="md:text-right">
                <a
                  href={s.href}
                  onClick={() => trackEvent("pathway_cta", s.event)}
                  className="inline-block rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
                >
                  {s.cta} →
                </a>
                <p className="mt-2 text-xs text-slate-500">{s.access}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-bold text-slate-900">Why this order</h2>
          <p className="mt-2 text-sm text-slate-700">
            Most small businesses start by chasing individual bids. The ones that win first learn where their trade's money is, get registered and ready,
            bid on the jobs that fit, and get on the teams of the primes that already hold the big contracts, many of which must subcontract to small businesses.
            Each step feeds the next: your market sets your plan, your plan shapes Auto-Pilot's picks, and the primes in your market become your first teammates.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Figures from USAspending.gov and the SBA and GSA directories of prime contractors with subcontracting plans, synced by Contrax.
          </p>
        </div>
      </section>
    </main>
  );
}
