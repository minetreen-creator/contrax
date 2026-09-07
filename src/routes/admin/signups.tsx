import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import { TRIAL_DAYS } from "~/lib/trial";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
  SectionError,
  SectionLoading,
  moneyWhole,
  dayFmt,
  type FinanceResult,
  fetchFinance,
} from "~/components/AdminShared";

/**
 * /admin/signups — Signups tab of the redesigned admin dashboard (owner
 * 2026-09-07). External-user signups from the existing /api/admin/metrics
 * endpoint (owner/admin/QA-test exclusions already applied server-side).
 * Emails here are full addresses: this is the authenticated admin surface for
 * account management (same as the old dashboard), NOT the PII-masked
 * visitor/lead surfaces.
 */

interface RecentSignup { id: number; email: string; created_at: string; }
interface MetricsShape {
  totalSignups: number;
  recentSignups: RecentSignup[];
  totalUsers: number;
  usersByPlan: { plan_tier: string | null; count: number }[];
}

async function fetchMetrics(): Promise<MetricsShape> {
  const res = await fetch("/api/admin/metrics");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load metrics" }));
    throw new Error(err.error || "Failed to load metrics");
  }
  const m = await res.json();
  return {
    totalSignups: m.totalSignups ?? 0,
    recentSignups: m.recentSignups ?? [],
    totalUsers: m.totalUsers ?? 0,
    usersByPlan: m.usersByPlan ?? [],
  };
}

function SignupsPage() {
  const [metrics, setMetrics] = useState<MetricsShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fin, setFin] = useState<FinanceResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMetrics()
      .then((d) => { if (!cancelled) setMetrics(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load signups"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchFinance().then((d) => { if (!cancelled) setFin(d); }).catch(() => { /* fail-open */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        </div>
        <AdminTabs active="signups" />

        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Signups</h2>
          {error ? (
            <SectionError message={error} />
          ) : loading || !metrics ? (
            <SectionLoading message="Loading signups…" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Signups</p>
                  <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalSignups}</p>
                  <p className="mt-1 text-xs text-slate-400">External accounts (owner/admin/QA excluded)</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Users</p>
                  <p className="mt-2 text-4xl font-bold text-slate-900">{metrics.totalUsers}</p>
                  <p className="mt-1 text-xs text-slate-400">All non-QA accounts</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">MRR (live)</p>
                  <p className="mt-2 text-4xl font-bold text-slate-900">{fin ? moneyWhole(fin.mrrCents) : "—"}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {fin ? (fin.source === "stripe-live" ? "Live Stripe read" : "Live app-database read") : "Loading…"}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="font-bold text-slate-900">Recent signups</h3>
                </div>
                {metrics.recentSignups.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-400">No signups yet</p>
                ) : (
                  <div className="-mx-1 max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                          <th className="px-5 py-3 font-medium">Email</th>
                          <th className="px-5 py-3 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.recentSignups.map((s) => (
                          <tr key={s.id} className="border-t border-slate-50">
                            <td className="px-5 py-2.5">
                              <a href={`mailto:${s.email}`} className="text-blue-600 hover:text-blue-700 hover:underline">{s.email}</a>
                            </td>
                            <td className="px-5 py-2.5 text-slate-400 whitespace-nowrap">{dayFmt(s.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800">Users by plan</h3>
                <div className="mt-2 space-y-1.5">
                  {metrics.usersByPlan.length === 0 ? (
                    <p className="text-sm text-slate-400">No users yet</p>
                  ) : (
                    metrics.usersByPlan.map((p) => (
                      <div key={p.plan_tier ?? "none"} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 capitalize">{p.plan_tier || "No plan"}</span>
                        <span className="text-sm font-bold text-slate-900">{p.count}</span>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-3 text-[10px] text-slate-400">
                  Trial window: {TRIAL_DAYS} days. Counts exclude @test.contrax QA accounts and admin emails.
                </p>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/admin/signups")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: SignupsPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Signups | Admin | Contrax" }] }),
});
