import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { AdminHeader, AdminTabs, MrrScoreboard, SectionError, SectionLoading, timeFmt } from "~/components/AdminShared";

/**
 * /admin/outreach — approve the day's "Open bid near you" emails (owner
 * 2026-10-23; src/lib/outreach.ts). The daily job queues drafts; nothing is
 * sent until "Send selected" is clicked here.
 */
export const Route = createFileRoute("/admin/outreach")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: OutreachPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Outreach | Admin | Contrax" }] }),
});

interface Draft {
  id: number;
  email: string;
  kind: "first" | "followup" | "prime";
  business: string;
  website: string | null;
  bid_title: string;
  buyer: string | null;
  due_date: string;
  trade_label: string;
  place?: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
  preview?: { subject: string; text: string };
}
interface Overview {
  postalAddress: string | null;
  drafts: Draft[];
  recent: Draft[];
  stats: { sentFirst: number; sentFollowup: number; sentToday: number; suppressed: number; drafts: number };
}

function OutreachPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [address, setAddress] = useState("");

  const load = () =>
    fetch("/api/admin/outreach")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load");
        setData(j);
        setPicked(new Set((j as Overview).drafts.map((d) => d.id)));
        setAddress((j as Overview).postalAddress ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  useEffect(() => {
    load();
  }, []);

  const act = async (body: Record<string, unknown>, done?: (j: Record<string, unknown>) => string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      if (done) setNotice(done(j));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const hasAddress = Boolean(data?.postalAddress);

  return (
    <div className="admin-console min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <AdminTabs active="outreach" />
        <p className="text-sm text-slate-600">
          Each weekday morning Contrax finds fresh open bids, looks up local businesses in that trade, and queues an "Open bid near you" email to the address
          each business publishes on its website. Four days later it queues one follow-up with the Bid Scout offer. Nothing is sent until you click
          <strong> Send selected</strong>. Replies go to minetreen@gmail.com; if someone replies "stop", add them under Do not contact.
        </p>
        {error && <SectionError message={error} />}
        {notice && <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{notice}</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900">Mailing address</h2>
          <p className="mt-1 text-sm text-slate-600">
            The law (CAN-SPAM) requires a physical mailing address in every email. It is printed at the bottom of each one. Stored here, not in the code.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, City, State ZIP"
              className="min-w-[280px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              disabled={busy || !address.trim()}
              onClick={() => act({ action: "address", address }, () => "Mailing address saved.")}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save address
            </button>
          </div>
          {!hasAddress && data && <p className="mt-2 text-sm font-semibold text-amber-700">Emails cannot be sent until the address is saved.</p>}
        </section>

        {data && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Waiting for approval", data.stats.drafts],
              ["Sent today", data.stats.sentToday],
              ["First emails sent", data.stats.sentFirst],
              ["Follow-ups sent", data.stats.sentFollowup],
              ["Unsubscribed / stop", data.stats.suppressed],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-2xl font-bold text-slate-900">{n as number}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label as string}</p>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">Today's emails</h2>
            <div className="flex gap-2">
            <button
              disabled={busy || !data?.drafts.length}
              onClick={() => {
                if (!confirm("Skip every waiting email? None of them will be sent.")) return;
                act({ action: "skip_all" }, (j) => `Skipped ${j.skipped}.`);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Skip all
            </button>
            <button
              disabled={busy || !hasAddress || picked.size === 0}
              onClick={() => {
                if (!confirm(`Send ${picked.size} email(s) now?`)) return;
                act({ action: "send", ids: [...picked] }, (j) => `Sent ${j.sent}. Failed ${j.failed}. Skipped ${j.skipped}.`);
              }}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Send selected ({picked.size})
            </button>
            </div>
          </div>
          {!data ? (
            <SectionLoading message="Loading…" />
          ) : data.drafts.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No emails waiting. The daily job queues new ones each weekday morning.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {data.drafts.map((d) => (
                <li key={d.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1" checked={picked.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Send to ${d.business}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {d.business}{" "}
                        <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${d.kind === "followup" ? "bg-amber-100 text-amber-800" : d.kind === "prime" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                          {d.kind === "followup" ? "Follow-up" : d.kind === "prime" ? "Prime: free sub list" : "First email"}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {d.email}
                        {d.website && (
                          <>
                            {" · "}
                            <a href={d.website} target="_blank" rel="noreferrer" className="underline">website</a>
                          </>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {d.kind === "prime"
                          ? `${d.bid_title} · ${d.buyer ?? "—"} · work in ${d.place ?? "—"} · ${d.trade_label}`
                          : `${d.bid_title} · ${d.buyer ?? "—"} · due ${d.due_date} · ${d.trade_label}`}
                      </p>
                      <div className="mt-1 flex gap-3 text-xs">
                        <button className="font-medium text-blue-700" onClick={() => setOpen(open === d.id ? null : d.id)}>
                          {open === d.id ? "Hide email" : "Show email"}
                        </button>
                        <button className="font-medium text-slate-600" disabled={busy} onClick={() => act({ action: "skip", id: d.id })}>
                          Skip
                        </button>
                        <button className="font-medium text-red-700" disabled={busy} onClick={() => act({ action: "suppress", email: d.email }, () => `${d.email} will never be emailed.`)}>
                          Do not contact
                        </button>
                      </div>
                      {open === d.id && d.preview && (
                        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                          {`Subject: ${d.preview.subject}\n\n${d.preview.text}`}
                        </pre>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900">Do not contact</h2>
          <p className="mt-1 text-sm text-slate-600">Someone replied "stop"? Add their address and they will never be emailed again.</p>
          <DoNotContact busy={busy} onAdd={(email) => act({ action: "suppress", email }, () => `${email} will never be emailed.`)} />
        </section>

        {data && data.recent.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-900">Recently sent</h2>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {data.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {r.business} <span className="text-slate-500">({r.email})</span> · {r.kind === "followup" ? "follow-up" : r.kind === "prime" ? "prime" : "first"}
                  </span>
                  <span className={r.status === "failed" ? "text-red-700" : "text-slate-500"}>
                    {r.status === "failed" ? `failed: ${r.error ?? ""}` : r.sent_at ? timeFmt(r.sent_at) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function DoNotContact({ busy, onAdd }: { busy: boolean; onAdd: (email: string) => void }) {
  const [email, setEmail] = useState("");
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <button
        disabled={busy || !email.includes("@")}
        onClick={() => {
          onAdd(email.trim());
          setEmail("");
        }}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}
