import { trackEvent } from "~/lib/track";

/**
 * Conversion CTA card — single source of truth for the clause/part-page
 * conversion card (extracted from the PR #146 clause-page card; reused
 * verbatim on part pages so h2/amber link/library link/funnel events stay
 * identical everywhere).
 */
export function ClauseCtaCard() {
  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
      <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Have a solicitation to win?</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        Paste it into the free Contrax bid scorer — get an AI win-probability
        score with the FAR clauses that matter, in seconds. No signup required.
      </p>
      <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <a
          href="/score"
          onClick={() => trackEvent("clause_cta_click", "score")}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 active:scale-[0.98]"
        >
          Score any bid — free
        </a>
        <a
          href="/clauses"
          onClick={() => trackEvent("clause_cta_click", "library")}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
        >
          Browse the full FAR &amp; DFARS library
        </a>
      </div>
    </div>
  );
}
