import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import {
  FEDERAL_CONSTRUCTION_PATH,
  FEDERAL_CONSTRUCTION_PERIOD,
  FEDERAL_CONSTRUCTION_PULLED,
  bigDollars,
  federalConstructionStates,
  federalConstructionTotals,
} from "~/lib/federal-construction";
import { seoHead } from "~/lib/seo-landing";

// /federal-construction-by-state — where federal construction dollars go (owner 2026-11-19).
export const Route = createFileRoute("/federal-construction-by-state")({
  head: () =>
    seoHead({
      title: "Federal Construction Contracts by State: How Much Goes Out of State | Contrax",
      description:
        "62% of federal construction dollars in fiscal year 2025 went to a company registered in a different state from the job. See the share for all 50 states and DC, from USAspending.gov records.",
      canonical: `https://www.contrax.company${FEDERAL_CONSTRUCTION_PATH}`,
    }),
  component: FederalConstructionByState,
});

function FederalConstructionByState() {
  const states = federalConstructionStates();
  const t = federalConstructionTotals();
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Federal construction, by state</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t.outShare} cents of every federal construction dollar goes to a company from another state
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          In {FEDERAL_CONSTRUCTION_PERIOD}, federal agencies signed {t.awards.toLocaleString("en-US")} new construction contracts of $100,000 or
          more, worth {bigDollars(t.dollars)}. {bigDollars(t.outDollars)} of it went to a company registered in a different state from the one
          where the work is done.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat big={`${t.outShare}%`} label="of the dollars went to out-of-state companies" />
          <Stat big={`${t.outAwardShare}%`} label="of the contracts went to out-of-state companies" />
          <Stat big={bigDollars(t.dollars)} label={`across ${t.awards.toLocaleString("en-US")} new contracts`} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Local companies win about half of the contracts. The largest ones go out of state more often, which is why the share of dollars is
          higher than the share of contracts.
        </p>

        <h2 className="mt-10 text-xl font-bold">Every state, ranked</h2>
        <p className="mt-1 text-sm text-slate-600">Highest out-of-state share of dollars first.</p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2 text-right">Out-of-state share</th>
                <th className="px-3 py-2 text-right">Total awarded</th>
                <th className="px-3 py-2 text-right">Contracts</th>
                <th className="px-3 py-2 text-right">Won out of state</th>
              </tr>
            </thead>
            <tbody>
              {states.map((s) => (
                <tr key={s.code} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{s.rank}</td>
                  <td className="px-3 py-2 font-semibold">
                    <a href={`/contracts-in/${s.slug}/construction`} className="text-blue-700 hover:text-blue-800">
                      {s.name}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{s.outShare}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{bigDollars(s.dollars)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.awards.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.outAwards.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Each state name opens the construction bids open in that state now.</p>

        <h2 className="mt-10 text-xl font-bold">Read this before quoting a number</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <strong>A few very large contracts move some states.</strong> The three largest in Texas were border wall contracts of $573
            million to $874 million, won by companies registered in Alabama and Montana. The largest in California was a $1.2 billion border
            barrier contract won by an Arizona company, followed by two dam projects won by a Montana company.
          </li>
          <li>
            <strong>"Out of state" is the winner's registered address.</strong> A national builder with a local office still counts as out of
            state, and a joint venture counts where it is registered.
          </li>
          <li>
            <strong>Small states have few contracts.</strong> Vermont had 25 and Delaware 28, so one job changes the share.
          </li>
          <li>
            <strong>Amounts are current totals.</strong> Each contract's dollar figure includes changes made after it was first signed, as of{" "}
            {FEDERAL_CONSTRUCTION_PULLED}.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-bold">How we counted</h2>
        <p className="mt-3 text-sm text-slate-700">
          Source:{" "}
          <a href="https://www.usaspending.gov/search" className="text-blue-700 hover:text-blue-800" rel="noopener">
            USAspending.gov
          </a>
          , the federal government's public spending record, pulled {FEDERAL_CONSTRUCTION_PULLED}. We counted new contract awards first signed in{" "}
          {FEDERAL_CONSTRUCTION_PERIOD}, coded as construction (NAICS sector 23), of $100,000 or more, from every agency including Defense. Each
          contract is counted in the state where the work is done and compared with the state of the winning company's registered address.
          Subcontracts are not included.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Reporters and researchers: write to{" "}
          <a href="mailto:contrax.companyllc@gmail.com" className="text-blue-700 hover:text-blue-800">
            contrax.companyllc@gmail.com
          </a>{" "}
          for the contract-level list for any state, with award numbers you can check against the federal record.
        </p>

        <div className="mt-10 rounded-2xl bg-slate-900 p-6 text-white">
          <h2 className="text-lg font-bold">Local contractors can only win the work they see</h2>
          <p className="mt-2 text-sm text-slate-200">
            Contrax lists open federal, state and local bids in one place, by state and trade.
          </p>
          <a href="/radar" className="mt-4 inline-block rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900 no-underline">
            See open bids in your state →
          </a>
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
