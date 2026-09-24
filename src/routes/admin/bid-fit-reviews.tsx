import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { AdminHeader, AdminTabs, SectionError, SectionLoading, timeFmt } from "~/components/AdminShared";

type Status = "new" | "reviewing" | "awaiting_payment" | "in_progress" | "completed" | "declined";
const STATUS_LABELS: Record<Status, string> = {
  new: "New", reviewing: "Reviewing", awaiting_payment: "Awaiting payment",
  in_progress: "In progress", completed: "Completed", declined: "Declined",
};
interface ReviewRequest {
  id: number;
  name: string;
  business: string;
  email: string;
  solicitation_url: string;
  capabilities: string;
  deadline: string;
  documents_available: "yes" | "login" | "unsure";
  status: Status;
  notification_status: "pending" | "sent" | "failed";
  created_at: string;
  updated_at: string;
}

export const Route = createFileRoute("/admin/bid-fit-reviews")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
  },
  head: () => ({ meta: [{ title: "Bid Fit Reviews | Contrax Admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: BidFitReviewsPage,
});

function BidFitReviewsPage() {
  const [requests, setRequests] = useState<ReviewRequest[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/bid-fit-reviews");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load review requests");
    setRequests(body.requests);
  }, []);
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [refresh]);
  async function updateStatus(id: number, status: Status) {
    setSaving(id);
    setError("");
    try {
      const response = await fetch("/api/admin/bid-fit-reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update status");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update status"); }
    finally { setSaving(null); }
  }
  const visible = requests?.filter((r) => filter === "all" || r.status === filter) ?? [];
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <AdminHeader />
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <AdminTabs active="bid-fit-reviews" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-bold">Bid Fit Reviews</h1>
          <p className="mt-2 text-sm text-slate-600">One-time $99 service requests. Statuses track work only; they do not confirm payment or count revenue.</p></div>
        <button onClick={() => { setError(""); refresh().catch((e) => setError(e.message)); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Refresh</button>
      </div>
      {error && <SectionError message={error} />}
      {!requests ? (!error && <SectionLoading message="Loading review requests…" />) : <>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{requests.length} recent requests</span>
          <label className="text-sm">Status <select value={filter} onChange={(e) => setFilter(e.target.value as Status | "all")} className="ml-2 rounded-lg border border-slate-300 bg-white p-2">
            <option value="all">All</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        {visible.length === 0 ? <p className="rounded-xl border bg-white p-6 text-slate-600">No requests in this view. Requests received before this queue was added were delivered by email only.</p> :
          <div className="space-y-4">{visible.map((r) => <article key={r.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-bold">{r.business}</h2><p className="text-sm text-slate-600">{r.name} · <a className="text-blue-700 underline" href={`mailto:${r.email}`}>{r.email}</a></p></div><span className="text-sm text-slate-500">Received {timeFmt(r.created_at)}</span></div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><p><strong>Bid deadline:</strong> {r.deadline}</p><p><strong>Documents:</strong> {r.documents_available === "yes" ? "Accessible via link" : r.documents_available === "login" ? "Login required" : "Unclear"}</p></div>
            <p className="mt-3 break-all text-sm"><strong>Solicitation:</strong> <a href={r.solicitation_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{r.solicitation_url}</a></p>
            <p className="mt-3 whitespace-pre-wrap text-sm"><strong>Capabilities:</strong> {r.capabilities}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
              <label className="font-semibold">Work status <select value={r.status} disabled={saving === r.id} onChange={(e) => updateStatus(r.id, e.target.value as Status)} className="ml-2 rounded-lg border border-slate-300 bg-white p-2 font-normal">
                {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select></label>
              <span className={r.notification_status === "failed" ? "font-semibold text-red-700" : "text-slate-500"}>Email notification: {r.notification_status}</span>
            </div>
          </article>)}</div>}
      </>}
    </main>
  </div>;
}
