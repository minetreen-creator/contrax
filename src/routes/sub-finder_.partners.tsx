import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { PARTNER_BLURB, PARTNER_GROUPS } from "~/lib/sub-finder";
import { trackEvent } from "~/lib/track";

/**
 * /sub-finder/partners — Sub Finder for advisors (owner 2026-11-09, growth item 3): APEX
 * Accelerators, Small Business Development Centers, veteran business groups and state
 * certification offices. A page the owner can hand over in a conversation he starts, and that a
 * partner can share with their own clients. Contrax emails no one from it.
 */
export const Route = createFileRoute("/sub-finder_/partners")({
  head: () => ({
    meta: [
      { title: "Sub Finder for Small Business Advisors and Partners | Contrax" },
      {
        name: "description",
        content: "For APEX Accelerators, SBDCs, veteran business groups and certification offices: help your small business clients get found by prime contractors for government subcontracting work.",
      },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/sub-finder/partners" }],
  }),
  component: PartnersPage,
});

function PartnersPage() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PARTNER_BLURB);
      setCopied(true);
      trackEvent("sub_finder_partner_blurb_copied");
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/sub-finder" className="hover:underline">Sub Finder</a> · For advisors and partners
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Help your clients get found by prime contractors</h1>
        <p className="mt-2 text-slate-700">
          Primes bidding government work need local, certified subcontractors, often on short notice. Sub Finder lets your small business clients list their business so
          those primes can find them and ask for a quote.
        </p>

        <section className="mt-5 grid gap-3 sm:grid-cols-2">
          {PARTNER_GROUPS.map((g) => (
            <div key={g.name} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <h2 className="font-bold text-slate-900">{g.name}</h2>
              <p className="mt-1 text-slate-700">{g.why}</p>
            </div>
          ))}
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
          <h2 className="text-lg font-bold text-slate-900">How a client gets listed</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Create a Contrax account at contrax.company and add their trade, states and certifications.</li>
            <li>On the Sub Finder page, check "List my business for primes".</li>
            <li>When a prime sends a quote request for their trade and state, it arrives by email with the scope and deadline. They answer the prime directly.</li>
          </ol>
          <h3 className="mt-4 font-semibold text-slate-900">What your clients can count on</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Listing is their choice, and every quote request has a one-click link to stop.</li>
            <li>Each prime can send a limited number of requests per job, so no one is flooded.</li>
            <li>Certifications are shown as self-reported. Primes still verify them the usual way.</li>
            <li>Primes see the business name, trade, states, years in business and certifications. Your client's email reaches a prime only when your client answers a request.</li>
          </ul>
        </section>

        <section className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold text-slate-900">Paste into your newsletter or client email</h2>
          <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-slate-800">{PARTNER_BLURB}</p>
          <div className="mt-3 flex flex-wrap gap-3 print:hidden">
            <button type="button" onClick={() => void copy()} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
              {copied ? "Copied" : "Copy text"}
            </button>
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-800">
              Print this page as a handout
            </button>
          </div>
        </section>

        <p className="mt-5 text-sm text-slate-700">
          Questions, or want to walk through it with your team? Email{" "}
          <a href="mailto:contrax.companyllc@gmail.com?subject=Sub%20Finder%20partner" className="font-semibold text-blue-700">contrax.companyllc@gmail.com</a>.
        </p>
      </main>
    </>
  );
}
