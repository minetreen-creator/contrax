import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { AdminHeader, AdminTabs, MrrScoreboard, SectionError, SectionLoading } from "~/components/AdminShared";

type Subscription = {
  email: string;
  status: string;
  interval: "monthly" | "annual" | "unknown";
  currentPeriodEnd: string | null;
  updatedAt: string;
};
type Result = { source: "app-db-webhook"; active: number; total: number; subscriptions: Subscription[] };

function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "—" : parsed.toLocaleDateString();
}

function PaymentsPage() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/payments").then(async (response) => {
      if (!response.ok) throw new Error("Could not load Contrax Payments subscriptions");
      return response.json() as Promise<Result>;
    }).then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load subscriptions"); });
    return () => { cancelled = true; };
  }, []);

  return <div className="min-h-screen bg-slate-50">
    <AdminHeader scoreboard={<MrrScoreboard />} />
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
      <AdminTabs active="payments" />
      <section aria-labelledby="payments-heading" className="space-y-5">
        <div>
          <h2 id="payments-heading" className="text-xl font-bold text-slate-900">Contrax Payments subscribers</h2>
          <p className="mt-1 text-sm text-slate-600">Separate subscription from Radar and Bid Scout. Statuses come from the app database maintained by verified Stripe webhooks, not a live Stripe read.</p>
        </div>
        {error ? <SectionError message={error} /> : !data ? <SectionLoading message="Loading subscriptions…" /> : <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm"><p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Active or trialing</p><p className="mt-2 text-4xl font-bold text-slate-950">{data.active}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Accounts with a subscription record</p><p className="mt-2 text-4xl font-bold text-slate-950">{data.total}</p></div>
          </div>
          {data.subscriptions.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">No external accounts have a Contrax Payments subscription record yet. Opening Checkout alone does not count as a signup.</p> :
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-700"><tr><th className="px-5 py-3">Account</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Billing</th><th className="px-5 py-3">Current period ends</th><th className="px-5 py-3">Last updated</th></tr></thead>
              <tbody>{data.subscriptions.map((item) => <tr key={item.email} className="border-t border-slate-100">
                <td className="px-5 py-3"><a className="font-medium text-blue-700 hover:underline" href={`mailto:${item.email}`}>{item.email}</a></td>
                <td className="px-5 py-3 capitalize">{item.status.replaceAll("_", " ")}</td>
                <td className="px-5 py-3 capitalize">{item.interval}</td>
                <td className="px-5 py-3">{date(item.currentPeriodEnd)}</td>
                <td className="px-5 py-3">{date(item.updatedAt)}</td>
              </tr>)}</tbody>
            </table></div>}
        </>}
      </section>
    </main>
  </div>;
}

export const Route = createFileRoute("/admin/payments")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: PaymentsPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Contrax Payments | Admin | Contrax" }] }),
});
