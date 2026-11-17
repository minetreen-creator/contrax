import { useState, type FormEvent } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { landingSearchHref } from "~/lib/landing-search";
import { trackEvent } from "~/lib/track";

const STATES = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

/**
 * "Not your trade?" on a state-and-trade page (owner 2026-11-16). The visitor types what they do,
 * keeps or changes the state, and lands on Radar's results for it.
 */
export function LandingSearch({ stateCode, tradeLabel }: { stateCode: string; tradeLabel?: string }) {
  const [trade, setTrade] = useState("");
  const [state, setState] = useState(stateCode);
  const [nudge, setNudge] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const href = landingSearchHref(trade, state);
    if (!href) { setNudge(true); return; }
    trackEvent("state_page_click", "landing_search");
    window.location.href = href;
  }

  return (
    <section className="mx-auto mt-6 max-w-3xl px-4">
      <form onSubmit={submit} className="rounded-2xl border border-slate-300 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-slate-900">
          {tradeLabel ? `Not in ${tradeLabel.toLowerCase()}? Search your own trade.` : "Search your own trade."}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
          <input
            value={trade}
            onChange={(e) => { setTrade(e.target.value); setNudge(false); }}
            placeholder="Roofing, painting, HVAC, paving…"
            aria-label="Your trade"
            maxLength={80}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900"
          />
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900">
            <option value="">Any state</option>
            {STATES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
            Search bids →
          </button>
        </div>
        {nudge && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">Type what you do first, like "roofing".</p>}
      </form>
    </section>
  );
}
