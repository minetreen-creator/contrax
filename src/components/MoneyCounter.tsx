import { useEffect, useRef, useState } from "react";
import { STATE_NAMES, type ContractMapAggregate } from "~/lib/contract-map";
import { counterFigures, countAt, type EndingByState } from "~/lib/money-counter";
import { trackEvent } from "~/lib/track";

const DURATION = 1600;

function useCountUp(target: number): number {
  // Server render shows the real figure (crawlers, slow phones); the browser
  // then counts up to it from 0.
  const [value, setValue] = useState(target);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { fromRef.current = target; setValue(target); return; }
    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const v = countAt(from, target, now - start, DURATION);
      setValue(v);
      fromRef.current = v;
      if (now - start < DURATION) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

export function MoneyCounter({
  contractMap,
  ending,
  endingByState,
  agencyCount = 0,
}: {
  contractMap: ContractMapAggregate | null;
  ending: { count: number; total: number } | null;
  endingByState: EndingByState;
  /** Former homepage stats row (owner 2026-10-17), shown as a footnote here. */
  agencyCount?: number;
}) {
  const [state, setState] = useState("US");
  const f = counterFigures(state, contractMap, ending, endingByState);
  const dollars = useCountUp(f.endingTotal);
  const federal = useCountUp(f.federalOpen);
  const stateLocal = useCountUp(f.stateLocalOpen);
  if (!contractMap && !ending) return null;
  const where = state === "US" ? "nationwide" : `in ${STATE_NAMES[state] ?? state}`;
  // No per-state split (lookup failed): hide the picker rather than show $0 per state.
  const canPickState = Object.keys(endingByState).length > 0;
  const states = Object.keys(STATE_NAMES).sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]));

  return (
    <section aria-labelledby="money-counter-title" className="mx-auto mt-10 max-w-[1120px] px-4 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1f45] via-[#12357a] to-[#0b1f45] p-6 text-center text-white shadow-xl sm:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
        <h2 id="money-counter-title" className="relative text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
          Government money on the move {where}
        </h2>
        <p className="relative mt-4 break-words font-[Georgia,serif] text-5xl font-extrabold tabular-nums text-amber-300 drop-shadow sm:text-7xl" aria-live="polite">
          ${dollars.toLocaleString("en-US")}
        </p>
        <p className="relative mt-3 text-base text-slate-200 sm:text-lg">
          in federal contracts ending in the next 12 months ({f.endingCount.toLocaleString("en-US")} contracts). Each one could be rebid.
        </p>
        {/* Owner 2026-10-19: TWO honest figures, never one blended all-source
            count presented as federal. Federal rows are those whose source is a
            federal feed (same classifier as the "Federal" badge). */}
        <div className="relative mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="font-[Georgia,serif] text-4xl font-bold tabular-nums sm:text-5xl" aria-live="polite">{federal.toLocaleString("en-US")}</p>
            <p className="mt-1 text-sm text-slate-300 sm:text-base">open federal bids {where} right now</p>
          </div>
          <div>
            <p className="font-[Georgia,serif] text-4xl font-bold tabular-nums sm:text-5xl" aria-live="polite">{stateLocal.toLocaleString("en-US")}</p>
            <p className="mt-1 text-sm text-slate-300 sm:text-base">open state &amp; local bids {where} right now</p>
          </div>
        </div>
        {canPickState && <label className="relative mt-6 inline-flex flex-wrap items-center justify-center gap-2 text-sm font-semibold">
          See your state
          <select
            value={state}
            onChange={(e) => { setState(e.target.value); trackEvent("money_counter_state", e.target.value); }}
            className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-amber-300 [&>option]:text-slate-900"
          >
            <option value="US">All states</option>
            {states.map((c) => <option key={c} value={c}>{STATE_NAMES[c]}</option>)}
          </select>
        </label>}
        <div className="relative mt-6 flex flex-wrap justify-center gap-3">
          <a href={state === "US" ? "/radar" : `/radar?state=${state}`} onClick={() => trackEvent("money_counter_click", "radar")} className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:brightness-105">
            Find bids for my business →
          </a>
          <a href="/recompetes" onClick={() => { trackEvent("money_counter_click", "recompetes"); trackEvent("recompetes_home_click"); }} className="rounded-xl border border-white/30 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">
            See contracts ending soon
          </a>
        </div>
        <p className="relative mt-4 text-xs text-slate-400">
          {agencyCount > 0 && <>Open bids from {agencyCount.toLocaleString("en-US")} agencies, refreshed every 4 hours on weekdays. </>}
          Contract values from public USAspending.gov records.
        </p>
      </div>
    </section>
  );
}
