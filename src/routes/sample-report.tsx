import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { awardUrl, formatDollars } from "~/lib/federal-trade-data";
import { REPORT_CREDIT_NOTE, REPORT_DELIVERY, REPORT_PRICE } from "~/lib/pipeline-report";
import { trackEvent } from "~/lib/track";

/**
 * /sample-report — a real Pipeline Snapshot anyone can read (owner 2026-11-14, from the competitor
 * review: the self-serve tools lead with a free sample; we had prices but nothing to look at).
 * It is the live report for one market, built by the same function a paid report uses
 * (src/lib/pipeline-report-data.server.ts), so it never shows something a buyer would not get.
 */
const PROD_URL = "https://www.contrax.company";
export const SAMPLE_STATE = "VA";
export const SAMPLE_TRADE = "it-services";
const TITLE = "Sample Pipeline Snapshot: Federal IT Services in Virginia | Contrax";
const DESC =
  "A real Contrax Pipeline Snapshot: the federal IT services contracts ending in Virginia, who holds them, which agencies they are with, what they were awarded for and the open bids that fit.";

const getSample = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { reportData } = await import("~/lib/pipeline-report-data.server");
    return await reportData(SAMPLE_STATE, SAMPLE_TRADE, 12);
  } catch (e) {
    console.error("[sample-report] failed", e);
    return null;
  }
});

export const Route = createFileRoute("/sample-report")({
  loader: () => getSample(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/sample-report` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/og/general.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/sample-report` }],
  }),
  component: SampleReport,
});

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const th = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600";
const td = "px-3 py-2 align-top";

function Order({ where }: { where: string }) {
  return (
    <a
      href="/teams#done-for-you"
      onClick={() => trackEvent("sample_report_click", where)}
      className="inline-block rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400"
    >
      Get this for your state and trade: {REPORT_PRICE} →
    </a>
  );
}

function SampleReport() {
  const r = Route.useLoaderData();
  if (!r || !r.totals?.n) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="text-2xl font-bold text-slate-900">Sample Pipeline Snapshot</h1>
          <p className="mt-3 text-slate-700">The sample is being refreshed. Please check back shortly, or see what the report includes on the teams page.</p>
          <div className="mt-6"><Order where="empty" /></div>
        </main>
      </>
    );
  }
  const peak = Math.max(...r.byMonth.map((m) => m.total), 1);
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-12 text-white">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">Sample Pipeline Snapshot · free to read</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">Federal {r.tradeLabel} in {r.stateName}</h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              This is a real report, built today from public records. A paid Snapshot is the same report for your state and your line of work,
              emailed within {REPORT_DELIVERY}.
            </p>
            <dl className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                ["Contracts ending by " + day(r.until), r.totals.n.toLocaleString("en-US")],
                ["Their combined award value", formatDollars(r.totals.total)],
                ["Companies holding them", r.totals.holders.toLocaleString("en-US")],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <dt className="text-xs text-slate-400">{k}</dt>
                  <dd className="mt-1 text-2xl font-bold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-400">As of {day(r.asOf)}. Source: USAspending.gov contract records.</p>
            <div className="mt-6"><Order where="hero" /></div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-10">
          <h2 className="text-xl font-bold text-slate-900">The 25 largest contracts ending in the next 6 months</h2>
          <p className="mt-1 text-sm text-slate-700">Each one links to its public record, so you can check it.</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-sm text-slate-700">
              <thead className="bg-slate-50">
                <tr><th className={th}>Holder</th><th className={th}>Agency</th><th className={th}>Award value</th><th className={th}>Ends</th></tr>
              </thead>
              <tbody>
                {r.largest.map((c) => (
                  <tr key={c.award_key} className="border-t border-slate-200">
                    <td className={td}>
                      <a href={awardUrl(c.award_key)} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:text-blue-600">{c.recipient_name}</a>
                    </td>
                    <td className={td}>{c.sub_agency ?? c.agency ?? "Not listed"}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatDollars(c.amount)}</td>
                    <td className={`${td} whitespace-nowrap`}>{day(c.end_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {r.priceRange && (
          <section className="bg-slate-50 px-4 py-10">
            <div className="mx-auto max-w-4xl">
              <h2 className="text-xl font-bold text-slate-900">What contracts like these were awarded for</h2>
              <p className="mt-2 text-sm text-slate-700">
                Half of these contracts were awarded for between {formatDollars(r.priceRange.low)} and {formatDollars(r.priceRange.high)}. The midpoint
                is {formatDollars(r.priceRange.median)}. Use it to judge which ones are your size, not as a price to bid. A few very large umbrella
                contracts can make the combined total look bigger than the work one firm could win, so the midpoint is the better guide.
              </p>
            </div>
          </section>
        )}

        <section className="mx-auto grid max-w-4xl gap-8 px-4 py-10 md:grid-cols-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Agencies with the most work ending</h2>
            <ol className="mt-3 space-y-2 text-sm text-slate-700">
              {r.byAgency.slice(0, 10).map((a, i) => (
                <li key={a.agency} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <span>{i + 1}. {a.agency}</span>
                  <span className="whitespace-nowrap font-semibold text-slate-900">{formatDollars(a.total)} · {a.n.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Companies holding the most of it</h2>
            <p className="mt-1 text-xs text-slate-600">Who you would compete against, or team with.</p>
            <ol className="mt-3 space-y-2 text-sm text-slate-700">
              {r.holders.map((h, i) => (
                <li key={h.recipient_name} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <span>{i + 1}. {h.recipient_name}</span>
                  <span className="whitespace-nowrap font-semibold text-slate-900">{formatDollars(h.total)} · {h.n.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-slate-50 px-4 py-10">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-xl font-bold text-slate-900">When they end</h2>
            <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
              {r.byMonth.map((m) => (
                <li key={m.month} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3">
                  <span>{monthName(m.month)}</span>
                  <span className="h-3 rounded bg-slate-200"><span className="block h-3 rounded bg-amber-500" style={{ width: `${Math.max(2, Math.round((m.total / peak) * 100))}%` }} /></span>
                  <span className="whitespace-nowrap text-xs text-slate-600">{formatDollars(m.total)} · {m.n.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-10">
          <h2 className="text-xl font-bold text-slate-900">Open bids that fit right now</h2>
          {r.openBids.length ? (
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {r.openBids.map((b) => (
                <li key={b.id} className="rounded-lg border border-slate-200 p-3">
                  <a href={`/bid/${b.id}`} className="font-semibold text-blue-700 hover:text-blue-600">{b.title}</a>
                  <span className="block text-xs text-slate-600">{b.agency ?? "Agency not listed"} · due {day(b.due)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-700">None are open in this market today. A report lists up to 5 when there are any.</p>
          )}
          <p className="mt-8 text-sm text-slate-600">
            Award values are the amounts USAspending.gov reports, not yearly spending. An end date can move if an agency extends the contract,
            and an ending contract is a sign to prepare, not a promise that the work will be rebid.
          </p>
          <div className="mt-6 rounded-2xl border-2 border-slate-900 p-6">
            <h2 className="text-xl font-bold text-slate-900">Want this for your state and your trade?</h2>
            <p className="mt-2 text-sm text-slate-700">One report, {REPORT_PRICE}, paid once and delivered within {REPORT_DELIVERY}. {REPORT_CREDIT_NOTE}</p>
            <div className="mt-4"><Order where="closing" /></div>
          </div>
        </section>
      </main>
    </>
  );
}
