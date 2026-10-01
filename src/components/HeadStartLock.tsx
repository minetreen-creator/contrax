/**
 * Shown where a bid's "view the original solicitation" link would be while the
 * bid is in its paid head start (src/lib/head-start.ts). Honest wording: the
 * bid is real and open; paying members can open it now; it opens for free
 * accounts on the date shown.
 */
import { HEAD_START_HOURS, headStartOpensLabel } from "~/lib/head-start";

export function HeadStartLock({ until, compact = false }: { until: string; compact?: boolean }) {
  const opens = headStartOpensLabel(until);
  if (compact) {
    return (
      <a
        href="/pricing?source=head_start"
        className="inline-flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-600"
        title={`New on Contrax: Starter members get the solicitation now. It opens for free accounts on ${opens}.`}
      >
        <span aria-hidden="true">🔒</span> New: Starter sees it now · free on {opens}
      </a>
    );
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">
        <span aria-hidden="true">🔒</span> New bid: paying members get a {HEAD_START_HOURS / 24}-day head start
      </p>
      <p className="mt-1">
        Starter members can open the solicitation and start on it today. It opens for free accounts on {opens}.
      </p>
      <a
        href="/pricing?source=head_start"
        className="mt-2 inline-block rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500"
      >
        See it now with Starter, $19/month
      </a>
    </div>
  );
}
