/**
 * Reusable trial gating for Contrax product pages.
 *
 * <TrialGate> shows its children while the user is in their 21-day trial or on
 * a paid plan, and swaps in a full-screen upgrade prompt when the trial has
 * expired (restricted access). <TrialUpgradeCallout> is the gentler, inline
 * reminder for pages we don't want to fully gate (e.g. the workspace).
 */
import { useEffect, useState, type ReactNode } from "react";
import { checkTrial, type TrialStatus } from "~/lib/trial";

/** Full-screen takeover shown when a user's trial has expired. */
export function TrialExpiredScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl" aria-hidden="true">⏳</span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Your trial has ended</h1>
        <p className="mt-3 text-slate-600">
          Subscribe to keep using Contrax — bid matching, AI scoring, proposal drafting, and deadline tracking stay available on every plan.
        </p>
        <a href="/upgrade" className="mt-7 inline-flex rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition hover:bg-slate-800">
          View plans →
        </a>
        <p className="mt-4 text-xs text-slate-400">Plans start at $49/mo — no setup fees, cancel anytime.</p>
      </div>
    </div>
  );
}

/**
 * Gates a protected page behind trial status. Renders children while the
 * status is loading (avoids a flash) and while the user is in trial or on a
 * paid plan; renders <TrialExpiredScreen> when the trial has expired.
 */
export function TrialGate({ children }: { children: ReactNode }) {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  useEffect(() => {
    checkTrial().then(setTrial).catch(() => {});
  }, []);
  if (trial?.expired) return <TrialExpiredScreen />;
  return <>{children}</>;
}

/**
 * Gentle, non-blocking upgrade reminder for trial users. Renders nothing for
 * paid users or when trial status is still loading. Place it inside the page
 * container (e.g. above the main content).
 */
export function TrialUpgradeCallout() {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  useEffect(() => {
    checkTrial().then(setTrial).catch(() => {});
  }, []);
  if (!trial?.active) return null;
  const endLabel = trial.endsAt
    ? new Date(trial.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Your 21-day trial · <strong>{trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left</strong>
        {endLabel ? <span className="text-amber-700"> · ends {endLabel}</span> : null}
      </span>
      <a href="/upgrade" className="shrink-0 font-semibold text-blue-700 underline hover:text-blue-800">
        Upgrade before it ends →
      </a>
    </div>
  );
}
