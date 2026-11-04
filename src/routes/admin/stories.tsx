import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { AdminHeader, AdminTabs, SectionError, SectionLoading, timeFmt } from "~/components/AdminShared";
import { outcomeLabel, SHARE_LEVELS, storyByline, type StoryOutcome, type ShareLevel } from "~/lib/success-stories";

/**
 * /admin/stories — approve or reject submitted success stories (owner
 * 2026-11-04). The public page /success-stories goes live on its own once
 * enough approved, shareable stories exist.
 */
export const Route = createFileRoute("/admin/stories")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: StoriesAdminPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Success Stories | Admin | Contrax" }] }),
});

interface Row {
  id: number;
  created_at: string;
  name: string;
  business: string | null;
  email: string;
  trade: string;
  state: string | null;
  outcome: StoryOutcome;
  story: string;
  share: ShareLevel;
  status: "pending" | "approved" | "rejected";
}

function StoriesAdminPage() {
  const [data, setData] = useState<{ stories: Row[]; published: number; needed: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/admin/success-stories")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load");
        setData(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  useEffect(() => { load(); }, []);

  const act = async (action: "approve" | "reject" | "pending", id: number) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/success-stories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Update failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <AdminTabs active="stories" />
        <h1 className="mt-6 text-2xl font-bold text-slate-900">Success stories</h1>
        {error && <SectionError message={error} />}
        {!data ? (
          <SectionLoading message="Loading stories…" />
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              {data.published >= data.needed
                ? <>The public page is live: <a className="text-blue-700 underline" href="/success-stories">/success-stories</a> ({data.published} stories).</>
                : <>The public page goes live at {data.needed} approved, shareable stories (now {data.published}). Ask customers at <a className="text-blue-700 underline" href="/share-your-story">/share-your-story</a>.</>}
            </p>
            {data.stories.length === 0 && <p className="mt-6 text-slate-500">No stories yet.</p>}
            <div className="mt-6 space-y-4">
              {data.stories.map((s) => (
                <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-semibold text-slate-900">{s.name}{s.business ? `, ${s.business}` : ""} · {s.trade}{s.state ? ` · ${s.state}` : ""}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.status === "approved" ? "bg-emerald-100 text-emerald-800" : s.status === "rejected" ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-800"}`}>{s.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{s.email} · {timeFmt(s.created_at)} · {outcomeLabel(s.outcome)}</p>
                  <p className="mt-3 whitespace-pre-line text-slate-800">{s.story}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    Share: {SHARE_LEVELS.find((l) => l.key === s.share)?.label}
                    {s.share !== "private" && <> · Shown as: <b>{storyByline(s)}</b></>}
                  </p>
                  <div className="mt-3 flex gap-3 text-sm">
                    {s.status !== "approved" && s.share !== "private" && <button disabled={busy} className="font-semibold text-emerald-700" onClick={() => act("approve", s.id)}>Approve</button>}
                    {s.status !== "rejected" && <button disabled={busy} className="font-semibold text-red-700" onClick={() => act("reject", s.id)}>Reject</button>}
                    {s.status !== "pending" && <button disabled={busy} className="text-slate-600" onClick={() => act("pending", s.id)}>Back to pending</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
