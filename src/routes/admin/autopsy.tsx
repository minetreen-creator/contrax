import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
  SectionError,
  SectionLoading,
  moneyWhole,
  type FinanceResult,
  fetchFinance,
} from "~/components/AdminShared";

/**
 * /admin/autopsy — Autopsy tab of the redesigned admin dashboard (owner
 * 2026-09-07). The 9-stage free-first-autopsy acquisition funnel, LIVE from
 * the existing /api/admin/autopsy-funnel endpoint (9 owner-exact stages, same
 * bot/QA/admin exclusions and honest empty state as the journeys surface).
 */

interface AutopsyFunnelStage { stage: string; label: string; count: number; dropOffPct: number | null; }
interface AutopsyFunnelResult {
  rangeDays: number;
  from: string;
  to: string;
  funnel: AutopsyFunnelStage[];
}

const DAYS_OPTIONS = [7, 30, 90];

async function fetchAutopsyFunnel(days: number): Promise<AutopsyFunnelResult> {
  const res = await fetch(`/api/admin/autopsy-funnel?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load autopsy funnel" }));
    throw new Error(err.error || "Failed to load autopsy funnel");
  }
  return res.json();
}

function AutopsyPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AutopsyFunnelResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fin, setFin] = useState<FinanceResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAutopsyFunnel(days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load autopsy funnel"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

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
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {DAYS_OPTIONS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${days === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <AdminTabs active="autopsy" />

        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Autopsy Acquisition funnel</h2>
          <p className="mb-3 text-xs text-slate-500">
            "Why did you lose?" → lost solicitation → real award found → autopsy preview → signup wall → free
            signup → complete first autopsy viewed → Radar cross-sell → paid. Stages 6–8 are attributed to
            autopsy-funnel visitors only (organic signups never count here). QA/admin/bot/test traffic excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading || !data ? (
            <SectionLoading message="Loading autopsy funnel…" />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
                {data.funnel.map((s, i) => (
                  <div key={s.stage} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {i + 1}. {s.label}
                    </p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{s.count}</p>
                    {s.dropOffPct !== null && s.count < data.funnel[i - 1].count && (
                      <p className="mt-0.5 text-[10px] text-red-500">−{s.dropOffPct}% from prior</p>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-slate-400">
                Live counts + drop-off per consecutive stage. Stage 6 reuses the existing signup-complete event;
                stage 8 reuses radar completion / the cross-sell click; stage 9 derives from live subscriptions on
                autopsy-involved accounts.
              </p>
            </div>
          )}
        </section>

        {/* Autopsy → paid readout: the funnel's terminal stage, joined to the live MRR read */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Autopsy → revenue</h2>
          <p className="mb-3 text-xs text-slate-500">
            The funnel's terminal stage next to the live revenue read — the arc from a lost bid to paying customer.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Paid via this funnel</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">
                {error || loading || !data ? "—" : data.funnel[data.funnel.length - 1]?.count ?? 0}
              </p>
              <p className="mt-1 text-xs text-slate-400">Stage 9 · last {data?.rangeDays ?? days} days</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">MRR (live)</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{fin ? moneyWhole(fin.mrrCents) : "—"}</p>
              <p className="mt-1 text-xs text-slate-400">
                {fin ? (fin.source === "stripe-live" ? "Live Stripe read" : "Live app-database read (Stripe unreachable)") : "Loading live revenue read…"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Paying customers (live)</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{fin ? fin.customerCount : "—"}</p>
              <p className="mt-1 text-xs text-slate-400">See the Customers tab for the account list</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/admin/autopsy")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: AutopsyPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Autopsy | Admin | Contrax" }] }),
});
