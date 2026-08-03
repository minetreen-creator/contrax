import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";

// ── Types ────────────────────────────────────────────────────────────────────
interface AdminMetrics {
  totalUsers: number;
  usersByPlan: { plan_tier: string | null; count: number }[];
  totalWaitlist: number;
  recentWaitlist: { email: string; source: string; created_at: string }[];
  totalDiagnoses: number;
  totalBills: number;
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
  const [userCount, planRows, waitlistCount, recentWaitlist, diagCount, billCount] = await Promise.all([
    sql()`SELECT COUNT(*) as count FROM users`,
    sql()`SELECT plan_tier, COUNT(*) as count FROM users GROUP BY plan_tier ORDER BY count DESC`,
    sql()`SELECT COUNT(*) as count FROM waitlist`,
    sql()`SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC LIMIT 10`,
    sql()`SELECT COUNT(*) as count FROM savings_diagnoses`,
    sql()`SELECT COUNT(*) as count FROM savings_bills`,
  ]);

  return {
    totalUsers: Number(userCount[0].count),
    usersByPlan: (planRows as any[]).map((r) => ({
      plan_tier: r.plan_tier,
      count: Number(r.count),
    })),
    totalWaitlist: Number(waitlistCount[0].count),
    recentWaitlist: (recentWaitlist as any[]).map((r) => ({
      email: r.email,
      source: r.source || "landing_page",
      created_at: String(r.created_at),
    })),
    totalDiagnoses: Number(diagCount[0].count),
    totalBills: Number(billCount[0].count),
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
  head: () => ({ meta: [{ title: "Admin | Contrax" }] }),
});

// ── Component ────────────────────────────────────────────────────────────────
function AdminPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchMetrics()
      .then(setMetrics)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load metrics"))
      .finally(() => setLoading(false));
  }, []);

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
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Contrax</span>
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
      </main>
    </div>
  );
}
