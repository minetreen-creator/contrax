/**
 * TrialChecklist — user-visible 21-day PROFESSIONAL trial checklist.
 *
 * Shows the 4 owner-specified trial items with live remaining counts, derived
 * from the per-trial `trial_usage` ledger (src/lib/trial-usage.ts):
 *   ✅ / ⬜ Generate an Executive Brief   (5 left)
 *   ✅ / ⬜ Review incumbent pricing      (3 left)
 *   ✅ / ⬜ Score an opportunity          (3 left)
 *   ✅ / ⬜ Start a proposal draft        (1 left)
 *
 * An item is complete once its corresponding usage counter is > 0. The card
 * only renders for a user inside an ACTIVE Professional trial (expired / paid /
 * never-started users see nothing). It carries a single "Upgrade to
 * Professional" CTA — no "unlimited" claims (the trial is capped).
 */
import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import { loadUserTrialStatus } from "~/lib/trial";
import { getTrialUsage, TRIAL_CHECKLIST, type TrialUsage } from "~/lib/trial-usage";

const loadTrialChecklist = createServerFn({ method: "GET" }).handler(async (): Promise<{
  active: boolean;
  daysLeft: number;
  usage: TrialUsage;
}> => {
  const user = await getCurrentUser();
  if (!user) return { active: false, daysLeft: 0, usage: { active: false, trialStartedAt: null, briefs: 0, scores: 0, drafts: 0, incumbent: 0 } };
  const trial = await loadUserTrialStatus(user.id);
  const usage = await getTrialUsage(user.id);
  return { active: trial.active, daysLeft: trial.daysLeft, usage };
});

export function TrialChecklist() {
  const [data, setData] = useState<{ active: boolean; daysLeft: number; usage: TrialUsage } | null>(null);
  useEffect(() => {
    loadTrialChecklist()
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data?.active) return null;
  const u = data.usage;
  const counts: Record<string, number> = { briefs: u.briefs, incumbent: u.incumbent, scores: u.scores, drafts: u.drafts };
  const item = (key: string, used: number, limit: number) => ({
    done: used > 0,
    remaining: Math.max(0, limit - used),
  });
  return (
    <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">⚡ Your 21-day Professional trial</h3>
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
          {data.daysLeft} day{data.daysLeft === 1 ? "" : "s"} left
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Started on your first premium action. When it ends you&rsquo;ll keep your saved bids &amp; progress —
        only the premium tools lock.
      </p>
      <ul className="mt-4 space-y-2">
        {TRIAL_CHECKLIST.map((c) => {
          const st = item(c.key, counts[c.key] ?? 0, c.limit);
          return (
            <li key={c.key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-slate-700">
                <span aria-hidden="true" className={st.done ? "text-green-600" : "text-slate-300"}>
                  {st.done ? "✅" : "⬜"}
                </span>
                {c.label}
              </span>
              <span className={`text-xs font-semibold ${st.done ? "text-green-600" : "text-slate-500"}`}>
                {st.done ? "Done" : `${st.remaining} left`}
              </span>
            </li>
          );
        })}
      </ul>
      <a
        href="/upgrade"
        className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        Upgrade to Professional →
      </a>
    </div>
  );
}
