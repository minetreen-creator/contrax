import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { AdminHeader, AdminTabs, MrrScoreboard, SectionError, SectionLoading, timeFmt } from "~/components/AdminShared";

/**
 * /admin/data-access — data feed requests and customers (owner 2026-10-06).
 * Granting access issues a new API key, shown ONCE here to send to the customer.
 */
export const Route = createFileRoute("/admin/data-access")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: DataAccessPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Data API | Admin | Contrax" }] }),
});

interface RequestRow { id: number; name: string; email: string; company: string; use_case: string | null; states: string | null; message: string | null; status: string; created_at: string }
interface GrantRow { user_id: number; email: string; granted_at: string; active: boolean; note: string | null; last_used_at: string | null }

function DataAccessPage() {
  const [data, setData] = useState<{ requests: RequestRow[]; grants: GrantRow[] } | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [issued, setIssued] = useState<{ key: string; userEmail: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/admin/data-access")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load");
        setData(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  useEffect(() => { load(); }, []);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/data-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Action failed");
      if (j.key) setIssued({ key: j.key, userEmail: j.userEmail });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <AdminTabs active="data-access" />
        <p className="text-sm text-slate-600">
          Businesses request the bid data feed at <a className="font-medium text-blue-700 underline" href="/data">contrax.company/data</a>.
          To give a customer access, they need a Contrax account (any plan); grant it below and email them the key.
        </p>
        {error && <SectionError message={error} />}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Grant access</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Customer's Contrax account email" className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (plan, price)" className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button disabled={busy || !email.trim()} onClick={() => act({ action: "grant", email, note })} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Grant and issue key
            </button>
          </div>
          {issued && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">API key for {issued.userEmail}: copy it now, it won&rsquo;t be shown again.</p>
              <code className="mt-1 block break-all font-mono text-xs">{issued.key}</code>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">Requests</h2>
          {!data ? <SectionLoading message="Loading…" /> : data.requests.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No requests yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {data.requests.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-slate-900">{r.company}</span>
                    <span className="text-slate-600">{r.name} · <a className="text-blue-700" href={`mailto:${r.email}`}>{r.email}</a></span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === "granted" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{r.status}</span>
                    <span className="ml-auto text-xs text-slate-400">{timeFmt(r.created_at)}</span>
                  </div>
                  <p className="mt-1 text-slate-600">{[r.use_case, r.states && `States: ${r.states}`].filter(Boolean).join(" · ")}</p>
                  {r.message && <p className="mt-1 text-slate-500">{r.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">Customers with access</h2>
          {!data ? <SectionLoading message="Loading…" /> : data.grants.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No one has access yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {data.grants.map((g) => (
                <li key={g.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="font-semibold text-slate-900">{g.email}</span>
                  {g.note && <span className="text-slate-500">{g.note}</span>}
                  <span className="text-xs text-slate-400">granted {timeFmt(g.granted_at)} · last used {g.last_used_at ? timeFmt(g.last_used_at) : "never"}</span>
                  <span className="ml-auto">
                    {g.active ? (
                      <button disabled={busy} onClick={() => act({ action: "revoke", userId: g.user_id })} className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">Revoke</button>
                    ) : (
                      <span className="text-xs text-slate-400">revoked</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
