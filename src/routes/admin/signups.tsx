import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import { TRIAL_DAYS } from "~/lib/trial";
// Signup-source marker (migration 053, owner-directed 09-28): the ONE place the nonprofit
// label and the "is this the nonprofit door" test are spelled. Pure/client-safe module.
import {
  SIGNUP_SOURCE_NONPROFIT_APPLY_LABEL,
  isNonprofitApplySource,
} from "~/lib/signup-source";
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

interface RecentSignup {
  id: number;
  email: string;
  plan_tier: string | null;
  subscription_status: string | null;
  created_at: string;
  // Migration 053 (owner-directed 09-28): the signup-source marker — the allowlisted
  // ?source= signup param the account was created through ('nonprofit_apply' is the
  // Nonprofit Free door added by that change). NULL = created before the marker existed
  // (never inferred).
  signup_source: string | null;
  nonprofit_org_name: string | null;
  nonprofit_status: string | null;
}
interface SignupActivity {
  user_id: number;
  email: string;
  plan_tier: string | null;
  created_at: string | null;
  last_login: string | null;
  search_count: number;
  last_search: string | null;
  score_count: number;
  last_score: string | null;
  save_count: number;
  last_save: string | null;
}

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
  const [activity, setActivity] = useState<SignupActivity[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [nonprofitOnly, setNonprofitOnly] = useState(false);
  const nonprofitApplicants = metrics?.recentSignups.filter((s) => s.nonprofit_status) ?? [];
  const displayedSignups = nonprofitOnly ? nonprofitApplicants : metrics?.recentSignups ?? [];

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/user-activity")
      .then(async (res) => {
        if (!res.ok) throw new Error("Account activity is unavailable");
        return res.json() as Promise<SignupActivity[]>;
      })
      .then((rows) => { if (!cancelled) setActivity(rows); })
      .catch((err) => { if (!cancelled) setActivityError(err instanceof Error ? err.message : "Account activity is unavailable"); });
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Nonprofit applicants</p>
                  <p className="mt-2 text-4xl font-bold text-slate-900">{nonprofitApplicants.length}</p>
                  <p className="mt-1 text-xs text-slate-500">{nonprofitApplicants.filter((s) => s.nonprofit_status === "approved").length} approved for Nonprofit Free</p>
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
                <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">Signup emails and plans</h3>
                    <p className="text-xs text-slate-500">Nonprofit status reflects an application, not the billing plan. A selected plan does not mean a payment was made.</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={nonprofitOnly} onChange={(e) => setNonprofitOnly(e.target.checked)} />
                    Show nonprofit applicants only
                  </label>
                </div>
                {displayedSignups.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-500">{nonprofitOnly ? "No nonprofit applications from external accounts." : "No signups yet"}</p>
                ) : (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full min-w-[920px] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                          <th className="px-5 py-3 font-medium">Email</th>
                          <th className="px-5 py-3 font-medium">Signup source</th>
                          <th className="px-5 py-3 font-medium">Plan</th>
                          <th className="px-5 py-3 font-medium">Subscription</th>
                          <th className="px-5 py-3 font-medium">Nonprofit Free application</th>
                          <th className="px-5 py-3 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedSignups.map((s) => (
                          <tr key={s.id} className="border-t border-slate-50">
                            <td className="px-5 py-2.5">
                              <a href={`mailto:${s.email}`} className="text-blue-600 hover:text-blue-700 hover:underline">{s.email}</a>
                            </td>
                            <td className="px-5 py-2.5 whitespace-nowrap">
                              {/* Signup-source marker (migration 053, owner-directed 09-28).
                                  A nonprofit-apply account is labelled DISTINCTLY; any other
                                  recorded family member (radar/autopsy/…) shows its raw value,
                                  and an account created before the marker existed shows "—"
                                  (never guessed). Attribution only — not a plan or a status. */}
                              {isNonprofitApplySource(s.signup_source) ? (
                                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                  {SIGNUP_SOURCE_NONPROFIT_APPLY_LABEL}
                                </span>
                              ) : s.signup_source ? (
                                <span className="text-slate-700">{s.signup_source.replaceAll("_", " ")}</span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-slate-700 capitalize">{s.plan_tier ?? "No plan"}</td>
                            <td className="px-5 py-2.5 text-slate-700 capitalize">{s.subscription_status?.replaceAll("_", " ") ?? "—"}</td>
                            <td className="px-5 py-2.5 text-slate-700">
                              {s.nonprofit_status ? (
                                <a href="/admin/nonprofits" className="text-blue-700 hover:underline">
                                  {s.nonprofit_org_name || "Organization not provided"} · <span className="capitalize">{s.nonprofit_status.replaceAll("_", " ")}</span>
                                </a>
                              ) : "—"}
                            </td>
                            <td className="px-5 py-2.5 text-slate-400 whitespace-nowrap">{dayFmt(s.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-x-auto">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="font-bold text-slate-900">External account activity</h3>
                  <p className="text-xs text-slate-500">Searches count dashboard feed loads since logging began. Scores count stored AI results, including automatic digest generation; they are not user clicks. Saves count saved-match rows of any status.</p>
                </div>
                {activityError ? <p className="px-5 py-4 text-sm text-red-700" role="alert">{activityError}</p> : activity === null ? (
                  <p className="px-5 py-4 text-sm text-slate-500">Loading account activity…</p>
                ) : activity.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-500">No external account activity found.</p>
                ) : (
                  <table className="w-full min-w-[800px] text-sm text-slate-700">
                    <thead><tr className="text-left text-xs text-slate-600 uppercase">
                      <th className="px-5 py-2">Account</th><th className="px-3 py-2">Plan</th>
                      <th className="px-3 py-2">Last login</th><th className="px-3 py-2 text-right">Searches</th>
                      <th className="px-3 py-2 text-right">Stored scores</th><th className="px-5 py-2 text-right">Saved-match rows</th>
                    </tr></thead>
                    <tbody>{activity.map((row) => (
                      <tr key={row.user_id} className="border-t border-slate-100">
                        <td className="px-5 py-2 font-medium text-slate-900">{row.email}</td>
                        <td className="px-3 py-2 capitalize">{row.plan_tier ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.last_login ? dayFmt(row.last_login) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums" title={row.last_search ?? undefined}>{row.search_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums" title={row.last_score ?? undefined}>{row.score_count}</td>
                        <td className="px-5 py-2 text-right tabular-nums" title={row.last_save ?? undefined}>{row.save_count}</td>
                      </tr>
                    ))}</tbody>
                  </table>
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
