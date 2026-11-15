import { ENDING_TRADES, endingPath } from "~/lib/ending-pages";
import { REPORT_DELIVERY, REPORT_PRICE } from "~/lib/pipeline-report";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * The done-for-you offer on a state page (owner 2026-11-14: "we should include the expensive plans
 * too", for the New York post that lands here). The page sells finding bids yourself; this names
 * the two prepared reports and links to the contracts ending in this state. Prices are the site's own.
 */
export const MANAGED_PRICE_LINE = "$499 a month";

export function PreparedForYou({ stateName }: { stateName: string }) {
  return (
    <section className="mx-auto mt-10 max-w-3xl px-4">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <h2 className="text-xl font-bold text-slate-900">Rather have it prepared for you?</h2>
        <p className="mt-2 text-sm text-slate-700">
          We build the report: the federal contracts ending in {stateName} in your line of work, who holds them, which agencies they are with
          and the open bids that fit.
        </p>
        <ul className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <li className="rounded-xl border border-slate-200 bg-white p-4">
            <span className="block font-bold text-slate-900">Pipeline Snapshot · {REPORT_PRICE} once</span>
            One report for one state and trade, emailed within {REPORT_DELIVERY}.
          </li>
          <li className="rounded-xl border border-slate-200 bg-white p-4">
            <span className="block font-bold text-slate-900">Contrax Managed · {MANAGED_PRICE_LINE}</span>
            The report rebuilt every month. Month to month.
          </li>
        </ul>
        <a
          href="/sample-report"
          onClick={() => trackEvent("state_page_click", "sample_report")}
          className="mt-5 inline-block rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400"
        >
          Read a real sample report →
        </a>
        <a href="/teams#done-for-you" onClick={() => trackEvent("state_page_click", "teams")} className="ml-4 text-sm font-semibold text-blue-700 hover:underline">
          Compare the two →
        </a>
        <p className="mt-5 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Federal contracts ending in {stateName}: </span>
          {ENDING_TRADES.map((t, i) => (
            <span key={t}>
              {i > 0 && " · "}
              <a href={endingPath(stateName, t)} className="text-blue-700 hover:underline">{SEO_TRADE_BY_SLUG[t].label}</a>
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
