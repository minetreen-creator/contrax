import { useEffect, useState } from "react";
import { recapLines, type TrialRecap } from "~/lib/trial-emails";
import { trackEvent } from "~/lib/track";

/**
 * Post-trial dashboard card (owner 2026-10-19): replaces the plain "trial
 * ended" banner with the member's own numbers and the next bids their paused
 * daily email would have carried. Falls back to the plain message when the
 * recap can't load.
 */
type Recap = { show: boolean; recap?: TrialRecap; next?: { id: number; title: string; dueAt: string }[] };

const due = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function TrialEndedCard() {
  const [data, setData] = useState<Recap | null>(null);
  useEffect(() => {
    fetch("/api/trial-recap", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Recap | null) => {
        setData(d);
        if (d?.show) trackEvent("trial_recap_shown");
      })
      .catch(() => setData(null));
  }, []);
  const lines = data?.recap ? recapLines(data.recap) : [];
  const next = data?.next ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-slate-900">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-800">Your trial has ended · you're on free Basic</p>
        <h2 className="mt-1 text-lg font-bold">Your daily bid email is paused</h2>
        {lines.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-slate-800">{lines.map((l) => <li key={l}>• {l}</li>)}</ul>
        ) : (
          <p className="mt-2 text-sm text-slate-800">Search still works. Starter brings back the daily bid email, every state and trade, same-day new bids, unlimited saved bids and who to contact on federal bids.</p>
        )}
        {next.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
            <p className="text-sm font-semibold">Next in your daily email if you keep it:</p>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {next.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{b.title}</span>
                  <span className="shrink-0 text-xs font-semibold text-red-700">Closes {due(b.dueAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <a
          href="/upgrade?utm_source=dashboard&utm_campaign=trial_ended"
          onClick={() => trackEvent("trial_recap_upgrade_click")}
          className="mt-4 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800"
        >
          Keep my bids coming: Starter, $5 first month →
        </a>
        <p className="mt-2 text-xs text-slate-600">Then $19/month. Cancel anytime.</p>
      </div>
    </div>
  );
}
