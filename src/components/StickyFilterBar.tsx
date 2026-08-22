// ── StickyFilterBar ─────────────────────────────────────────────────────────
// Mobile-first sticky filter bar shared by the onboarding match review and the
// dashboard matched-bid review. Shows the ACTIVE filter context as tappable
// chips in a horizontally-scrollable row, so at narrow widths it never breaks
// layout, and lets the user change the view filters (set-aside-only, sort)
// inline without restarting the flow. Geo / set-aside / NAICS chips hand off to
// an editor provided by the parent (e.g. the profile editor) so changing them
// never dumps the user back at the start. Each profile-level chip can ALSO show
// an inline "X" remove button (onRemoveGeo / onRemoveSetAside / onRemoveNaics)
// that removes THAT filter immediately (persisting to the profile + re-query),
// so the user can narrow/broaden without leaving the review.

import type { ReviewFilterState, SortKey } from "~/lib/review-context";
import { SORTS } from "~/lib/review-context";
import type { ReactNode } from "react";

export interface StickyFilterBarProps {
  states: string[];
  /** Human label of the active set-aside/cert. Empty/"All" → no set-aside filter. */
  setAsideLabel: string;
  naics: string[];
  sort: SortKey;
  setAsideOnly: boolean;
  /** Optional: number of matches in the current result set (shown as a badge). */
  total?: number;
  onPatch: (p: Partial<ReviewFilterState>) => void;
  /** Handlers for changing the business-profile-level filters (omitted = read-only chip). */
  onChangeGeo?: () => void;
  onChangeSetAside?: () => void;
  onChangeNaics?: () => void;
  /** Handlers for INLINE removal of a filter (persist + re-query). Omitted = no X shown. */
  onRemoveGeo?: () => void;
  onRemoveSetAside?: () => void;
  onRemoveNaics?: () => void;
}

function XButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-full p-0.5 text-current opacity-60 transition-opacity hover:opacity-100"
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

function Chip({
  onClick,
  remove,
  removeLabel,
  className,
  title,
  children,
}: {
  onClick?: () => void;
  remove?: () => void;
  removeLabel?: string;
  className: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      role="listitem"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border py-0.5 pl-2.5 pr-1.5 ${className}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="inline-flex items-center gap-1 text-xs font-semibold disabled:cursor-default disabled:opacity-90"
        title={title}
      >
        {children}
      </button>
      {remove && <XButton onClick={remove} label={removeLabel ?? "Remove filter"} />}
    </span>
  );
}

export function StickyFilterBar(props: StickyFilterBarProps) {
  const {
    states,
    setAsideLabel,
    naics,
    sort,
    setAsideOnly,
    total,
    onPatch,
    onChangeGeo,
    onChangeSetAside,
    onChangeNaics,
    onRemoveGeo,
    onRemoveSetAside,
    onRemoveNaics,
  } = props;

  const geoText = states.length > 0 ? states.join(", ") : "All states";
  const naicsText = naics.length > 0 ? `${naics.length} NAICS` : "Any trade";

  return (
    <div
      aria-label="Active filters"
      className="sticky top-14 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur sm:top-14 sm:mx-0 sm:rounded-xl sm:border sm:shadow"
    >
      <div className="flex items-center gap-2">
        <span className="hidden shrink-0 text-[11px] font-bold uppercase tracking-wider text-slate-400 sm:inline">
          Filters
        </span>
        {typeof total === "number" && (
          <span className="hidden shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white sm:inline">
            {total} matches
          </span>
        )}
        {/* Horizontally scrollable chip row (mobile-first) */}
        <div
          role="list"
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none"
        >
          {/* Geo */}
          <Chip
            onClick={onChangeGeo}
            remove={onRemoveGeo}
            removeLabel="Remove state filter"
            className={
              onChangeGeo
                ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }
            title={onChangeGeo ? "Change states" : "States"}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="max-w-[7rem] truncate">{geoText}</span>
            {onChangeGeo && <span aria-hidden="true">⌄</span>}
          </Chip>

          {/* Set-aside / cert */}
          <Chip
            onClick={onChangeSetAside}
            remove={onRemoveSetAside}
            removeLabel="Remove set-aside filter"
            className={
              onChangeSetAside
                ? "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }
            title={onChangeSetAside ? "Change set-aside / certification" : "Set-aside"}
          >
            <span aria-hidden="true">🏷</span>
            <span className="max-w-[9rem] truncate">{setAsideLabel}</span>
            {onChangeSetAside && <span aria-hidden="true">⌄</span>}
          </Chip>

          {/* NAICS */}
          <Chip
            onClick={onChangeNaics}
            remove={onRemoveNaics}
            removeLabel="Remove NAICS filter"
            className={
              onChangeNaics
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }
            title={onChangeNaics ? "Change NAICS codes (trade)" : "NAICS"}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            </svg>
            <span>{naicsText}</span>
            {onChangeNaics && <span aria-hidden="true">⌄</span>}
          </Chip>

          {/* Set-Aside Only — inline toggle */}
          <button
            type="button"
            role="listitem"
            aria-pressed={setAsideOnly}
            onClick={() => onPatch({ setAsideOnly: !setAsideOnly, feedTab: "live" })}
            title="Show only bids with a set-aside designation"
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
              setAsideOnly
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Set-Aside Only
          </button>

          {/* Sort — inline select */}
          <label className="sr-only" htmlFor="stickysort">Sort by</label>
          <select
            id="stickysort"
            role="listitem"
            value={sort}
            onChange={(e) => onPatch({ sort: e.target.value as SortKey })}
            className="inline-flex shrink-0 cursor-pointer items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
