import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { BRAND_MESSAGE } from "~/lib/brand-message";
import { MARKETS, networkName } from "~/lib/markets";

/** /markets — every Contractor Support Network market (owner 2026-11-10). */
export const Route = createFileRoute("/markets/")({
  head: () => ({
    meta: [
      { title: "Contractor Support Network: Bids, Subcontractors and Partners by Market | Contrax" },
      { name: "description", content: "Federal construction markets where Contrax helps contractors find the opportunity, build the team and get the work: Tampa, Hampton Roads, San Diego and San Antonio." },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/markets" }],
  }),
  component: () => (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Contractor Support Network</p>
        <h1 className="mt-1 text-3xl font-bold sm:text-4xl">{BRAND_MESSAGE}</h1>
        <p className="mt-2 max-w-3xl text-slate-700">
          Markets with heavy federal construction, where crews often come from out of state. Each page shows open local bids, certified subs and the market's federal numbers.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {MARKETS.map((m) => (
            <li key={m.slug}>
              <a href={m.path} className="block h-full rounded-2xl border border-slate-200 bg-white p-5 hover:border-blue-400 hover:shadow-md">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{m.stateName}</p>
                <p className="mt-1 text-lg font-bold">{networkName(m)}</p>
                <p className="mt-2 text-2xl font-extrabold">{m.facts.federalConstruction}</p>
                <p className="text-sm text-slate-600">federal construction, {m.facts.outOfStateShare} won by out-of-state firms</p>
                <p className="mt-2 text-sm text-slate-600">{m.facts.endingSoonCount}+ contracts up for rebid in 12 months</p>
                {m.partner ? <p className="mt-2 text-sm font-semibold text-sky-700">Housing partner: {m.partner.name}</p> : null}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-slate-500">Federal figures: USAspending.gov, FY2026 (Oct 2025 – Sep 2026). Subcontractors: SAM.gov registrations.</p>
      </main>
    </div>
  ),
});
