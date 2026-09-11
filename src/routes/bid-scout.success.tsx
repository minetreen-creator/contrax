/**
 * Bid Scout success page (owner spec 2026-09-10, Phase A).
 *
 * Copy is EXACTLY the owner's two lines. Stripe adds ?session_id=... to this
 * URL after checkout — this page never renders customer or Stripe data from an
 * unverified query param (the webhook is the only thing that mutates the
 * subscription row; this page is purely presentational).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/bid-scout/success")({
  head: () => ({
    meta: [
      { title: "Your Bid Scout profile is active — Contrax" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BidScoutSuccessPage,
});

function BidScoutSuccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
          <svg
            className="h-7 w-7 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          Your Bid Scout profile is active.
        </h1>
        <p className="mt-4 text-slate-600">
          We'll review your capabilities and send your first five matched
          opportunities by Friday. Your report will include the strongest
          match, requirements, deadlines, risks and recommended next steps.
        </p>
        <a
          href="/dashboard"
          className="mt-8 inline-block w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.98]"
        >
          Go to dashboard
        </a>
      </div>
    </div>
  );
}