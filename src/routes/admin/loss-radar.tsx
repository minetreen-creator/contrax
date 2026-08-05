import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import { loadLossRadar, HIGH_VALUE_THRESHOLD } from "~/lib/lossRadar";
import type { LossRadarData } from "~/lib/lossRadar";

// ── Server Functions ─────────────────────────────────────────────────────────

/**
 * Requires an authenticated admin. Throws for anonymous users and for
 * authenticated non-admins — same gate used by /admin.
 */
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (!user.is_admin) throw new Error("Admin access required");
  return user;
}

const fetchLossRadar = createServerFn({ method: "GET" }).handler(
  async (): Promise<LossRadarData> => {
    await requireAdmin();
    return loadLossRadar();
  },
);

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/admin/loss-radar")({
  // Gate the page exactly like /admin: anonymous visitors go to /login,
  // authenticated non-admins are redirected to /dashboard with a notice.
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: LossRadarPage,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Loss Radar | Contrax Admin" },
    ],
  }),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(1)}M`
      : n >= 1000
        ? `$${(n / 1000).toFixed(0)}K`
        : `$${Math.round(n).toLocaleString()}`;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/** Score badge color: hottest prospects get the red treatment, warm ones amber. */
function scoreBadgeClass(score: number) {
  if (score >= 75) return "bg-red-100 text-red-700";
  if (score >= HIGH_VALUE_THRESHOLD) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

// ── Component ────────────────────────────────────────────────────────────────

function LossRadarPage() {
  const [data, setData] = useState<LossRadarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchLossRadar()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load loss radar"))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Downloads the current prospect list as a CSV file. Pure client-side: builds
   * the CSV string from the already-loaded `data`, then triggers a download via
   * Blob + object URL (no server round-trip).
   */
  const handleExportCsv = () => {
    if (!data || data.prospects.length === 0) return;
    const header = ["Company", "NAICS", "Award Count", "Total Value", "Loss Count", "Prospect Score"];
    const escape = (value: string | number) => {
      const s = String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(","),
      ...data.prospects.map((p) =>
        [p.company, p.naics, p.awardCount, p.totalValue, p.lossCount, p.prospectScore].map(escape).join(","),
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `loss-radar-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium">Scanning award activity...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">Error loading loss radar</h1>
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

  if (!data) return null;

  const hot = data.prospects.filter((p) => p.prospectScore >= 75).length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
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
            <a href="/admin" className="text-sm font-medium text-slate-500 hover:text-slate-700">
              Admin Dashboard &rarr;
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-amber-600">Internal outreach tool</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">🎯 Loss Radar</h1>
            <p className="mt-1 text-sm text-slate-500">
              Companies active in NAICS spaces where Contrax users compete — ranked by award volume, recency, and loss signals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!data || data.prospects.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              title={data && data.prospects.length === 0 ? "No prospects to export yet" : "Download the prospect list as CSV"}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
            <p className="text-xs text-slate-400">Updated {new Date(data.lastUpdated).toLocaleString()}</p>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Prospects</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{data.totalProspects}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
            <p className="text-sm font-medium text-amber-700 uppercase tracking-wide">High-value (≥{HIGH_VALUE_THRESHOLD})</p>
            <p className="mt-2 text-3xl font-bold text-amber-800">{data.highValueCount}</p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5 shadow-sm">
            <p className="text-sm font-medium text-red-700 uppercase tracking-wide">Hot (≥75)</p>
            <p className="mt-2 text-3xl font-bold text-red-800">{hot}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Firms with loss signals</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{data.companiesWithLossSignals}</p>
          </div>
        </div>

        {/* Prospects table */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {data.prospects.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-slate-500">
                {data.awardTablePresent
                  ? "No company + NAICS activity found yet. Seed or sync award data to populate the radar."
                  : "Award data isn't available in this database yet (awarded_contracts table missing). Loss signals from bid_losses will still appear once logged."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 font-semibold">Company</th>
                    <th className="px-4 py-3 font-semibold">Primary NAICS</th>
                    <th className="px-4 py-3 font-semibold">Known awards</th>
                    <th className="px-4 py-3 font-semibold">Lost / competed</th>
                    <th className="px-4 py-3 font-semibold">Last activity</th>
                    <th className="px-4 py-3 font-semibold text-right">Prospect score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.prospects.map((p, i) => (
                    <tr key={`${p.company}-${p.naics}`} className={i % 2 ? "bg-slate-50/50 border-t border-slate-100" : "border-t border-slate-100"}>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900">{p.company}</span>
                        {p.lossCount > 0 && (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600" title="Beat a Contrax user in a tracked loss">
                            beat us {p.lossCount}×
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-slate-600">{p.naics}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800">{money(p.totalValue)}</span>
                        <span className="block text-xs text-slate-500">
                          {p.awardCount} {p.awardCount === 1 ? "contract" : "contracts"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.lossCount > 0 ? (
                          <>
                            <span className="font-semibold text-red-700">{p.lossCount} tracked {p.lossCount === 1 ? "loss" : "losses"}</span>
                            <span className="block text-xs text-slate-500">last: {fmtDate(p.lastLossDate)}</span>
                          </>
                        ) : (
                          <span className="text-slate-400">No tracked losses</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.lastActivityDate)}</td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${scoreBadgeClass(p.prospectScore)}`}
                          title={`Value ${p.scoreBreakdown.value} + Activity ${p.scoreBreakdown.activity} + Recency ${p.scoreBreakdown.recency} + Competition ${p.scoreBreakdown.competition}`}
                        >
                          {p.prospectScore}
                          {p.prospectScore >= 75 && " 🔥"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Methodology */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm text-xs text-slate-500">
          <p className="font-semibold text-slate-700">How prospect score works (0–100)</p>
          <p className="mt-1 leading-relaxed">
            <b>Value (max 40)</b> — log-scaled total awarded value in this NAICS · <b>Activity (max 30)</b> — 6 pts per known
            contract · <b>Recency (max 10)</b> — award or loss signal within 180 days · <b>Competition (max 20)</b> — 10 pts per
            tracked loss this firm won. Firms at or above {HIGH_VALUE_THRESHOLD} are flagged as high-value outreach prospects.
            Award data comes from the <code className="font-mono">awarded_contracts</code> table; loss signals come from{" "}
            <code className="font-mono">bid_losses</code> where the firm was the named winner.
          </p>
        </section>
      </main>
    </div>
  );
}
