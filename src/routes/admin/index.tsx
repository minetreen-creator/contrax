import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import type { FARClauseStats, FarDfarsSyncResult } from "~/lib/far-dfars";

// ── Types ────────────────────────────────────────────────────────────────────
interface AdminMetrics {
  totalUsers: number;
  usersByPlan: { plan_tier: string | null; count: number }[];
  recentUsers: {
    id: number;
    email: string;
    plan_tier: string | null;
    trial_started_at: string | null;
    subscription_status: string | null;
    created_at: string;
  }[];
  totalWaitlist: number;
  recentWaitlist: { email: string; source: string; created_at: string }[];
  totalPageViews: number;
  pageViewsToday: number;
  pageViewsThisWeek: number;
  topPages: { path: string; count: number }[];
  uniqueVisitorsToday: number;
  funnel: {
    total: number;
    today: number;
    last7: number;
    byName: { name: string; count: number }[];
    recent: { event_name: string; label: string | null; path: string | null; created_at: string }[];
  };
}

async function fetchAdminMetrics(): Promise<AdminMetrics> {
  const res = await fetch("/api/admin/metrics");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load metrics" }));
    throw new Error(err.error || "Failed to load metrics");
  }
  return res.json();
}

/** Count of Loss Radar prospects at or above the high-value threshold. */
async function fetchLossRadarSummary(): Promise<{ highValueProspects: number }> {
  const res = await fetch("/api/admin/loss-radar-summary");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load loss radar summary" }));
    throw new Error(err.error || "Failed to load loss radar summary");
  }
  return res.json();
}

/** FAR/DFARS clause counts for the admin card. */
async function fetchFarStats(): Promise<FARClauseStats> {
  const res = await fetch("/api/admin/far-stats");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load FAR stats" }));
    throw new Error(err.error || "Failed to load FAR stats");
  }
  return res.json();
}

/** Admin-triggered FAR/DFARS sync of the core clause parts (FAR 52, DFARS 252). */
async function triggerFarSync(): Promise<FarDfarsSyncResult> {
  const res = await fetch("/api/admin/far-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [52, 252] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "FAR/DFARS sync failed" }));
    throw new Error(err.error || "FAR/DFARS sync failed");
  }
  return res.json();
}

/** Downloads the waitlist as a CSV string for the client-side blob export. */
async function exportWaitlistCsv(): Promise<string> {
  const res = await fetch("/api/admin/waitlist-csv");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Export failed" }));
    throw new Error(err.error || "Export failed");
  }
  return res.text();
}

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/admin/")({
  // Gate the page: anonymous visitors go to /login, authenticated non-admins
  // are redirected to /dashboard with a notice.
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: AdminPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" },{ title: "Admin | Contrax" }] }),
});

