import { useEffect, useState } from "react";
import type { LearningCounts } from "~/lib/learn-funnel";
export function LearnFunnel({ days = 30 }: { days?: number }) {
  const [counts, setCounts] = useState<LearningCounts | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false; setCounts(null); setError("");
    fetch(`/api/admin/learn-funnel?days=${days}`).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to load learning funnel");
      if (!cancelled) setCounts(result.counts);
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load learning funnel"); });
    return () => { cancelled = true; };
  }, [days]);
  const labels: [keyof LearningCounts, string][] = [["visitors", "Learning visitors"], ["opened", "Course opened"], ["completed", "Course completed"], ["radar", "Radar after Learn"], ["signup", "Signup after Learn"], ["activated", "Activated after Learn"], ["subscriptions", "Active subscriptions"]];
  return <section aria-labelledby="learn-funnel-title">
    <h2 id="learn-funnel-title" className="mb-2 text-lg font-semibold text-slate-900">Learn funnel</h2>
    <p className="mb-3 text-xs text-slate-500">Learning visits → course activity → later business activity ({days} days). Course completion is optional; each count uses the same learning audience. QA/admin/bot/test traffic excluded.</p>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : !counts ? <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Loading learning funnel…</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{labels.map(([key, label]) => <div key={key} className="rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{counts[key]}</p></div>)}</div>}
    <p className="mt-2 text-xs text-slate-500">Visits include the Learn hub and all three course pages. Later actions must follow a learning visit in this period. Completion means a certificate was recorded. Active subscriptions count distinct accounts that signed up afterward and currently have an active subscription; selected plans and certificates do not count as payments.</p>
  </section>;
}
