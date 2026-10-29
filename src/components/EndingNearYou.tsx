import { useEffect, useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { ENDING_MONTHS, getEndingNearYou, shortDollars, type EndingNearYou as Data } from "~/lib/ending-near-you";
import { trackEvent } from "~/lib/track";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";


const month = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/** Homepage: real federal contracts ending soon near the visitor; holder locked. */
export function EndingNearYou() {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let alive = true;
    getEndingNearYou()
      .then((d) => {
        if (!alive || d.rows.length === 0) return;
        setData(d);
        trackEvent("ending_near_you_shown", d.state || "US");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return null;
  const where = data.state ? STATE_NAMES[data.state] ?? data.state : "the US";
  return (
    <section aria-labelledby="ending-near-you-title" className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">About to be re-bid</p>
      <h2 id="ending-near-you-title" className="mt-2 text-2xl font-bold tracking-tight">
        Government contracts ending soon in {where}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
        When a contract ends, the agency usually bids the work again. These end in the next {ENDING_MONTHS} months.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {data.rows.map((r, i) => (
          <li key={i} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-3xl font-extrabold text-emerald-700 dark:text-emerald-400">{shortDollars(r.amount)}</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{r.agency}</p>
            <p className="mt-1 text-xs text-slate-500">
              {SEO_TRADE_BY_SLUG[r.trade]?.label ?? r.trade} · ends {month(r.endDate)}
            </p>
            {r.description && <p className="mt-2 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{r.description}</p>}
            <p className="mt-3 text-xs text-slate-500">
              Current holder: <span className="font-semibold">🔒 Professional</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <a href="/recompetes" onClick={() => trackEvent("ending_near_you_click", "recompetes")} className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
          See every contract ending soon →
        </a>
        <span className="text-xs text-slate-500">Amounts from public USAspending.gov records.</span>
      </p>
    </section>
  );
}
