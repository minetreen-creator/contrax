import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADES } from "~/lib/seo-trades";
import { findSubsPath } from "~/lib/sub-finder";

/** /find-subcontractors — every trade and state page for primes looking for subs (owner 2026-11-09). */
const STATES = Object.entries(STATE_NAMES)
  .filter(([c]) => c.length === 2 && !["PR", "GU", "VI", "AS", "MP"].includes(c))
  .sort((a, b) => a[1].localeCompare(b[1]));

export const Route = createFileRoute("/find-subcontractors/")({
  head: () => ({
    meta: [
      { title: "Find Subcontractors for a Government Bid, by Trade and State | Contrax" },
      { name: "description", content: "Find local subcontractors by trade and state for your government bid, send a Trade Package and collect quotes in one place." },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/find-subcontractors" }],
  }),
  component: () => (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/sub-finder" className="hover:underline">Sub Finder</a>
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Find subcontractors for a government bid</h1>
        <p className="mt-2 text-slate-700">
          Pick a trade and a state to see local subs listed for primes and the federal work there. Or{" "}
          <a href="/sub-finder" className="font-semibold text-blue-700">open Sub Finder</a> and make a Trade Package.
        </p>
        <div className="mt-6 space-y-3">
          {SEO_TRADES.map((t) => (
            <details key={t.slug} className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold text-slate-900">{t.label} subcontractors</summary>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                {STATES.map(([code, name]) => (
                  <a key={code} href={findSubsPath(name, t.slug)} className="text-blue-700 hover:underline">
                    {name}
                  </a>
                ))}
              </div>
            </details>
          ))}
        </div>
      </main>
    </>
  ),
});
