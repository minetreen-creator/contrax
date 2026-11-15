import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { ENDING_STATES, ENDING_TRADES, endingPath } from "~/lib/ending-pages";
import { seoHead } from "~/lib/seo-landing";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

/** /contracts-ending — every state and trade page in one place, so people and search engines can reach each one (owner 2026-11-14). */
export const Route = createFileRoute("/contracts-ending/")({
  head: () =>
    seoHead({
      title: "Expiring Federal Contracts by State and Trade | Contrax",
      description:
        "Federal contracts ending in the next 12 months, by state and trade: janitorial, HVAC, construction, landscaping, security guard and IT services. From USAspending.gov records.",
      canonical: "https://www.contrax.company/contracts-ending",
    }),
  component: EndingHub,
});

function EndingHub() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-3xl font-extrabold text-slate-900">Expiring federal contracts by state and trade</h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          When a contract ends, the agency usually has to buy the work again. Pick your trade and state to see the largest contracts ending,
          who holds them and what they were awarded for. Every figure comes from USAspending.gov.
        </p>
        {ENDING_TRADES.map((t) => (
          <section key={t} className="mt-10">
            <h2 className="text-xl font-bold text-slate-900">{SEO_TRADE_BY_SLUG[t].label}</h2>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 md:grid-cols-4">
              {ENDING_STATES.map((s) => (
                <li key={s}><a href={endingPath(s, t)} className="text-blue-700 hover:underline">{s}</a></li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
