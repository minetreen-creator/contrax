import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { WinnersListOffer } from "~/components/WinnersListOffer";
import {
  FEDERAL_CONSTRUCTION_PATH,
  FEDERAL_CONSTRUCTION_PERIOD,
  FEDERAL_CONSTRUCTION_PULLED,
  bigDollars,
  federalConstructionStateBySlug,
  federalWinnersStateHref,
} from "~/lib/federal-construction";
import { FEDERAL_CONSTRUCTION_TOP } from "~/lib/federal-construction-top";
import { seoHead } from "~/lib/seo-landing";
import { tidyCaps } from "~/lib/supplier-report";
import { WINNERS_PRICE } from "~/lib/state-winners";

// /federal-construction-winners/{state} — who won federal construction work in one state (owner 2026-11-20).
export const Route = createFileRoute("/federal-construction-winners/$state")({
  loader: ({ params }) => ({ state: federalConstructionStateBySlug(params.state) }),
  head: ({ loaderData }) => {
    const s = loaderData?.state;
    const head = seoHead({
      title: s ? `Who Won Federal Construction Contracts in ${s.name} | Contrax` : "Federal Construction Contracts by State | Contrax",
      description: s
        ? `${s.awards.toLocaleString("en-US")} federal construction contracts worth ${bigDollars(s.dollars)} were awarded for work in ${s.name} in fiscal year 2025. See the three largest winners and get the full list.`
        : "Who won federal construction contracts, state by state, from USAspending.gov records.",
      canonical: s ? `https://www.contrax.company${federalWinnersStateHref(s.slug)}` : `https://www.contrax.company${FEDERAL_CONSTRUCTION_PATH}`,
    });
    if (!s) head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    return head;
  },
  component: StateWinnersPage,
});

/** "VANCOUVER, WA" -> "Vancouver, WA": the state code stays in capitals. */
function tidyPlace(raw: string): string {
  const [city, st] = raw.split(",").map((x) => x.trim());
  return st ? `${tidyCaps(city)}, ${st.toUpperCase()}` : tidyCaps(raw);
}

function StateWinnersPage() {
  const { state: s } = Route.useLoaderData();
  if (!s) {
    return (
      <main className="min-h-screen bg-slate-50">
        <SiteHeader />
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="text-2xl font-bold">State not found</h1>
          <a href={FEDERAL_CONSTRUCTION_PATH} className="mt-4 inline-block font-semibold text-blue-700">See all 50 states →</a>
        </div>
      </main>
    );
  }
  const top = FEDERAL_CONSTRUCTION_TOP[s.code] ?? [];
  const localAwards = s.awards - s.outAwards;
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Federal construction in {s.name}</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Who won federal construction contracts in {s.name}</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          In {FEDERAL_CONSTRUCTION_PERIOD}, federal agencies signed {s.awards.toLocaleString("en-US")} new construction contracts of $100,000
          or more for work in {s.name}, worth {bigDollars(s.dollars)}. {s.outShare}% of that money went to companies registered in another
          state.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat big={s.awards.toLocaleString("en-US")} label="new contracts of $100,000 or more" />
          <Stat big={bigDollars(s.dollars)} label="total awarded" />
          <Stat big={localAwards.toLocaleString("en-US")} label={`won by companies registered in ${s.name}`} />
        </div>

        {top.length > 0 && (
          <>
            <h2 className="mt-10 text-xl font-bold">The three largest</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Based in</th>
                    <th className="px-3 py-2">Agency</th>
                    <th className="px-3 py-2">Work in</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map(([company, based, dollars, agency, where]) => (
                    <tr key={`${company}-${dollars}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold">{tidyCaps(company)}</td>
                      <td className="px-3 py-2">{tidyPlace(based)}</td>
                      <td className="px-3 py-2">{agency}</td>
                      <td className="px-3 py-2">{tidyCaps(where)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{bigDollars(dollars)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              That is 3 of {s.awards.toLocaleString("en-US")}. The full list for {s.name} is {WINNERS_PRICE}, one time.
            </p>
          </>
        )}

        <WinnersListOffer source={federalWinnersStateHref(s.slug)} place="state" initialState={s.code} />

        <h2 className="mt-10 text-xl font-bold">How we counted</h2>
        <p className="mt-3 text-sm text-slate-700">
          Source:{" "}
          <a href="https://www.usaspending.gov/search" className="text-blue-700 hover:text-blue-800" rel="noopener">
            USAspending.gov
          </a>
          , the federal government's public spending record, pulled {FEDERAL_CONSTRUCTION_PULLED}. New contract awards first signed in{" "}
          {FEDERAL_CONSTRUCTION_PERIOD}, coded as construction (NAICS sector 23), of $100,000 or more, counted in the state where the work is
          done. Amounts are each contract's current total. Subcontracts are not included.
        </p>

        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          <a href={FEDERAL_CONSTRUCTION_PATH} className="text-blue-700 hover:text-blue-800">All 50 states, ranked →</a>
          <a href={`/contracts-in/${s.slug}/construction`} className="text-blue-700 hover:text-blue-800">Construction bids open in {s.name} now →</a>
        </div>
      </div>
    </main>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-2xl font-extrabold">{big}</p>
      <p className="mt-1 text-sm text-slate-600">{label}</p>
    </div>
  );
}
