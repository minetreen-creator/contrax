import { useState } from "react";
import { federalConstructionStates } from "~/lib/federal-construction";
import { WINNERS_FORMAT_NOTE, WINNERS_INCLUDES, WINNERS_PRICE } from "~/lib/state-winners";
import { trackEvent } from "~/lib/track";

/**
 * The $29 state winners list (owner 2026-11-19). One choice (the state) and one button that goes
 * straight to Stripe; no account and no form beyond that.
 */
export function WinnersListOffer({ source }: { source: string }) {
  const states = federalConstructionStates().slice().sort((a, b) => a.name.localeCompare(b.name));
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function buy(e: React.FormEvent) {
    e.preventDefault();
    if (!state) { setError("Choose your state."); return; }
    setBusy(true);
    setError("");
    trackEvent("winners_list_checkout", state, source);
    try {
      const res = await fetch("/api/state-winners/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && j.url) { window.location.href = j.url; return; }
      setError(j.error || "Checkout is unavailable right now. Please try again.");
    } catch {
      setError("Checkout is unavailable right now. Please try again.");
    }
    setBusy(false);
  }

  return (
    <section id="list" aria-labelledby="winners-list-title" className="mt-10 rounded-2xl border-2 border-amber-400 bg-white p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-600">For suppliers, subcontractors and sales teams</p>
      <h2 id="winners-list-title" className="mt-1 text-xl font-bold">Get the full list of who won in your state: {WINNERS_PRICE}</h2>
      <p className="mt-2 text-sm text-slate-700">
        The table above is the summary. The list is every contract behind it: the company that won, where it is based and how much the job is
        worth. These are the companies buying materials, renting equipment and hiring subs for federal work in your state right now.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {WINNERS_INCLUDES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">{WINNERS_FORMAT_NOTE}</p>
      <form onSubmit={buy} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="winners-state" className="sr-only">Your state</label>
        <select
          id="winners-state"
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        >
          <option value="">Choose your state</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.awards.toLocaleString("en-US")}+ contracts)
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60">
          {busy ? "Opening checkout…" : `Get my state's list for ${WINNERS_PRICE} →`}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">One payment by card through Stripe. Nothing renews. The file downloads right after payment and the link is emailed to you.</p>
    </section>
  );
}
