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
  dayFmt,
  type FinanceResult,
  fetchFinance,
} from "~/components/AdminShared";

/**
 * /admin/customers — Customers tab of the redesigned admin dashboard (owner
 * 2026-09-07). The paying-customer list LIVE from /api/admin/finance: every
 * figure is a live read (Stripe preferred, app-DB fallback), never hardcoded,
 * honestly labeled by source. QA/test/admin/demo rows are excluded server-side
 * with the same helpers as every admin surface.
 */

function CustomersPage() {
  const [fin, setFin] = useState<FinanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchFinance()
      .then((d) => { if (!cancelled) setFin(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load customers"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        </div>
        <AdminTabs active="customers" />

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Paying customers</h2>
            {!loading && !error && fin && (
              <p className="text-xs text-slate-400">
                {fin.source === "stripe-live"
                  ? "Live Stripe read — actual active subscriptions"
                  : "Live app-database read — Stripe unreachable, subscription rows the webhook maintains"}
                {fin.truncated ? " · over 100 active subscriptions — totals capped" : ""}
              </p>
            )}
          </div>
          {error ? (
            <SectionError message={error} />
          ) : loading || !fin ? (
            <SectionLoading message="Loading live customer read…" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">MRR</p>
                  <p className="mt-2 text-4xl font-bold text-slate-900">{moneyWhole(fin.mrrCents)}</p>
                  <p className="mt-1 text-xs text-slate-400">Monthly recurring revenue, live</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Customers</p>
                  <p className="mt-2 text-4xl font-bold text-slate-900">{fin.customerCount}</p>
                  <p className="mt-1 text-xs text-slate-400">Active subscriptions, live</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Customers by tier</p>
                  <div className="mt-2 space-y-1.5">
                    {fin.tiers.length === 0 ? (
                      <p className="text-sm text-slate-400">No paying customers yet</p>
                    ) : (
                      fin.tiers.map((t) => (
                        <div key={t.tier} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-700 capitalize">{t.tier}</span>
                          <span className="text-sm text-slate-500">
                            {t.customers} · <span className="font-bold text-slate-900">{moneyWhole(t.mrrCents)}</span>
                          </span>
                        </div>
                      ))
                    )}
                    {/* Bid Scout MRR — SEPARATE line (owner 2026-09-11): never
                        inside the Starter/Professional/Agency buckets, never a
                        9th CONTRAX TODAY card. Forward-compatible: present even
                        when 0. */}
                    {fin.display?.map((d) => (
                      <div key={d.product} className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                        <span className="text-sm font-semibold text-slate-700">{d.label}</span>
                        <span className="text-sm text-slate-500">
                          {fin.bidScoutCustomers != null ? `${fin.bidScoutCustomers} · ` : ""}
                          <span className="font-bold text-slate-900">{moneyWhole(d.amount)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="font-bold text-slate-900">Customer accounts ({fin.customers.length})</h3>
                </div>
                {fin.customers.length === 0 ? (
                  <div className="px-5 py-6">
                    <p className="text-sm font-medium text-slate-700">No paying customers yet — this is the number we're trying to change.</p>
                    <p className="mt-1 text-xs text-slate-400">
                      The moment the first subscription activates, it appears here (and in the top-right scoreboard) automatically.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                          <th className="px-5 py-3 font-medium">Email</th>
                          <th className="px-5 py-3 font-medium">Plan</th>
                          <th className="px-5 py-3 font-medium">Customer since</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fin.customers.map((c) => (
                          <tr key={c.email} className="border-t border-slate-50">
                            <td className="px-5 py-2.5">
                              <a href={`mailto:${c.email}`} className="text-blue-600 hover:text-blue-700 hover:underline">{c.email}</a>
                            </td>
                            <td className="px-5 py-2.5">
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
                                {c.planTier || "—"}
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-slate-400 whitespace-nowrap">{dayFmt(c.since)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/admin/customers")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: CustomersPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Customers | Admin | Contrax" }] }),
});
