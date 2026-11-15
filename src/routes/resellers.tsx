import { createFileRoute } from "@tanstack/react-router";
import { ResellerOrder } from "~/components/ResellerOrder";
import { SiteHeader } from "~/components/SiteHeader";
import { PARTNER_CLIENT_PROMISE, PARTNER_PRICE, PARTNER_RETAIL, PARTNER_SLA, PARTNER_VOLUME_AT, PARTNER_VOLUME_PRICE } from "~/lib/reseller";
import { seoHead } from "~/lib/seo-landing";

/**
 * /resellers — the offer for firms that already serve government contractors (owner 2026-11-15:
 * "Yes go"; "anchor the math on their profit margin"; "make sure these payments can be put on
 * stripe too"). Their clients get the monthly pipeline report under the firm's name. Prices and
 * rules live in src/lib/reseller.ts. (/partners is the older page for associations.)
 */
export const Route = createFileRoute("/resellers")({
  head: () =>
    seoHead({
      title: "Resell the Contrax Pipeline Report Under Your Firm's Name | Contrax",
      description:
        "For proposal writers and government-contracting consultants: give each client a monthly pipeline report under your own name. Wholesale pricing per client, month to month.",
      canonical: "https://www.contrax.company/resellers",
    }),
  component: Resellers,
});

function Resellers() {
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-14 text-white">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For proposal writers and government-contracting consultants</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">Your clients ask what to bid on next. Hand them the answer, under your name.</h1>
            <p className="mt-4 text-slate-300">
              We prepare a monthly pipeline report for each of your clients: the federal contracts about to end in their state and line of work, who
              holds each one now, the agencies, what contracts like them were awarded for, and the open bids that fit. It carries your firm's name. You set the price.
            </p>
            <a href="/sample-report" className="mt-6 inline-block rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400">Read a real report →</a>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 text-slate-700">
          <h2 className="text-xl font-bold text-slate-900">What you keep</h2>
          <p className="mt-2">
            Firms typically offer a deliverable like this to a client for {PARTNER_RETAIL} a month. We sell the same report directly for $499. Your price from us:
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2">Clients</th><th className="px-4 py-2">You pay, per client per month</th><th className="px-4 py-2">You keep at $450 each</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-200"><td className="px-4 py-2">1 to {PARTNER_VOLUME_AT - 1}</td><td className="px-4 py-2 font-semibold text-slate-900">{PARTNER_PRICE}</td><td className="px-4 py-2">$251 per client</td></tr>
                <tr className="border-t border-slate-200"><td className="px-4 py-2">{PARTNER_VOLUME_AT} or more</td><td className="px-4 py-2 font-semibold text-slate-900">{PARTNER_VOLUME_PRICE}, on every client</td><td className="px-4 py-2">$301 per client</td></tr>
              </tbody>
            </table>
          </div>
          <ul className="mt-5 list-disc space-y-1 pl-5 text-sm">
            <li>Month to month. Add or remove clients by email; the bill follows.</li>
            <li>Nothing to build. Tell us each client's state and line of work and we prepare the report under your name.</li>
            <li>Send us a new client's state and line of work and their report is ready within {PARTNER_SLA}, then again every month.</li>
            <li>Contract data comes from USAspending.gov public records.</li>
          </ul>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-bold text-slate-900">Your clients stay yours</h2>
            <p className="mt-2 text-sm">{PARTNER_CLIENT_PROMISE}</p>
            <p className="mt-2 text-sm">
              You do not have to tell us who a client is: a state and a line of work are enough to build the report. If you do name a client, we
              put them on our do-not-contact list so none of our own emails can reach them.
            </p>
          </div>

          <div id="order" className="mt-10 scroll-mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
            <h2 className="text-xl font-bold text-slate-900">Start with your first clients</h2>
            <p className="mt-1 text-sm text-slate-700">Pay by card through Stripe. Cancel any time.</p>
            <ResellerOrder />
          </div>
          <p className="mt-6 text-sm text-slate-600">
            Want to see one for a client first? Write to contrax.companyllc@gmail.com with their state and line of work and we will send that report with your name on it, free.
          </p>
        </section>
      </main>
    </>
  );
}
