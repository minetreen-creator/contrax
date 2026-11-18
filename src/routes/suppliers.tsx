import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { trackEvent } from "~/lib/track";
import { SupplierRequestForm as RequestForm } from "~/components/SupplierRequestForm";
import { PLAN_COPY } from "~/lib/plan-features";
import {
  SUPPLIER_INCLUDES,
  SUPPLIER_NOT_YET,
  SUPPLIER_SAMPLE_STATES,
  supplierDay,
  supplierMoney,
  type SupplierSample,
} from "~/lib/supplier-report";

/**
 * /suppliers — the weekly report for businesses that sell to contractors (owner 2026-11-18; see
 * ~/lib/supplier-report). The page shows this week's real South Carolina rows and takes a request
 * for a free report in the visitor's state; each request reaches the owner by email. The paid step is
 * the Agency plan at $199 a month (owner 2026-11-12: "lift it for suppliers", "$199 it is"), the offer
 * this page carried before 2026-11-18, kept here as the second button.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Public Construction Jobs Report for Suppliers | Contrax";
const DESC =
  "A weekly report for businesses that sell to contractors: the public construction jobs opening in your state, federal jobs just awarded and who won them, and contracts about to end.";

const getSample = createServerFn({ method: "GET" }).handler(async (): Promise<SupplierSample[]> => {
  const { loadSupplierSamples } = await import("~/lib/supplier-report.server");
  return loadSupplierSamples(SUPPLIER_SAMPLE_STATES);
});

export const Route = createFileRoute("/suppliers")({
  loader: () => getSample(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/suppliers` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/og/general.png` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/suppliers` }],
  }),
  component: SuppliersPage,
});

function SuppliersPage() {
  const samples = Route.useLoaderData();
  const features = PLAN_COPY.agency.features.filter((f) => !/^Or \$/.test(f) && f !== "Cancel anytime");
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-14 text-white sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For businesses that sell to contractors</p>
              <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-5xl">Know which public jobs are opening in your state before your competitors do</h1>
              <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
                Every public job that gets built needs materials, equipment, crews, bonds and licenses. Contrax reads the bid boards for
                you and sends one report a week: what is opening, what was just awarded and to whom, and which contracts are about to end.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-slate-200 sm:text-base">
                {SUPPLIER_INCLUDES.map((line) => (
                  <li key={line} className="flex gap-2"><span aria-hidden className="text-amber-400">✓</span><span>{line}</span></li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-slate-400">{SUPPLIER_NOT_YET}</p>
            </div>
            <RequestForm where="hero" />
          </div>
        </section>

        <section className="px-4 py-12 sm:py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Who it is for</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                ["Material and equipment suppliers", "Quote the lumber, trusses, roofing, concrete or rental equipment to the builders bidding the job, while they are still pricing it."],
                ["Staffing firms", "A contractor who just won a public job needs people. See the awards the week they happen."],
                ["Bonding and insurance agents", "Public jobs need bid and performance bonds. Reach contractors while the bid is still open."],
                ["Licensing, training and consulting", "See which trades and counties have the most public work coming, and who is winning it."],
              ].map(([t, b]) => (
                <div key={t} className="rounded-xl border border-slate-200 p-5">
                  <h3 className="font-bold text-slate-900">{t}</h3>
                  <p className="mt-1 text-sm text-slate-600">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {samples.filter((sample) => sample.newJobs.length > 0 || sample.awards.length > 0).map((sample) => (
          <section key={sample.state} className="bg-slate-50 px-4 py-12 sm:py-16">
            <div className="mx-auto max-w-4xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">This week's sample, from live data</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">{sample.stateName} public construction</h2>
              <dl className="mt-6 grid grid-cols-3 gap-3">
                {[
                  ["Open now", sample.open],
                  ["New this week", sample.newThisWeek],
                  ["Closing in 7 days", sample.closingSoon],
                ].map(([k, v]) => (
                  <div key={String(k)} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <dt className="text-xs text-slate-500">{k}</dt>
                    <dd className="mt-1 text-2xl font-bold text-slate-900">{v}</dd>
                  </div>
                ))}
              </dl>

              {sample.newJobs.length > 0 && (
                <>
                  <h3 className="mt-8 text-lg font-bold text-slate-900">New this week</h3>
                  <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                    {sample.newJobs.map((j) => (
                      <li key={j.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <a href={`/bid/${j.id}`} className="font-semibold text-slate-900 underline-offset-4 hover:underline">{j.title}</a>
                        <span className="shrink-0 text-sm text-slate-600">{j.agency}{j.agency ? " · " : ""}bids due {supplierDay(j.due)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {sample.awards.length > 0 && (
                <>
                  <h3 className="mt-8 text-lg font-bold text-slate-900">Just awarded (federal)</h3>
                  <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                    {sample.awards.map((a, i) => (
                      <li key={i} className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{a.company}{a.where ? ` (${a.where})` : ""}: {supplierMoney(a.amount)}</p>
                        <p className="text-sm text-slate-600">{a.what}{a.what ? " · " : ""}awarded {supplierDay(a.date)}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {sample.ending.length > 0 && (
                <>
                  <h3 className="mt-8 text-lg font-bold text-slate-900">Federal contracts ending soon</h3>
                  <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                    {sample.ending.map((e, i) => (
                      <li key={i} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="font-semibold text-slate-900">{e.company}: {supplierMoney(e.amount)}</span>
                        <span className="shrink-0 text-sm text-slate-600">{e.agency}{e.agency ? " · " : ""}ends {supplierDay(e.end)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-4 text-xs text-slate-500">Taken from public bid boards and federal award records. {SUPPLIER_NOT_YET}</p>
            </div>
          </section>
        ))}

        <section className="px-4 pt-12 sm:pt-16">
          <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 p-6 sm:p-8">
            <h2 className="text-2xl font-extrabold text-slate-900">Ready now? The Agency plan</h2>
            <p className="mt-2 text-sm text-slate-600">Set up each territory once and see the public jobs bidding there every weekday, without waiting for the weekly report.</p>
            <ul className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              {features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-slate-600">A workspace here is a territory or a branch. Each one belongs to your login; it is not an extra user seat.</p>
            <a
              href="/upgrade?plan=agency&source=suppliers"
              onClick={() => trackEvent("suppliers_cta_click", "agency")}
              className="mt-5 inline-block rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              Start the Agency plan: $199 a month →
            </a>
            <p className="mt-2 text-xs text-slate-500">Month to month. Cancel anytime. Or $1,990 a year.</p>
          </div>
        </section>

        <section className="px-4 py-12 sm:py-16">
          <div className="mx-auto max-w-xl">
            <h2 className="text-center text-2xl font-extrabold text-slate-900 sm:text-3xl">See your own state</h2>
            <p className="mt-2 text-center text-slate-600">Tell us where you sell and what you sell. The first report is free.</p>
            <div className="mt-6"><RequestForm where="bottom" /></div>
          </div>
        </section>
      </main>
    </>
  );
}
