// ── ReviewPager ─────────────────────────────────────────────────────────────
// Review-continuity chrome for a single-match review view. Gives the user
// Back to Results (returns to the full result set), and Previous / Next
// Opportunity that iterate the CURRENT result set (same filter context) — the
// parent keeps the ordered result list + a cursor, so it never re-runs the
// query from scratch.
//
// Mobile-first: wraps gracefully at narrow widths; the position indicator
// ("5 of 42") is always visible so the user always knows where they are.

export interface ReviewPagerProps {
  /** 0-based index of the currently-focused match within the result set, or -1 if none. */
  position: number;
  /** Total size of the current result set. */
  total: number;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** Optional label for the result set, e.g. "Open / Closing Soon". */
  setLabel?: string;
}

export function ReviewPager({ position, total, onBack, onPrev, onNext, setLabel }: ReviewPagerProps) {
  const hasPrev = position > 0;
  const hasNext = position >= 0 && position < total - 1;
  const atMatch = position >= 0 && total > 0;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Results
        </button>
        {setLabel ? <span className="hidden truncate text-xs text-slate-400 sm:inline">{setLabel}</span> : null}
      </div>

      {atMatch && (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
          {position + 1} of {total}
        </span>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
