/**
 * Shown where a bid's "view the original solicitation" link would be while the
 * bid is in its paid head start (src/lib/head-start.ts). Honest wording: the
 * bid is real and open, and Starter members can open the official solicitation
 * today. No "opens for free accounts on <date>" line (owner 2026-11-01): the
 * official notice stays members-only after the head start, so that date
 * promised a free path that does not exist and gave buyers a reason to wait.
 */
export function HeadStartLock({ compact = false }: { until?: string; compact?: boolean }) {
  if (compact) {
    return (
      <a
        href="/pricing?source=head_start"
        className="inline-flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-600"
        title="New on Contrax: Starter members can open the official solicitation today."
      >
        <span aria-hidden="true">🔒</span> New: open it today with Starter · $5 for 30 days
      </a>
    );
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">
        <span aria-hidden="true">🔒</span> New bid
      </p>
      <p className="mt-1">
        Starter members can open the official solicitation and start on it today. $5 for 30 days, no automatic renewal.
      </p>
      <a
        href="/pricing?source=head_start"
        className="mt-2 inline-block rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500"
      >
        Open it today with Starter, $5 for 30 days
      </a>
    </div>
  );
}
