import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";
import { ensureBidAlertsTable } from "~/lib/bid-alerts";
import { TrialGate } from "~/components/TrialGate";

const getAlerts = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
  await ensureBidAlertsTable();
  const rows = await sql()`SELECT a.id, a.bid_id, a.is_read, a.created_at, b.title, b.agency, b.due_date, b.category, b.set_aside, b.source_url FROM bid_alerts a JOIN bids b ON b.id=a.bid_id WHERE a.user_id=${user.id} ORDER BY a.created_at DESC LIMIT 50`;
  const unread = await sql()`SELECT COUNT(*)::int AS count FROM bid_alerts WHERE user_id=${user.id} AND is_read=false`;
  return { alerts: (rows as any[]).map((r) => ({ ...r, id: Number(r.id), bid_id: Number(r.bid_id), due_date: r.due_date ? String(r.due_date) : null, created_at: String(r.created_at), match_reason: r.set_aside ? "Set-aside opportunity matching your profile" : "Opportunity matching your tracked business categories" })), unread: Number((unread[0] as any)?.count || 0) };
});
const markAlertRead = createServerFn({ method: "POST" }).validator((d: unknown) => ({ id: Number((d as any).id) })).handler(async ({ data }) => {
  const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
  await ensureBidAlertsTable(); await sql()`UPDATE bid_alerts SET is_read=true WHERE id=${data.id} AND user_id=${user.id}`; return { ok: true };
});
const markAllAlertsRead = createServerFn({ method: "POST" }).handler(async () => { const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated"); await ensureBidAlertsTable(); await sql()`UPDATE bid_alerts SET is_read=true WHERE user_id=${user.id}`; return { ok: true }; });

export const Route = createFileRoute("/alerts")({
  loader: () => getAlerts(),
  head: () => ({ meta: [{ title: "Bid Alerts — Contrax" }, { name: "description", content: "Review new government opportunities matched to your business profile." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AlertsPage,
});
function AlertsPage() {
  const data = Route.useLoaderData(); const [alerts, setAlerts] = useState(data.alerts); const [unread, setUnread] = useState(data.unread);
  const markOne = async (id: number) => { await markAlertRead({ data: { id } }); setAlerts((a) => a.map((x) => x.id === id ? { ...x, is_read: true } : x)); setUnread((n) => Math.max(0, n - 1)); };
  const markAll = async () => { await markAllAlertsRead(); setAlerts((a) => a.map((x) => ({ ...x, is_read: true }))); setUnread(0); };
  return <TrialGate><div className="min-h-screen bg-slate-50"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4"><a href="/dashboard" className="font-bold text-slate-900">← Dashboard</a><a href="/" className="text-lg font-bold text-slate-900">Contrax</a></div></header><main className="mx-auto max-w-4xl px-4 py-10"><div className="mb-8 flex items-end justify-between"><div><p className="text-sm font-semibold uppercase tracking-wider text-amber-600">Opportunity monitor</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Bid alerts {unread > 0 && <span className="ml-2 inline-flex rounded-full bg-amber-500 px-2.5 py-1 align-middle text-sm text-white">{unread} new</span>}</h1><p className="mt-2 text-slate-600">New opportunities matched to your business profile.</p></div>{unread > 0 && <button onClick={markAll} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Mark all read</button>}</div>{alerts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><div className="text-4xl">🔔</div><h2 className="mt-4 text-xl font-semibold text-slate-900">No bid alerts yet</h2><p className="mx-auto mt-2 max-w-md text-slate-500">Complete your business profile with NAICS codes and service categories. We’ll surface new matching opportunities here after the next sync.</p><a href="/settings" className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Update profile</a></div> : <div className="space-y-3">{alerts.map((a) => <article key={a.id} className={`rounded-xl border bg-white p-5 shadow-sm ${a.is_read ? "border-slate-200" : "border-amber-300 bg-amber-50/30"}`}><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="font-semibold text-slate-900">{a.title}</h2>{!a.is_read && <span className="h-2 w-2 rounded-full bg-amber-500" />}</div><p className="mt-1 text-sm text-slate-600">{a.agency} · {a.match_reason}</p><p className="mt-2 text-xs text-slate-500">Due: {a.due_date ? new Date(a.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not specified"}</p></div><div className="flex shrink-0 items-center gap-3">{!a.is_read && <button onClick={() => markOne(a.id)} className="text-xs font-semibold text-slate-500 hover:text-slate-900">Mark read</button>}<a href={`/awards#bid-${a.bid_id}`} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">View bid →</a></div></div></article>)}</div>}</main></div></TrialGate>;
}
