import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import type { FARClauseStats, FarDfarsSyncResult } from "~/lib/far-dfars";
import { TRIAL_DAYS } from "~/lib/trial";

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
  totalSignups: number;
  recentSignups: { id: number; email: string; created_at: string }[];
  totalWaitlist: number;
  recentWaitlist: { email: string; source: string; created_at: string }[];
  totalPageViews: number;
  pageViewsToday: number;
  pageViewsThisWeek: number;
  topPages: { path: string; count: number }[];
  uniqueVisitorsToday: number;
  uniqueHumanVisitorsToday: number;
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

// ── Closing Soon → Signup funnel (self-hosted analytics) ────────────────────
interface ClosingSoonFunnel {
  rangeDays: number;
  from: string;
  to: string;
  sessionWindowHours: number;
  rawInRange: {
    closingSoonClicks: number;
    buttonClicks: number;
    rowClicks: number;
    viewEvents: number;
    submitEvents: number;
    successEvents: number;
  };
  attributed: {
    clickVisitors: number;
    clickEvents: number;
    viewed: number;
    submitted: number;
    succeeded: number;
    clickToView: number | null;
    clickToSubmit: number | null;
    clickToSuccess: number | null;
    viewToSubmit: number | null;
    submitToSuccess: number | null;
  };
}

