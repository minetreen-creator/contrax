import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";
import { loadLossRadar } from "~/lib/lossRadar";
import { getFarClauseStats, syncFarDfars, type FARClauseStats, type FarDfarsSyncResult } from "~/lib/far-dfars";

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
  totalDiagnoses: number;
  totalBills: number;
  totalPageViews: number;
  pageViewsToday: number;
  pageViewsThisWeek: number;
  topPages: { path: string; count: number }[];
  uniqueVisitorsToday: number;
}

interface TrafficMetrics {
  totalPageViews: number;
  pageViewsToday: number;
  pageViewsThisWeek: number;
  topPages: { path: string; count: number }[];
  uniqueVisitorsToday: number;
}

/**
 * Page-view stats from the self-hosted `page_views` table. Wrapped in a guard
 * so the admin dashboard degrades to zeros on the very first deploy, before
 * the table exists (it is created lazily by the first /api/page-view call).
 */
async function loadTrafficMetrics(): Promise<TrafficMetrics> {
  try {
    // Purge any admin page views that were recorded before the exclusion filter was added.
    try { await sql()`DELETE FROM page_views WHERE path LIKE '/admin%'`; } catch { /* ok if table doesn't exist yet */ }
    const [total, today, week, top, unique] = await Promise.all([
      sql()`SELECT COUNT(*) as count FROM page_views`,
      sql()`SELECT COUNT(*) as count FROM page_views WHERE created_at >= CURRENT_DATE`,
      sql()`SELECT COUNT(*) as count FROM page_views WHERE created_at >= NOW() - INTERVAL '7 days'`,
      sql()`SELECT path, COUNT(*) as count FROM page_views GROUP BY path ORDER BY count DESC LIMIT 5`,
      sql()`SELECT COUNT(DISTINCT ip) as count FROM page_views WHERE created_at >= CURRENT_DATE`,
    ]);
    return {
      totalPageViews: Number(total[0].count),
      pageViewsToday: Number(today[0].count),
      pageViewsThisWeek: Number(week[0].count),
      topPages: (top as any[]).map((r) => ({ path: r.path, count: Number(r.count) })),
      uniqueVisitorsToday: Number(unique[0].count),
    };
  } catch {
    // page_views may not exist yet — don't fail the whole dashboard.
    return {
      totalPageViews: 0,
      pageViewsToday: 0,
      pageViewsThisWeek: 0,
      topPages: [],
      uniqueVisitorsToday: 0,
    };
  }
}

// ── Server Functions ─────────────────────────────────────────────────────────

/**
 * Requires an authenticated admin. Throws for anonymous users and for
 * authenticated non-admins. Used by every server function on this page so the
 * data endpoints are gated even when called directly (not just via the UI).
 */
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (!user.is_admin) throw new Error("Admin access required");
  return user;
}

const fetchMetrics = createServerFn({ method: "GET" }).handler(async (): Promise<AdminMetrics> => {
  await requireAdmin();
  const [userCount, planRows, recentUsers, waitlistCount, recentWaitlist, diagCount, billCount, traffic] = await Promise.all([
    sql()`SELECT COUNT(*) as count FROM users`,
    sql()`SELECT plan_tier, COUNT(*) as count FROM users GROUP BY plan_tier ORDER BY count DESC`,
    sql()`SELECT id, email, plan_tier, trial_started_at, subscription_status, created_at FROM users ORDER BY created_at DESC`,
    sql()`SELECT COUNT(*) as count FROM waitlist`,
    sql()`SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC LIMIT 10`,
    sql()`SELECT COUNT(*) as count FROM savings_diagnoses`,
    sql()`SELECT COUNT(*) as count FROM savings_bills`,
    loadTrafficMetrics(),
  ]);

  return {
    totalUsers: Number(userCount[0].count),
    usersByPlan: (planRows as any[]).map((r) => ({
      plan_tier: r.plan_tier,
      count: Number(r.count),
    })),
    recentUsers: (recentUsers as any[]).map((r) => ({
      id: Number(r.id),
      email: r.email,
      plan_tier: r.plan_tier,
      trial_started_at: r.trial_started_at ? String(r.trial_started_at) : null,
      subscription_status: r.subscription_status,
      created_at: String(r.created_at),
    })),
    totalWaitlist: Number(waitlistCount[0].count),
    recentWaitlist: (recentWaitlist as any[]).map((r) => ({
      email: r.email,
      source: r.source || "landing_page",
      created_at: String(r.created_at),
    })),
    totalDiagnoses: Number(diagCount[0].count),
    totalBills: Number(billCount[0].count),
    ...traffic,
  };
});

const exportWaitlistCsv = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  await requireAdmin();
  const rows = await sql()`SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC`;
  const header = "email,source,created_at";
  const dataRows = (rows as any[]).map((r) =>
    `${r.email},${r.source || "landing_page"},${String(r.created_at)}`
  );
  return [header, ...dataRows].join("\n");
});

/** Count of Loss Radar prospects at or above the high-value threshold. */
const getLossRadarSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ highValueProspects: number }> => {
    await requireAdmin();
    try {
      const data = await loadLossRadar();
      return { highValueProspects: data.highValueCount };
    } catch {
      return { highValueProspects: 0 };
    }
  },
);

/** FAR/DFARS clause counts for the admin card. */
const getFarStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<FARClauseStats> => {
    await requireAdmin();
    return getFarClauseStats();
  },
);

/**
 * Admin-triggered FAR/DFARS sync. Defaults to the two clause parts that matter
 * most to proposal work (FAR 52, DFARS 252) so the button completes inside a
 * serverless function; pass `parts` to target others. The daily cron
 * (/api/sync-far) refreshes the full corpus.
 */
const triggerFarSync = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const parts = (d as { parts?: unknown })?.parts;
    const list = Array.isArray(parts)
      ? parts.map((p) => Number(p)).filter((p) => Number.isInteger(p) && p > 0)
      : [52, 252];
    return { parts: list };
  })
  .handler(async ({ data }): Promise<FarDfarsSyncResult> => {
    await requireAdmin();
    return syncFarDfars({ parts: data.parts, concurrency: 4 });
  });

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

  useEffect(() => {
    Promise.all([fetchMetrics(), getLossRadarSummary(), getFarStats()])
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
      const result = await triggerFarSync({ data: { parts: [52, 252] } });
      setFarSyncResult(result);
      setFarStats(await getFarStats());
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
                The daily cron and <code className="font-mono">/api/sync-far</code> refresh the full corpus.
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

        {/* Savings Activity Section */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Savings Activity</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Diagnoses</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalDiagnoses}</p>
              <p className="mt-1 text-xs text-slate-400">Automated bill checkups run</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Tracked Bills</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalBills}</p>
              <p className="mt-1 text-xs text-slate-400">Bills saved for monitoring</p>
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
      </main>
    </div>
  );
}