// ── Component ────────────────────────────────────────────────────────────────
function AdminPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [lossRadarCount, setLossRadarCount] = useState(0);
  const [farStats, setFarStats] = useState<FARClauseStats | null>(null);
  const [syncingFar, setSyncingFar] = useState(false);
  const [farSyncResult, setFarSyncResult] = useState<FarDfarsSyncResult | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([fetchAdminMetrics(), fetchLossRadarSummary(), fetchFarStats()])
      .then(([m, s, f]) => {
        setMetrics(m);
        setLossRadarCount(s.highValueProspects);
        setFarStats(f);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load metrics"))
      .finally(() => setLoading(false));
  }, []);

  const handleFarSync = async () => {
    setSyncingFar(true);
    setFarSyncResult(null);
    try {
      const result = await triggerFarSync();
      setFarSyncResult(result);
      setFarStats(await fetchFarStats());
    } catch (err) {
      alert(err instanceof Error ? err.message : "FAR/DFARS sync failed");
    } finally {
      setSyncingFar(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await exportWaitlistCsv();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "waitlist.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteUser = async (user: { id: number; email: string }) => {
    if (!window.confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
    setDeletingId(user.id);
    try {
      const res = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to delete user" }));
        throw new Error(err.error || "Failed to delete user");
      }
      setMetrics(await fetchAdminMetrics());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium">Loading metrics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">Error loading metrics</h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">Admin</span>
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">
              Dashboard &rarr;
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>

        {/* Loss Radar Section */}
        <section>
          <a
            href="/admin/loss-radar"
            className="group flex flex-col gap-1 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-6 shadow-sm transition-colors hover:border-amber-300 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-2xl shadow-sm">
                🎯
              </span>
              <div>
                <p className="text-lg font-bold text-slate-900">Loss Radar</p>
                <p className="mt-0.5 text-sm text-slate-600">
                  {lossRadarCount > 0
                    ? `${lossRadarCount} high-value ${lossRadarCount === 1 ? "prospect" : "prospects"} identified for outreach`
                    : "No high-value prospects identified yet — open Loss Radar to scan award activity"}
                </p>
              </div>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-700 group-hover:text-amber-800 sm:mt-0">
              Open radar <span aria-hidden="true">&rarr;</span>
            </span>
          </a>
        </section>

        {/* FAR/DFARS Database Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">FAR/DFARS Database</h2>
            <button
              type="button"
              onClick={handleFarSync}
              disabled={syncingFar}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncingFar ? "Syncing FAR 52 + DFARS 252…" : "Sync core parts (52, 252)"}
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">
                  Clauses indexed
                </p>
                <p className="mt-2 text-4xl font-bold text-slate-900">
                  {farStats ? farStats.total.toLocaleString() : "—"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Exact FAR &amp; DFARS clause text powering Copilot citations and compliance checks
                </p>
              </div>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-2xl shadow-sm">📚</span>
            </div>
            {farStats && farStats.total > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-xs">
                <div className="rounded-xl bg-blue-50 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-700 uppercase">FAR</p>
                  <p className="text-lg font-bold text-blue-900">{farStats.far.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 px-3 py-2">
                  <p className="text-xs font-semibold text-emerald-700 uppercase">DFARS</p>
                  <p className="text-lg font-bold text-emerald-900">{farStats.dfars.toLocaleString()}</p>
                </div>
              </div>
            )}
            {farStats?.lastUpdated && (
              <p className="mt-3 text-xs text-slate-400">
                Last updated {new Date(farStats.lastUpdated).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            )}
            {farSyncResult && (
              <p className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-800">
                ✓ Synced {farSyncResult.fetchedParts} part{farSyncResult.fetchedParts === 1 ? "" : "s"} — {farSyncResult.clausesIndexed} clauses indexed in {farSyncResult.duration}s
                {farSyncResult.failedParts.length > 0 && ` (${farSyncResult.failedParts.length} part(s) failed)`}.
                Full FAR &amp; DFARS corpus synced daily via GitHub Actions; "Sync core parts" refreshes FAR 52 / DFARS 252 on demand.
              </p>
            )}
            {farStats && farStats.total === 0 && !syncingFar && (
              <p className="mt-3 text-xs text-amber-700">
                No clauses yet — the Copilot seeds the most-cited clauses on first use; run a sync to index the full FAR + DFARS corpus.
              </p>
            )}
          </div>
        </section>

        {/* Users Section */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Users</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Users</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalUsers}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Users by Plan</p>
              <div className="mt-2 space-y-1.5">
                {metrics.usersByPlan.length === 0 ? (
                  <p className="text-sm text-slate-400">No users yet</p>
                ) : (
                  metrics.usersByPlan.map((p) => (
                    <div key={p.plan_tier ?? "none"} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">
                        {p.plan_tier || "No plan"}
                      </span>
                      <span className="text-sm font-bold text-slate-900">{p.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">User Signups</h2>
            </div>
            {metrics.recentUsers.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-400">No users yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                      <th className="px-5 py-3 font-medium">Email</th>
                      <th className="px-5 py-3 font-medium">Plan</th>
                      <th className="px-5 py-3 font-medium">Trial</th>
                      <th className="px-5 py-3 font-medium">Signed Up</th>
                      <th className="px-5 py-3 font-medium">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.recentUsers.map((user) => {
                      const trialActive = user.trial_started_at
                        ? new Date(user.trial_started_at).getTime() + 21 * 24 * 60 * 60 * 1000 > Date.now()
                        : false;
                      return (
                        <tr key={user.id} className="border-t border-slate-50">
                          <td className="px-5 py-3">
                            <a href={`mailto:${user.email}`} className="text-blue-600 hover:text-blue-700 hover:underline">
                              {user.email}
                            </a>
                          </td>
                          <td className="px-5 py-3">
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
                              {user.plan_tier || (trialActive ? "Free trial" : "No plan")}
                            </span>
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap">
                            {trialActive ? (
                              <div className="flex flex-col items-start gap-1">
                                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                                <span className="text-xs text-slate-400">
                                  Started {new Date(user.trial_started_at!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </span>
                              </div>
                            ) : user.trial_started_at ? (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Expired</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap text-slate-500">
                            {new Date(user.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(user)}
                              disabled={deletingId === user.id || user.email.toLowerCase() === "minetreen@gmail.com"}
                              title={
                                user.email.toLowerCase() === "minetreen@gmail.com"
                                  ? "Owner account — cannot be deleted"
                                  : `Delete ${user.email}`
                              }
                              aria-label={`Delete user ${user.email}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:active:scale-100"
                            >
                              {deletingId === user.id ? (
                                <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Waitlist Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Waitlist</h2>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || metrics.totalWaitlist === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Signups</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalWaitlist}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Recent Signups</p>
              {metrics.recentWaitlist.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No signups yet</p>
              ) : (
                <div className="mt-2 -mx-1 max-h-48 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                        <th className="px-1 pb-1 font-medium">Email</th>
                        <th className="px-1 pb-1 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.recentWaitlist.map((w, i) => (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="px-1 py-1.5 text-slate-700 truncate max-w-[180px]">{w.email}</td>
                          <td className="px-1 py-1.5 text-slate-400 whitespace-nowrap">
                            {new Date(w.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Traffic Section */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">📊 Traffic</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Page Views</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalPageViews.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">Self-hosted, no third-party analytics</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Views Today</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.pageViewsToday.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">Unique visitors: {metrics.uniqueVisitorsToday.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Views This Week</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.pageViewsThisWeek.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">Rolling 7-day window</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Top Pages</p>
              {metrics.topPages.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No page views yet</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {metrics.topPages.map((p) => (
                    <div key={p.path} className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-slate-700 font-mono">{p.path}</span>
                      <span className="shrink-0 text-sm font-bold text-slate-900">{p.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Funnel Events Section */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">🎯 Funnel events</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Events</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.funnel.total.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">All time</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Events Today</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.funnel.today.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">Since UTC midnight</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Events Last 7 Days</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.funnel.last7.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">Rolling 7-day window</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* byName counts (last 7 days) */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h3 className="font-bold text-slate-900">Event counts — last 7 days</h3>
              </div>
              {metrics.funnel.byName.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-400">No events yet</p>
              ) : (
                <div className="px-5 py-3 space-y-2">
                  {metrics.funnel.byName.map((e) => (
                    <div key={e.name} className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-slate-700 font-mono">{e.name}</span>
                      <span className="shrink-0 text-sm font-bold text-slate-900">{e.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent events */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h3 className="font-bold text-slate-900">Recent events</h3>
              </div>
              {metrics.funnel.recent.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-400">No events yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                        <th className="px-5 py-2.5 font-medium">Event</th>
                        <th className="px-5 py-2.5 font-medium">Label</th>
                        <th className="px-5 py-2.5 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.funnel.recent.map((ev, i) => (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="px-5 py-2.5 font-mono text-slate-700 whitespace-nowrap">{ev.event_name}</td>
                          <td className="px-5 py-2.5 text-slate-500">{ev.label || "—"}</td>
                          <td className="px-5 py-2.5 text-slate-400 whitespace-nowrap">
                            {new Date(ev.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