async function fetchClosingSoonFunnel(days: number): Promise<ClosingSoonFunnel> {
  const res = await fetch(`/api/admin/closing-soon-funnel?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load funnel" }));
    throw new Error(err.error || "Failed to load funnel");
  }
  return res.json();
}

// ── Unified Funnel (Qualified → Radar → Signup → Activated → Paid) ─────────
interface UnifiedFunnelStage {
  stage: string;
  label: string;
  count: number;
  stepConversionPct: number | null;
}
interface UnifiedFunnelResult {
  rangeDays: number;
  from: string;
  to: string;
  stages: UnifiedFunnelStage[];
  bySource: { source: string; count: number }[];
  byMedium: { medium: string; count: number }[];
}

async function fetchUnifiedFunnel(days: number): Promise<UnifiedFunnelResult> {
  const res = await fetch(`/api/admin/unified-funnel?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load funnel" }));
    throw new Error(err.error || "Failed to load funnel");
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
// ── External User Activity (counts + timestamps only, no private content) ──
interface ExternalUserActivity {
  user_id: number;
  email: string;
  plan_tier: string | null;
  last_login: string | null;
  search_count: number;
  last_search: string | null;
  score_count: number;
  last_score: string | null;
  save_count: number;
  last_save: string | null;
  created_at: string | null;
}
async function fetchUserActivity(): Promise<ExternalUserActivity[]> {
  const res = await fetch("/api/admin/user-activity");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load user activity" }));
    throw new Error(err.error || "Failed to load user activity");
  }
  return res.json();
}

// ── Acquisition by Source (first-touch attribution, PR #214) ────────────────
interface AcquisitionRow {
  source: string;
  medium: string;
  visits: number;
  visitsRaw: number;
  signupViews: number;
  signupConversions: number;
}
interface AcquisitionResult {
  rangeDays: number;
  from: string;
  to: string;
  rows: AcquisitionRow[];
  totals: { visits: number; visitsRaw: number; signupViews: number; signupConversions: number };
}
async function fetchAcquisition(days: number): Promise<AcquisitionResult> {
  const res = await fetch(`/api/admin/acquisition?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load acquisition" }));
    throw new Error(err.error || "Failed to load acquisition");
  }
  return res.json();
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
  const [funnelDays, setFunnelDays] = useState(30);
  const [funnel, setFunnel] = useState<ClosingSoonFunnel | null>(null);
  const [funnelError, setFunnelError] = useState("");
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [unifiedDays, setUnifiedDays] = useState(30);
  const [unified, setUnified] = useState<UnifiedFunnelResult | null>(null);
  const [unifiedError, setUnifiedError] = useState("");
  const [unifiedLoading, setUnifiedLoading] = useState(true);
  const [activity, setActivity] = useState<ExternalUserActivity[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [acqDays, setAcqDays] = useState(30);
  const [acquisition, setAcquisition] = useState<AcquisitionResult | null>(null);
  const [acqError, setAcqError] = useState("");
  const [acqLoading, setAcqLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchAdminMetrics(), fetchLossRadarSummary(), fetchFarStats(), fetchUserActivity()])
      .then(([m, s, f, a]) => {
        setMetrics(m);
        setLossRadarCount(s.highValueProspects);
        setFarStats(f);
        setActivity(a);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to load metrics";
        setError(msg);
        setActivityError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFunnelLoading(true);
    setFunnelError("");
    fetchClosingSoonFunnel(funnelDays)
      .then((d) => { if (!cancelled) setFunnel(d); })
      .catch((err) => { if (!cancelled) setFunnelError(err instanceof Error ? err.message : "Failed to load funnel"); })
      .finally(() => { if (!cancelled) setFunnelLoading(false); });
    return () => { cancelled = true; };
  }, [funnelDays]);

  // Unified funnel (Qualified → Radar → Signup → Activated → Paid) — re-fetch
  // when the day-range changes.
  useEffect(() => {
    let cancelled = false;
    setUnifiedLoading(true);
    setUnifiedError("");
    fetchUnifiedFunnel(unifiedDays)
      .then((d) => { if (!cancelled) setUnified(d); })
      .catch((err) => { if (!cancelled) setUnifiedError(err instanceof Error ? err.message : "Failed to load funnel"); })
      .finally(() => { if (!cancelled) setUnifiedLoading(false); });
    return () => { cancelled = true; };
  }, [unifiedDays]);

  // First-touch acquisition by source (re-fetch when the window changes).
  useEffect(() => {
    let cancelled = false;
    setAcqLoading(true);
    setAcqError("");
    fetchAcquisition(acqDays)
      .then((d) => { if (!cancelled) setAcquisition(d); })
      .catch((err) => { if (!cancelled) setAcqError(err instanceof Error ? err.message : "Failed to load acquisition"); })
      .finally(() => { if (!cancelled) setAcqLoading(false); });
    return () => { cancelled = true; };
  }, [acqDays]);

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

        {/* Visitor Journeys Section */}
        <section>
          <a
            href="/admin/journeys"
            className="group flex flex-col gap-1 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-6 shadow-sm transition-colors hover:border-indigo-300 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-2xl shadow-sm">
                🧭
              </span>
              <div>
                <p className="text-lg font-bold text-slate-900">Visitor Journeys</p>
                <p className="mt-0.5 text-sm text-slate-600">
                  One row per real person/session with a timestamped timeline, plus a unified
                  Qualified → Radar → Signup → Activated → Paid funnel.
                </p>
              </div>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 group-hover:text-indigo-800 sm:mt-0">
              Open journeys <span aria-hidden="true">&rarr;</span>
            </span>
          </a>
        </section>

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
                        ? new Date(user.trial_started_at).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000 > Date.now()
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
              <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalSignups}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Recent Signups</p>
              {metrics.recentSignups.length === 0 ? (
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
                      {metrics.recentSignups.map((s) => (
                        <tr key={s.id} className="border-t border-slate-50">
                          <td className="px-1 py-1.5 text-slate-700 truncate max-w-[180px]">{s.email}</td>
                          <td className="px-1 py-1.5 text-slate-400 whitespace-nowrap">
                            {new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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

        {/* External User Activity Section */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-slate-800">👥 External User Activity</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Counts and timestamps only — no private content (no bid titles, proposal/draft text,
            saved-match notes, or business-profile data). Search tracking began when this shipped,
            so 0 searches is expected initially for pre-existing users.
          </p>
          {activityError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {activityError}
            </div>
          ) : loading || activity === null ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-400">
              Loading external user activity…
            </div>
          ) : activity.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-400">
              No external users yet.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                      <th className="px-5 py-3 font-medium">Email</th>
                      <th className="px-5 py-3 font-medium">Plan</th>
                      <th className="px-5 py-3 font-medium">Last Login</th>
                      <th className="px-5 py-3 font-medium">Searches</th>
                      <th className="px-5 py-3 font-medium">Scores</th>
                      <th className="px-5 py-3 font-medium">Saves</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((a) => (
                      <tr key={a.user_id} className="border-t border-slate-50">
                        <td className="px-5 py-3">
                          <a href={`mailto:${a.email}`} className="text-blue-600 hover:text-blue-700 hover:underline">{a.email}</a>
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
                            {a.plan_tier || "No plan"}
                          </span>
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap text-slate-500">
                          {a.last_login ? new Date(a.last_login).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : <span className="text-slate-400">never</span>}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <span className="font-semibold text-slate-900">{a.search_count}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {a.last_search ? `(${new Date(a.last_search).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : "(never)"}
                          </span>
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <span className="font-semibold text-slate-900">{a.score_count}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {a.last_score ? `(${new Date(a.last_score).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : "(never)"}
                          </span>
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <span className="font-semibold text-slate-900">{a.save_count}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {a.last_save ? `(${new Date(a.last_save).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : "(never)"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
              <p className="mt-1 text-xs text-slate-400">Unique visitors: {metrics.uniqueHumanVisitorsToday.toLocaleString()} ({metrics.uniqueVisitorsToday.toLocaleString()} raw)</p>
              <p className="mt-0.5 text-[10px] text-slate-400">filtered: excludes search engines, social scrapers, and our test IPs</p>
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

        {/* Acquisition by Source (first-touch attribution, PR #214) */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-slate-800">📈 Acquisition by Source</h2>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 text-xs font-medium">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setAcqDays(d)}
                  className={`px-3 py-1 rounded-md ${acqDays === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {acqError ? (
              <p className="text-sm text-red-600">Could not load acquisition data: {acqError}</p>
            ) : acqLoading || !acquisition ? (
              <p className="text-sm text-slate-400">Loading acquisition…</p>
            ) : acquisition.rows.length === 0 ? (
              <p className="text-sm text-slate-400">
                No attributed traffic in the last {acquisition.rangeDays} days. First-touch attribution
                (utms / fbclid / gclid / referrer) is stamped from the <code className="text-slate-600">contrax_attr</code>{" "}
                cookie — rows accumulate as real visitors arrive.
              </p>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-4 font-medium">Source</th>
                        <th className="py-2 pr-4 font-medium">Medium</th>
                        <th className="py-2 pr-4 font-medium text-right">Visits</th>
                        <th className="py-2 pr-4 font-medium text-right">Signup Views</th>
                        <th className="py-2 pr-4 font-medium text-right">Signup Conversions</th>
                        <th className="py-2 font-medium text-right">Visits (raw)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acquisition.rows.map((r) => (
                        <tr key={`${r.source}|${r.medium}`} className="border-t border-slate-100">
                          <td className="py-2 pr-4 font-semibold text-slate-800 capitalize">{r.source}</td>
                          <td className="py-2 pr-4 text-slate-500">{r.medium}</td>
                          <td className="py-2 pr-4 text-right font-bold text-slate-900">{r.visits.toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-slate-700">{r.signupViews.toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-slate-700">{r.signupConversions.toLocaleString()}</td>
                          <td className="py-2 text-right text-slate-400">{r.visitsRaw.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200">
                        <td className="py-2 pr-4 font-bold text-slate-900" colSpan={2}>Total</td>
                        <td className="py-2 pr-4 text-right font-bold text-slate-900">{acquisition.totals.visits.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-bold text-slate-700">{acquisition.totals.signupViews.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-bold text-slate-700">{acquisition.totals.signupConversions.toLocaleString()}</td>
                        <td className="py-2 text-right font-bold text-slate-400">{acquisition.totals.visitsRaw.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="mt-3 text-[10px] text-slate-400">
                  filtered: visits / signup-views / signup-conversions exclude search engines, social scrapers
                  (e.g. Meta's facebookexternalhit link-unfurlers), and our test IPs. "Visits (raw)" is the
                  unfiltered count, kept alongside for honesty.
                </p>
              </div>
            )}
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

        {/* Closing Soon → Signup funnel */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-slate-800">⏰ Closing Soon → Signup funnel</h2>
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {[7, 30, 90, 365].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFunnelDays(d)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    funnelDays === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {d === 365 ? "All" : `${d}d`}
                </button>
              ))}
            </div>
          </div>

          {funnelError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
              Could not load funnel data: {funnelError}
            </div>
          ) : funnelLoading || !funnel ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">
              Loading funnel…
            </div>
          ) : funnel.attributed.clickVisitors === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-medium text-slate-700">No Closing Soon → signup data in this range.</p>
              <p className="mt-1 text-xs text-slate-400">
                No <span className="font-mono">signup_cta_click (home_closing_soon)</span> events were recorded in the
                last {funnel.rangeDays} days. Once real (or QA) visitors click the Closing Soon CTA, this funnel will populate here.
                This is an honest empty state — not a measurement error.
              </p>
            </div>
          ) : (
            <>
              {/* Attributed funnel table */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-amber-100 bg-amber-50/60">
                  <h3 className="font-bold text-slate-900">Attributed funnel (approximate)</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Visitors (distinct IP + user-agent) who clicked a Closing Soon CTA, then reached each later step within {funnel.sessionWindowHours}h of the click.
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                      <th className="px-5 py-3 font-medium">Step</th>
                      <th className="px-5 py-3 font-medium text-right">Visitors</th>
                      <th className="px-5 py-3 font-medium text-right">% of clickers</th>
                      <th className="px-5 py-3 font-medium text-right">Drop-off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: "Clicked Closing Soon CTA / row link", n: funnel.attributed.clickVisitors, mom: null },
                      { name: "Viewed /signup", n: funnel.attributed.viewed, mom: funnel.attributed.clickVisitors },
                      { name: "Submitted signup", n: funnel.attributed.submitted, mom: funnel.attributed.viewed },
                      { name: "Signup success", n: funnel.attributed.succeeded, mom: funnel.attributed.submitted },
                    ].map((row, i) => {
                      const pctOfClickers = funnel.attributed.clickVisitors
                        ? Math.round((row.n / funnel.attributed.clickVisitors) * 1000) / 10
                        : null;
                      const dropOff = row.mom && row.mom > 0 ? Math.round(((row.mom - row.n) / row.mom) * 1000) / 10 : null;
                      return (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="px-5 py-3 font-medium text-slate-700">{row.name}</td>
                          <td className="px-5 py-3 text-right text-lg font-bold text-slate-900">{row.n}</td>
                          <td className="px-5 py-3 text-right text-slate-600">
                            {pctOfClickers === null ? "—" : `${pctOfClickers}%`}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-400">
                            {dropOff === null ? "—" : `−${dropOff}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Click → signup</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">
                    {funnel.attributed.clickToSuccess === null ? "—" : `${funnel.attributed.clickToSuccess}%`}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {funnel.attributed.succeeded} of {funnel.attributed.clickVisitors} clickers completed signup
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Click → submit</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">
                    {funnel.attributed.clickToSubmit === null ? "—" : `${funnel.attributed.clickToSubmit}%`}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">Submitted the signup form</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Raw clicks in range</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">{funnel.rawInRange.closingSoonClicks}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {funnel.attributed.clickEvents} click events / {funnel.attributed.clickVisitors} distinct visitor{funnel.attributed.clickVisitors === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    CTA button {funnel.rawInRange.buttonClicks} · per-row link {funnel.rawInRange.rowClicks} (going-forward)
                  </p>
                </div>
              </div>

              {/* Honesty / caveats */}
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800">How to read this (please read)</h3>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-600 list-disc pl-5">
                  <li>
                    <strong>Approximate attribution:</strong> funnel_events has no session ID, so a "visitor" is the IP + user-agent
                    pair, and a later step is attributed to a Closing Soon click when that same visitor also produced the step within{" "}
                    {funnel.sessionWindowHours}h of the click. Two people behind the same IP/UA (or IP rotation) can be merged — treat
                    these as directional, not exact per-session numbers.
                  </li>
                  {funnel.rawInRange.viewEvents === 0 && (
                    <li>
                      <strong>View step reads 0</strong> because the cold /signup path only started firing a plain{" "}
                      <span className="font-mono">signup_view</span> event after the latest instrumentation change; before that only the
                      score path fired a view event. It will populate as new cold visits occur — it does not mean nobody viewed /signup.
                    </li>
                  )}
                  <li>
                    <strong>Button vs per-row is now tracked separately (going-forward only):</strong> the Closing Soon CTA button and the
                    per-row title deep-links now fire distinct{" "}
                    <span className="font-mono">signup_cta_click</span> labels —{" "}
                    <span className="font-mono">home_closing_soon_button</span> vs{" "}
                    <span className="font-mono">home_closing_soon_row</span>. The raw "CTA button / per-row link" breakdown above only
                    fills in as new clicks land after this change ships; old rows under the legacy{" "}
                    <span className="font-mono">home_closing_soon</span> label cannot be split retroactively — they count only toward
                    the overall total, not either bucket. Treat the breakdown as directional while it accumulates.
                  </li>
                  <li>
                    <strong>Site-wide raw counts (not Closing Soon–attributed):</strong> in this range — signup views{" "}
                    {funnel.rawInRange.viewEvents}, signup submits {funnel.rawInRange.submitEvents}, signup successes{" "}
                    {funnel.rawInRange.successEvents} across all sources. These are NOT part of the Closing Soon funnel above.
                  </li>
                  <li>
                    <strong>Current data may include QA/test rows:</strong> automated QA clicks and test-account signups (e.g. IP{" "}
                    <span className="font-mono">34.214.71.218</span>, test emails qanext*) land in the same{" "}
                    <span className="font-mono">funnel_events</span> table with no test filter, so small numbers right now may be QA's
                    own activity rather than real humans. No filter is applied — this is the raw, honest state.
                  </li>
                </ul>
              </div>
            </>
          )}
        </section>

        {/* Unified Funnel (Qualified → Radar → Signup → Activated → Paid) */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 className="text-lg font-semibold text-slate-800">🧭 Unified Funnel</h2>
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {[7, 14, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setUnifiedDays(d)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    unifiedDays === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Where qualified visitors drop, over the selected window. Stages are monotonic —
            a visitor counted at a later stage was necessarily counted at every earlier
            stage. "Conversion" is the % that made it from the previous stage to this one.
          </p>

          {unifiedError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
              Could not load unified funnel: {unifiedError}
            </div>
          ) : unifiedLoading || !unified ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">
              Loading unified funnel…
            </div>
          ) : unified.stages.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-medium text-slate-700">No funnel data in this range.</p>
              <p className="mt-1 text-xs text-slate-400">
                No qualifying intent events were recorded in the last {unified.rangeDays} days.
                Once qualified visitors arrive, this funnel will populate here. This is an honest
                empty state — not a measurement error.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-indigo-100 bg-indigo-50/60">
                  <h3 className="font-bold text-slate-900">Stage flow</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Unique visitors per stage · conversion from the previous stage
                    ({unified.rangeDays}-day window, bot / QA / admin excluded)
                  </p>
                </div>
                <div className="p-5 space-y-3">
                  {unified.stages.map((s, i) => {
                    const pctOfQualified = unified.stages[0].count
                      ? Math.round((s.count / unified.stages[0].count) * 1000) / 10
                      : null;
                    const barWidth =
                      unified.stages[0].count > 0 ? Math.max(2, Math.round((s.count / unified.stages[0].count) * 100)) : 0;
                    return (
                      <div key={s.stage}>
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="flex items-baseline gap-3 min-w-0">
                            <span className="text-sm font-semibold text-slate-700">{s.label}</span>
                            {i > 0 && (
                              <span className="text-xs text-slate-400 shrink-0">
                                {s.stepConversionPct === null ? "—" : `${s.stepConversionPct}%`} of prior stage
                              </span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-3 shrink-0">
                            {i > 0 && (
                              <span className="text-xs text-slate-400">
                                {s.stepConversionPct === null ? "—" : `${s.stepConversionPct}%`}
                              </span>
                            )}
                            <span className="text-xl font-bold text-slate-900">{s.count}</span>
                            {pctOfQualified !== null && (
                              <span className="text-xs text-slate-400 w-14 text-right">
                                {pctOfQualified}% of qualified
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-1.5 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${i === unified.stages.length - 1 ? "bg-emerald-500" : "bg-indigo-500"}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {unified.bySource.length > 0 && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-800 mb-3">Top sources (qualified)</h3>
                    {unified.bySource.length === 0 ? (
                      <p className="text-sm text-slate-400">No sources yet</p>
                    ) : (
                      <div className="space-y-1.5">
                        {unified.bySource.map((r) => (
                          <div key={r.source} className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium text-slate-700 capitalize">{r.source}</span>
                            <span className="shrink-0 text-sm font-bold text-slate-900">{r.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-800 mb-3">Top mediums (qualified)</h3>
                    {unified.byMedium.length === 0 ? (
                      <p className="text-sm text-slate-400">No mediums yet</p>
                    ) : (
                      <div className="space-y-1.5">
                        {unified.byMedium.map((r) => (
                          <div key={r.medium} className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium text-slate-700 capitalize">{r.medium}</span>
                            <span className="shrink-0 text-sm font-bold text-slate-900">{r.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Honesty / caveats */}
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800">How to read this (please read)</h3>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-600 list-disc pl-5">
                  <li>
                    <strong>Qualified visit</strong> = a visitor who produced any qualifying intent signal
                    (activation event, Radar scan start/complete, signup view/start/submit/abandon/success,
                    or a hero trial-CTA click). This is the founder funnel's entry stage — it is NOT total
                    traffic.
                  </li>
                  <li>
                    <strong>Monotonic:</strong> a visitor counted at Radar / Signup / Activated / Paid was
                    necessarily counted as Qualified too (the Qualified event set is a superset). So
                    each stage can never exceed the one before it in this board.
                  </li>
                  <li>
                    <strong>Paid</strong> = distinct funnel users whose account has an{" "}
                    <span className="font-mono">active</span> subscription status, linked via user_id — the
                    same definition the Visitor Journeys board uses.
                  </li>
                  <li>
                    <strong>Conversion</strong> is shown only when the previous stage's count is nonzero;
                    a 0 last-stage count shows the visitor count 0 and a "—" conversion (never a division by
                    zero, never a fabricated %).
                  </li>
                  <li>
                    <strong>Exclusions:</strong> every number excludes bot/crawler traffic,{" "}
                    <span className="font-mono">@test.contrax</span> QA accounts, and internal admin emails —
                    the same exclusions applied across the admin dashboard.
                  </li>
                </ul>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
