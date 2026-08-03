import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import { TrialGate } from "~/components/TrialGate";
import { getUserPatterns, generateInsights, getImplicitPreferences, type UserPatterns, type ImplicitPreference } from "~/lib/learning";

// ── Server Functions ─────────────────────────────────────────────────────────

const fetchLearnings = createServerFn({ method: "GET" }).handler(async (): Promise<{
  patterns: UserPatterns;
  insights: string[];
  preferences: ImplicitPreference[];
}> => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  const patterns = await getUserPatterns(user.email);
  const insights = patterns.total >= 2 ? await generateInsights(user.email) : [];
  const preferences = await getImplicitPreferences(user.email);
  return { patterns, insights, preferences };
});

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/learnings")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return fetchLearnings();
  },

  head: () => ({
    meta: [
      { title: "Learning Engine | Contrax" },
      { name: "description", content: "Track win/loss patterns and get AI-powered recommendations to improve your government contract bid strategy." },
    ],
  }),
});

/** Trial gate: expired-trial users see an upgrade prompt instead of the page. */
function LearningsPageGated() {
  return (
    <TrialGate>
      <LearningsPage />
    </TrialGate>
  );
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function winRateColor(rate: number): string {
  if (rate >= 70) return "text-green-600";
  if (rate >= 40) return "text-amber-600";
  return "text-red-600";
}

function winRateBg(rate: number): string {
  if (rate >= 70) return "bg-green-50 border-green-200";
  if (rate >= 40) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

// ── Component ────────────────────────────────────────────────────────────────

function LearningsPage() {
  const navigate = useNavigate();
  const data = Route.useLoaderData() as { patterns: UserPatterns; insights: string[]; preferences: ImplicitPreference[] } | null;
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState<ImplicitPreference[]>(data?.preferences ?? []);
  const [patterns, setPatterns] = useState<UserPatterns | null>(data?.patterns ?? null);
  const [insights, setInsights] = useState<string[]>(data?.insights ?? []);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data) {
      setLoading(true);
      fetchLearnings()
        .then((d) => { setPatterns(d.patterns); setInsights(d.insights); setPreferences(d.preferences); })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
        .finally(() => setLoading(false));
    }
  }, [data]);

  const refreshInsights = async () => {
    setInsightsLoading(true);
    try {
      const fresh = await generateInsights(/* will be called via fetchLearnings */);
      const d = await fetchLearnings();
      setInsights(d.insights);
      setPatterns(d.patterns);
      setPreferences(d.preferences);
    } catch {
      setError("Failed to refresh insights");
    } finally {
      setInsightsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <a href="/dashboard" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-amber-400">✦</span>
              <b className="text-lg text-slate-900">Contrax</b>
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 w-64 bg-slate-200 rounded" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-200 rounded-2xl" />)}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const p = patterns;
  const totalTracked = p ? p.total : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <a href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-amber-400">✦</span>
            <b className="text-lg text-slate-900">Contrax</b>
          </a>
          <div className="flex items-center gap-4 text-sm">
            <a href="/dashboard" className="text-slate-500 hover:text-slate-900">Dashboard</a>
            <a href="/losses" className="text-slate-500 hover:text-slate-900">Losses</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {error}
            <button type="button" onClick={() => setError("")} className="ml-2 underline hover:no-underline">Dismiss</button>
          </div>
        )}

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">🧠 Learning Engine</h1>
          <p className="mt-2 text-slate-500">
            Your win/loss history feeds back into the AI to make bid predictions smarter over time.
          </p>
        </div>

        {/* Learned Preferences */}
        <section className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-bold text-slate-900">✨ Learned Preferences</h2>
          <p className="mt-1 text-sm text-slate-600">Inferred from the bids you save and dismiss, not just your onboarding profile.</p>
          {preferences.length > 0 ? <ul className="mt-4 space-y-3">{preferences.map((pref) => <li key={pref.label} className="flex items-start gap-3 text-sm text-slate-700"><span className="mt-1 text-amber-600">•</span><span><strong>{pref.label}</strong> — {pref.detail}</span></li>)}</ul> : <p className="mt-4 text-sm text-slate-500">Save or dismiss a few bids to reveal your preferences.</p>}
        </section>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Tracked</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{totalTracked}</p>
          </div>
          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-600">Wins</p>
            <p className="mt-2 text-3xl font-bold text-green-700">{p?.wins ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Losses</p>
            <p className="mt-2 text-3xl font-bold text-red-700">{p?.losses ?? 0}</p>
          </div>
          <div className={`rounded-2xl border p-5 shadow-sm ${p ? winRateBg(p.winRate) : "bg-slate-50 border-slate-200"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Win Rate</p>
            <p className={`mt-2 text-3xl font-bold ${p ? winRateColor(p.winRate) : "text-slate-400"}`}>
              {p ? `${p.winRate}%` : "—"}
            </p>
          </div>
        </div>

        {totalTracked === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
              <span className="text-3xl">🧠</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900">No learning data yet</h2>
            <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
              Record your wins and losses on the{" "}
              <a href="/losses" className="font-medium text-amber-600 hover:text-amber-500 underline">Losses page</a>{" "}
              to start building your learning engine. Every outcome makes future AI predictions smarter.
            </p>
            <a
              href="/losses"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 transition-colors"
            >
              Record your first outcome →
            </a>
          </div>
        ) : (
          <>
            {/* AI Insights */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-slate-900">💡 AI Insights</h2>
                <button
                  type="button"
                  onClick={refreshInsights}
                  disabled={insightsLoading}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                >
                  {insightsLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              {insights.length > 0 ? (
                <div className="space-y-3">
                  {insights.map((insight, i) => (
                    <div key={i} className="rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                          {i + 1}
                        </span>
                        <p className="text-sm text-slate-700 leading-relaxed">{insight}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                  Record at least 2 outcomes to unlock AI-powered insights and recommendations.
                </div>
              )}
            </section>

            {/* Patterns Grid */}
            <div className="grid gap-8 lg:grid-cols-2 mb-8">
              {/* Best NAICS */}
              {p && p.byNaics.length > 0 && (
                <section>
                  <h2 className="mb-3 text-lg font-bold text-slate-900">Best NAICS Codes</h2>
                  <div className="space-y-2">
                    {p.byNaics.slice(0, 5).map((n) => (
                      <div key={n.code} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3">
                        <div>
                          <span className="font-mono text-sm font-semibold text-slate-800">{n.code}</span>
                          <span className="ml-2 text-xs text-slate-500">{n.total} bids</span>
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${n.winRate >= 70 ? "bg-green-100 text-green-700" : n.winRate >= 40 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                          {n.winRate}%
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Best Agencies */}
              {p && p.byAgency.length > 0 && (
                <section>
                  <h2 className="mb-3 text-lg font-bold text-slate-900">Best Agencies</h2>
                  <div className="space-y-2">
                    {p.byAgency.slice(0, 5).map((a) => (
                      <div key={a.agency} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3">
                        <div>
                          <span className="text-sm font-semibold text-slate-800">{a.agency}</span>
                          <span className="ml-2 text-xs text-slate-500">{a.total} bids</span>
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${a.winRate >= 70 ? "bg-green-100 text-green-700" : a.winRate >= 40 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                          {a.winRate}%
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Value Ranges */}
            {p && p.byValueRange.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-lg font-bold text-slate-900">Performance by Value Range</h2>
                <div className="space-y-2">
                  {p.byValueRange.map((r) => (
                    <div key={r.range} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-4">
                      <div>
                        <span className="text-sm font-semibold text-slate-800">{r.range}</span>
                        <span className="ml-2 text-xs text-slate-500">{r.total} bids</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Mini progress bar */}
                        <div className="hidden sm:block w-32 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.winRate >= 70 ? "bg-green-500" : r.winRate >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${r.winRate}%` }}
                          />
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${r.winRate >= 70 ? "bg-green-100 text-green-700" : r.winRate >= 40 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                          {r.winRate}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Recent Outcomes */}
            {p && p.recentOutcomes.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-lg font-bold text-slate-900">Recent Outcomes</h2>
                <div className="space-y-2">
                  {p.recentOutcomes.slice(0, 10).map((o) => (
                    <div
                      key={o.id}
                      className={`flex items-center justify-between rounded-lg border p-4 ${
                        o.won ? "border-green-100 bg-green-50/50" : "border-red-100 bg-red-50/50"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 text-lg`}>{o.won ? "🏆" : "📉"}</span>
                          <span className="truncate text-sm font-semibold text-slate-800">{o.bid_title}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 ml-8">
                          <span>{o.agency}</span>
                          {o.naics_code && <span className="font-mono">{o.naics_code}</span>}
                        </div>
                      </div>
                      <span className="ml-3 shrink-0 text-xs text-slate-400">
                        {new Date(o.recorded_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* CTA */}
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-6 text-center">
              <h2 className="text-lg font-bold text-slate-900">Keep the learning going</h2>
              <p className="mt-1 text-sm text-slate-600">
                Every win and loss you record makes future AI predictions more accurate for your business.
              </p>
              <a
                href="/losses"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 transition-colors"
              >
                Record another outcome →
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
