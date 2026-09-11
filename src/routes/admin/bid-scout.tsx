import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
  SectionError,
  SectionLoading,
  timeFmt,
} from "~/components/AdminShared";

/**
 * /admin/bid-scout — Bid Scout fulfillment view (owner 2026-09-11, Phase B).
 *
 * Bid Scout is the $99/mo assisted-service product: five handpicked
 * opportunities every Friday. This tab is the fulfillment surface — every
 * bid_scout_subscriptions row, oldest active first (created_at ASC) so the
 * team works the oldest commitments first. Status filter defaults to 'active';
 * QA/admin/test rows are excluded server-side by the endpoint.
 *
 * Deliberately OUTSIDE every funnel tab: Bid Scout purchases never enter the
 * canonical unified funnel or the Radar Conversion / Autopsy funnels.
 */
const STATUS_OPTIONS = ["active", "pending", "past_due", "cancelled"] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

interface BidScoutSubscriptionRow {
  id: string;
  user_id: string | null;
  email: string | null;
  company_name: string | null;
  website: string | null;
  capabilities: string | null;
  naics_codes: string | null;
  certifications: string | null;
  target_states: string | null;
  notes: string | null;
  source: string | null;
  status: string | null;
  stripe_subscription_id: string | null;
  created_at: string | null;
}
interface SubscriptionsResult {
  status: string;
  subscriptions: BidScoutSubscriptionRow[];
}
async function fetchSubscriptions(status: string): Promise<SubscriptionsResult> {
  const res = await fetch(`/api/admin/bid-scout-subscriptions?status=${encodeURIComponent(status)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load Bid Scout subscriptions" }));
    throw new Error(err.error || "Failed to load Bid Scout subscriptions");
  }
  return res.json();
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-800",
  past_due: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

function BidScoutAdminPage() {
  const [status, setStatus] = useState<StatusOption>("active");
  const [data, setData] = useState<SubscriptionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchSubscriptions(status)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load subscriptions"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Bid Scout</h1>
            <p className="mt-1 text-xs text-slate-500">
              Fulfillment — $99/mo assisted-service subscriptions (separate from the self-serve funnel). QA/admin/test
              rows excluded.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="bs-status" className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Status
            </label>
            <select
              id="bs-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusOption)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <AdminTabs active="bid-scout" />

        {error ? (
          <SectionError message={error} />
        ) : loading || !data ? (
          <SectionLoading message="Loading Bid Scout subscriptions…" />
        ) : data.subscriptions.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">No {data.status} Bid Scout subscriptions right now.</p>
            <p className="mt-1 text-xs text-slate-400">
              The first {data.status === "active" ? "paying" : data.status} row appears here as soon as one exists —
              oldest first.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Capabilities</th>
                  <th className="px-4 py-3 font-medium">NAICS</th>
                  <th className="px-4 py-3 font-medium">Certs</th>
                  <th className="px-4 py-3 font-medium">Target states</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Stripe sub</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.subscriptions.map((s) => (
                  <tr key={s.id} className="border-t border-slate-50 align-top hover:bg-blue-50/30">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{s.company_name ?? "—"}</p>
                      {s.website && (
                        <p className="mt-0.5 text-[11px] text-blue-600">{s.website}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-slate-400" title={s.id}>id {s.id.slice(0, 8)}…</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700">{s.email ?? "—"}</p>
                      {s.user_id && <p className="mt-0.5 text-[10px] text-slate-400">user {s.user_id}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="max-w-[260px] text-xs leading-relaxed text-slate-600">{s.capabilities ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{s.naics_codes ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{s.certifications ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{s.target_states ?? "—"}</td>
                    <td className="px-4 py-3">
                      <p className="max-w-[200px] text-xs leading-relaxed text-slate-600">{s.notes ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
                        {s.status ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{s.source ?? "—"}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">{s.stripe_subscription_id ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{timeFmt(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-2.5 text-[10px] text-slate-400">
              {data.subscriptions.length} row(s) · sorted oldest first (created_at ASC) · status filter default = active ·
              every row read live from bid_scout_subscriptions (QA/admin/test emails excluded).
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/admin/bid-scout")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: BidScoutAdminPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Bid Scout | Admin | Contrax" }] }),
});