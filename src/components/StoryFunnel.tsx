import { useEffect, useState } from "react";
import type { StoryCounts } from "~/lib/story-funnel";

const labels: [keyof StoryCounts, string][] = [
  ["visitors", "Story visitors"],
  ["radar", "Radar after Story"],
  ["signup", "Signup after Story"],
  ["activated", "Activated after Story"],
  ["subscriptions", "Active subscriptions"],
];

export function StoryFunnel({ days = 30 }: { days?: number }) {
  const [counts, setCounts] = useState<StoryCounts | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setCounts(null);
    setError("");
    async function load() {
      try {
        const response = await fetch(`/api/admin/story-funnel?days=${days}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Failed to load story funnel");
        if (!controller.signal.aborted) setCounts(result.counts);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load story funnel");
      }
    }
    void load();
    return () => controller.abort();
  }, [days]);

  return (
    <section aria-labelledby="story-funnel-title">
      <h2 id="story-funnel-title" className="mb-2 text-lg font-semibold text-slate-900">Story funnel</h2>
      <p className="mb-3 text-xs text-slate-500">The Story Behind Contrax → later business activity ({days} days). Each count uses the same story audience. QA/admin/bot/test traffic excluded.</p>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : !counts ? (
        <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Loading story funnel…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {labels.map(([key, label]) => (
            <div key={key} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{counts[key]}</p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Visits to /our-story count once per tracked visitor. Actions must occur after a story visit and within the selected period; these counts show association, not proof that the story caused conversion. Active subscriptions count distinct accounts that signed up afterward and currently have an active subscription. Selected plans do not count as payments.</p>
    </section>
  );
}
