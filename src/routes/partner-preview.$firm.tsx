import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { awardUrl, formatDollars } from "~/lib/federal-trade-data";
import type { ReportData } from "~/lib/pipeline-report-data.server";
import { PARTNER_CLIENT_PROMISE, PARTNER_MARKETS, PARTNER_PRICE, PARTNER_SLA, PARTNER_VOLUME_AT, PARTNER_VOLUME_PRICE, partnerMarket, partnerSlug, type PartnerMarket } from "~/lib/reseller";

/**
 * /partner-preview/{firm} — how the monthly report looks under a firm's own name (owner
 * 2026-11-15: host the co-branded sample "on a clean, un-gated URL" and match it to the firm's
 * niche). The firm's name is shown only when we have written to that firm (a 'partner' row in
 * outreach_contacts), so nobody can put an arbitrary company's name on a Contrax page. Any other
 * address shows "Your Firm". Real figures from the same function a paid report uses. Not indexed.
 */
const getPreview = createServerFn({ method: "GET" })
  .validator((d: unknown) => String((d as { firm?: unknown } | null)?.firm ?? "").toLowerCase().slice(0, 80))
  .handler(async ({ data }): Promise<{ firm: string | null; market: PartnerMarket; report: Pick<ReportData, "stateName" | "tradeLabel" | "asOf" | "until" | "totals" | "priceRange" | "byAgency" | "largest" | "holders" | "openBids"> | null }> => {
    let firm: string | null = null;
    let market: PartnerMarket = "it";
    try {
      if (/^[a-z0-9-]{2,80}$/.test(data)) {
        const { sql } = await import("~/db");
        const rows = (await sql()`SELECT business, place FROM outreach_contacts WHERE kind = 'partner' ORDER BY id DESC LIMIT 2000`) as { business: string; place: string | null }[];
        const hit = rows.find((r) => partnerSlug(r.business) === data);
        if (hit) { firm = hit.business; market = partnerMarket(hit.place); }
      }
      const m = PARTNER_MARKETS[market];
      const { reportData } = await import("~/lib/pipeline-report-data.server");
      const r = await reportData(m.state, m.trade, 12);
      return {
        firm, market,
        report: { stateName: r.stateName, tradeLabel: r.tradeLabel, asOf: r.asOf, until: r.until, totals: r.totals, priceRange: r.priceRange, byAgency: r.byAgency.slice(0, 5), largest: r.largest.slice(0, 10), holders: r.holders.slice(0, 5), openBids: r.openBids.slice(0, 3) },
      };
    } catch (e) {
      console.error("[partner-preview] failed", e);
      return { firm, market, report: null };
    }
  });

export const Route = createFileRoute("/partner-preview/$firm")({
  loader: ({ params }) => getPreview({ data: { firm: params.firm } }),
  head: () => ({ meta: [{ title: "Pipeline report preview | Contrax" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PartnerPreview,
});

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const th = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600";
const td = "px-3 py-2 align-top";

function PartnerPreview() {
  const { firm, report: r } = Route.useLoaderData();
  const name = firm ?? "Your Firm";
  return (
    <main className="bg-white">
      <p className="bg-amber-100 px-4 py-2 text-center text-xs text-slate-800">
        Preview prepared by Contrax to show how this report would look under your firm's name. {firm ? `${firm} is not affiliated with Contrax.` : ""}
      </p>
      <section className="border-b-4 border-slate-900 px-4 py-10">
        <div className="mx-auto max-w-4xl">
          <p className="text-2xl font-extrabold text-slate-900">{name}</p>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight text-slate-900">Government pipeline report</h1>
          {r ? (
            <p className="mt-2 text-slate-700">Federal {r.tradeLabel} in {r.stateName} · prepared for a client of {name} · {day(r.asOf)}</p>
          ) : (
            <p className="mt-2 text-slate-700">The figures are being refreshed. Please check back shortly.</p>
          )}
        </div>
      </section>
      {r && (
        <>
          <section className="mx-auto max-w-4xl px-4 py-8">
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ["Contracts ending by " + day(r.until), r.totals.n.toLocaleString("en-US")],
                ["Their combined award value", formatDollars(r.totals.total)],
                ["Companies holding them", r.totals.holders.toLocaleString("en-US")],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-200 px-4 py-3">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="mt-1 text-2xl font-bold text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            {r.priceRange && (
              <p className="mt-5 text-sm text-slate-700">
                Half of these contracts were awarded for between {formatDollars(r.priceRange.low)} and {formatDollars(r.priceRange.high)}; the midpoint is {formatDollars(r.priceRange.median)}.
              </p>
            )}
            <h2 className="mt-8 text-xl font-bold text-slate-900">The largest contracts ending in the next 6 months</h2>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] text-sm text-slate-700">
                <thead className="bg-slate-50"><tr><th className={th}>Holder</th><th className={th}>Agency</th><th className={th}>Award value</th><th className={th}>Ends</th></tr></thead>
                <tbody>
                  {r.largest.map((c) => (
                    <tr key={c.award_key} className="border-t border-slate-200">
                      <td className={td}><a href={awardUrl(c.award_key)} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">{c.recipient_name}</a></td>
                      <td className={td}>{c.sub_agency ?? c.agency ?? "Not listed"}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatDollars(c.amount)}</td>
                      <td className={`${td} whitespace-nowrap`}>{day(c.end_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="mx-auto grid max-w-4xl gap-8 px-4 pb-8 md:grid-cols-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Agencies with the most work ending</h2>
              <ol className="mt-3 space-y-2 text-sm text-slate-700">
                {r.byAgency.map((a, i) => (
                  <li key={a.agency} className="flex justify-between gap-3 border-b border-slate-100 pb-2"><span>{i + 1}. {a.agency}</span><span className="whitespace-nowrap font-semibold text-slate-900">{formatDollars(a.total)}</span></li>
                ))}
              </ol>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Companies holding the most of it</h2>
              <ol className="mt-3 space-y-2 text-sm text-slate-700">
                {r.holders.map((h, i) => (
                  <li key={h.recipient_name} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <span>{i + 1}. {h.recipient_name}{h.hasPlan && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">Sub plan</span>}</span>
                    <span className="whitespace-nowrap font-semibold text-slate-900">{formatDollars(h.total)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          {r.openBids.length > 0 && (
            <section className="mx-auto max-w-4xl px-4 pb-8">
              <h2 className="text-lg font-bold text-slate-900">Open bids that fit right now</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {r.openBids.map((b) => <li key={b.id} className="rounded-lg border border-slate-200 p-3"><span className="font-semibold text-slate-900">{b.title}</span><span className="block text-xs text-slate-600">{b.agency ?? "Agency not listed"} · due {day(b.due)}</span></li>)}
              </ul>
            </section>
          )}
        </>
      )}
      <section className="bg-slate-950 px-4 py-10 text-white">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-xl font-bold">Give this to each of your clients, every month, under your name</h2>
          <p className="mt-2 text-sm text-slate-300">
            {PARTNER_PRICE} per client per month, or {PARTNER_VOLUME_PRICE} per client from {PARTNER_VOLUME_AT} clients. You set what your clients pay. Month to month. A new client's report is ready within {PARTNER_SLA}. Source: USAspending.gov contract records.
          </p>
          <p className="mt-2 text-sm text-slate-300">{PARTNER_CLIENT_PROMISE}</p>
          <a href="/resellers" className="mt-5 inline-block rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400">See how it works and what you keep →</a>
        </div>
      </section>
    </main>
  );
}
