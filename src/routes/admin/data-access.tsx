import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
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
    <div className="admin-console min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <AdminTabs active="data-access" />
        <p className="text-sm text-slate-600">
          Businesses request the bid data feed at <a className="font-medium text-blue-700 underline" href="/data">contrax.company/data</a>.
          To give a customer access, they need a Contrax account (any plan); grant it below and email them the key.
        </p>
        {error && <SectionError message={error} />}

        <StripeWebhookCheck />

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

interface StripeSetup {
  keyMode: "live" | "test" | "missing";
  webhookSecretSet: boolean;
  endpoints: { id: string; url: string; status: string; missing: string[] }[];
  portal: { ready: boolean; isDefault: boolean; configurationId: string | null };
}

/**
 * Paid plans only switch on when Stripe is set up end to end: live key, webhook
 * secret, a webhook sending the right events, and a customer portal. One click
 * fixes what the site can fix itself (stripe-setup.server.ts, owner 2026-10-22).
 */
function StripeWebhookCheck() {
  const [setup, setSetup] = useState<StripeSetup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: "stripe-setup-check" | "stripe-setup-fix") => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/data-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Stripe check failed");
      setSetup(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stripe check failed");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { run("stripe-setup-check"); }, []);

  const fixable = setup ? setup.endpoints.some((e) => e.missing.length > 0) || !setup.portal.ready : false;
  const row = (ok: boolean, text: ReactNode) => (
    <p className={`mt-2 ${ok ? "text-emerald-700" : "text-amber-800"}`}>{ok ? "✓ " : "⚠ "}{text}</p>
  );
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold text-slate-900">Stripe setup</h2>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {!setup && !error && <p className="mt-2 text-slate-500">Checking Stripe…</p>}
      {setup && (
        <>
          {row(setup.keyMode === "live", setup.keyMode === "live" ? "Live secret key is set." : setup.keyMode === "test" ? "The secret key is a TEST key: real cards won't be charged. Put the live key (sk_live_…) in Vercel." : "No Stripe secret key is set in Vercel.")}
          {row(setup.webhookSecretSet, setup.webhookSecretSet ? "Webhook signing secret is set." : "STRIPE_WEBHOOK_SECRET is not set in Vercel: payments won't switch plans on.")}
          {setup.endpoints.length === 0 && row(false, "No Stripe webhook points at contrax.company/api/stripe/webhook. Paid plans won't switch on until one does.")}
          {setup.endpoints.map((e) =>
            <div key={e.id}>{row(e.missing.length === 0 && e.status === "enabled", <>
              <span className="break-all">{e.url}</span>
              {e.status !== "enabled" && <span className="font-semibold"> ({e.status})</span>}
              {e.missing.length ? ` is missing: ${e.missing.join(", ")}` : " sends every event the plans need."}
            </>)}</div>,
          )}
          {row(setup.portal.ready, setup.portal.ready ? "Customer portal is set up (customers can update their card, see invoices and cancel)." : "Customer portal is not set up: customers can't manage or cancel their plan.")}
          {fixable && (
            <button disabled={busy} onClick={() => run("stripe-setup-fix")} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? "Fixing…" : "Fix Stripe setup"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
