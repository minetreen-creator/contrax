import { useEffect, useRef, useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADES } from "~/lib/seo-trades";
import { countAt } from "~/lib/money-counter";
import { fiscalYearLabel, formatDollars, recompetesHref } from "~/lib/federal-trade-data";
import { clampWins, MAX_WINS, MIN_WINS, potentialValue, type WinCalculatorResult } from "~/lib/win-calculator";
import { trackEvent } from "~/lib/track";

const DURATION = 1200;

export function useCountUp(target: number): number {
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

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function WinCalculator({ embedded = false }: { embedded?: boolean } = {}) {
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [wins, setWins] = useState(3);
  const [data, setData] = useState<WinCalculatorResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!trade || !state) { setData(null); return; }
    let alive = true;
    setStatus("loading");
    fetch(`/api/win-calculator?trade=${encodeURIComponent(trade)}&state=${encodeURIComponent(state)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const body = (await r.json()) as WinCalculatorResult;
        if (alive) { setData(body); setStatus("idle"); }
      })
      .catch(() => { if (alive) setStatus("error"); });
    trackEvent("win_calculator_pick", `${trade}:${state}`);
    return () => { alive = false; };
  }, [trade, state]);

  const potential = potentialValue(data?.typicalContract ?? null, wins);
  const spent = useCountUp(data?.spent ?? 0);
  const setAside = useCountUp(data?.setAside ?? 0);
  const win = useCountUp(potential ?? 0);
  const tradeLabel = SEO_TRADES.find((t) => t.slug === trade)?.label ?? "";
  const stateName = STATE_NAMES[state] ?? state;
  const states = Object.keys(STATE_NAMES).sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]));
  const select = "rounded-lg border border-white/30 bg-white/10 px-3 py-2.5 text-white focus-visible:outline-2 focus-visible:outline-amber-300 [&>option]:text-slate-900";

  return (
    <section aria-labelledby="win-calculator-title" className={embedded ? "" : "mx-auto mt-10 max-w-[1120px] px-4 sm:px-6"}>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#14213d] via-[#1f3a6b] to-[#0b1f45] p-6 text-white shadow-xl sm:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
        <p className="relative text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Try it</p>
        <h2 id="win-calculator-title" className="relative mt-2 text-3xl font-extrabold sm:text-4xl">What could you win?</h2>
        <p className="relative mt-2 max-w-2xl text-slate-200">Pick your trade and state to see what the federal government spent on work like yours, and what a few contracts could be worth.</p>

        <div className="relative mt-6 flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Your trade
            <select value={trade} onChange={(e) => setTrade(e.target.value)} className={select}>
              <option value="">Choose a trade</option>
              {SEO_TRADES.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Your state
            <select value={state} onChange={(e) => setState(e.target.value)} className={select}>
              <option value="">Choose a state</option>
              {states.map((c) => <option key={c} value={c}>{STATE_NAMES[c]}</option>)}
            </select>
          </label>
        </div>

        {status === "error" && <p role="alert" className="relative mt-6 text-amber-200">Figures are unavailable right now. Please try again shortly.</p>}

        {data && status !== "error" && (
          <div className="relative mt-8 grid gap-4 md:grid-cols-3" aria-live="polite">
            <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
              <p className="text-sm text-slate-300">Federal {tradeLabel.toLowerCase()} spending in {stateName}</p>
              <p className="mt-2 font-[Georgia,serif] text-3xl font-bold tabular-nums text-amber-300">{data.spent > 0 ? money(spent) : "No record"}</p>
              <p className="mt-1 text-xs text-slate-400">{data.fiscalYear ? `Fiscal year ${fiscalYearLabel(data.fiscalYear)}` : "No spending figures stored yet"}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
              <p className="text-sm text-slate-300">Set aside for small businesses</p>
              <p className="mt-2 font-[Georgia,serif] text-3xl font-bold tabular-nums text-emerald-300">{data.spent > 0 ? money(setAside) : "—"}</p>
              <p className="mt-1 text-xs text-slate-400">{data.topAgencies.length ? `Top buyers: ${data.topAgencies.map((a) => a.name).join(", ")}` : "Top buyers not available"}</p>
            </div>
            <div className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-5">
              <p className="text-sm text-slate-200">
                Win <b className="text-amber-300">{wins}</b> contract{wins === 1 ? "" : "s"} this size
              </p>
              <p className="mt-2 font-[Georgia,serif] text-3xl font-bold tabular-nums text-white">{potential != null ? money(win) : "Not enough data"}</p>
              <input
                type="range"
                min={MIN_WINS}
                max={MAX_WINS}
                value={wins}
                onChange={(e) => setWins(clampWins(Number(e.target.value)))}
                aria-label="Number of contracts won"
                className="mt-3 w-full accent-amber-400"
              />
              <p className="mt-1 text-xs text-slate-400">
                {data.typicalContract != null
                  ? `Typical contract: ${formatDollars(data.typicalContract)} total value (median of ${data.contractCount} running contracts). Total contract value, not yearly revenue.`
                  : "Fewer than 3 running contracts here, so there's no typical size to show."}
              </p>
            </div>
          </div>
        )}

        <div className="relative mt-6 flex flex-wrap gap-3">
          <a
            href={trade && state ? `/radar?trade=${encodeURIComponent(SEO_TRADES.find((t) => t.slug === trade)?.radarTerm ?? trade)}&state=${state}` : "/radar"}
            onClick={() => trackEvent("win_calculator_click", "radar")}
            className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:brightness-105"
          >
            See open bids like these →
          </a>
          {trade && state && (
            <a href={recompetesHref(trade, state)} onClick={() => trackEvent("win_calculator_click", "recompetes")} className="rounded-xl border border-white/30 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">
              Contracts ending soon in {stateName}
            </a>
          )}
        </div>
        <p className="relative mt-4 text-xs text-slate-400">Figures from public USAspending.gov records. Past spending doesn't guarantee future awards.</p>
      </div>
    </section>
  );
}
