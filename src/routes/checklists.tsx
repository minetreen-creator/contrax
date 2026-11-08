import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { BID_CHECKLISTS } from "~/lib/bid-checklists";
import { seoHead } from "~/lib/seo-landing";

// /checklists — one-page bid checklists by trade (owner 2026-11-08).
export const Route = createFileRoute("/checklists")({
  head: () =>
    seoHead({
      title: "Bid Checklists for Government Contracts | Contrax",
      description:
        "One-page checklists for landscaping, janitorial, construction, security guard, snow removal and HVAC bids: what to read, gather, price and submit. Print or download.",
      canonical: "https://www.contrax.company/checklists",
    }),
  component: ChecklistsIndex,
});

function ChecklistsIndex() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Bid checklists</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Don't lose a bid on paperwork</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          One-page checklists for the bids small contractors go after most: what to read, what to gather, how to price and how to submit.
          Print one, check it off, and download it as a file to keep.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BID_CHECKLISTS.map((c) => (
            <a
              key={c.slug}
              href={`/checklists/${c.slug}`}
              className="block rounded-2xl border border-slate-200 bg-white p-5 no-underline shadow-sm hover:border-amber-400"
            >
              <h2 className="text-lg font-bold text-slate-900">{c.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{c.blurb}</p>
              <p className="mt-3 text-sm font-semibold text-blue-700">Open the checklist →</p>
            </a>
          ))}
        </div>
        <p className="mt-8 text-sm text-slate-500">
          These list what public buyers commonly ask for. Each solicitation and its addenda are the rules for that bid: follow them where they differ.
        </p>
      </div>
    </main>
  );
}
