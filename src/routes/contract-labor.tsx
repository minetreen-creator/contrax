import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, type AuthUser } from "~/lib/auth";

type Entry = { id: number | null; worker_name: string; job_name: string; work_date: string;
  hours_hundredths: number; hourly_rate_cents: number; reviewed: boolean; notes: string; archived: boolean };
const blank: Entry = { id: null, worker_name: "", job_name: "", work_date: "", hours_hundredths: 0,
  hourly_rate_cents: 0, reviewed: false, notes: "", archived: false };
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900";

export const Route = createFileRoute("/contract-labor")({
  loader: async (): Promise<{ user: AuthUser | null }> => ({ user: await getCurrentUser() }),
  component: Guard,
  head: () => ({ meta: [{ title: "Contrax Payments — Labor Review" }, { name: "robots", content: "noindex, nofollow" }] }),
});

function Guard() {
  const { user } = Route.useLoaderData();
  const navigate = useNavigate();
  useEffect(() => { if (!user) navigate({ to: "/login" }); }, [user, navigate]);
  return user ? <LaborPage /> : null;
}

function LaborPage() {
  const [items, setItems] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Entry | null>(null);
  const [hours, setHours] = useState("0.00");
  const [rate, setRate] = useState("0.00");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/contract-labor")
      .then(async (r) => { if (!r.ok) throw new Error("Could not load labor entries"); return r.json(); })
      .then((body) => setItems(body.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  function edit(item: Entry) {
    setDraft({ ...item, archived: false }); setHours((item.hours_hundredths / 100).toFixed(2));
    setRate((item.hourly_rate_cents / 100).toFixed(2)); setError("");
  }
  const update = <K extends keyof Entry>(key: K, value: Entry[K]) =>
    setDraft((old) => old ? { ...old, [key]: value } : old);
  async function save(archive = false) {
    if (!draft || busy) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(hours) || !/^\d+(?:\.\d{1,2})?$/.test(rate)) {
      setError("Enter hours and hourly rate with at most two decimal places."); return;
    }
    const hundredths = Math.round(Number(hours) * 100);
    const cents = Math.round(Number(rate) * 100);
    if (!Number.isSafeInteger(hundredths) || hundredths > 2400 || !Number.isSafeInteger(cents)) {
      setError("Hours must be 0 to 24; check the hourly rate."); return;
    }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/contract-labor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, hours_hundredths: hundredths, hourly_rate_cents: cents, archived: archive }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not save labor entry");
      setItems((old) => archive ? old.filter((x) => x.id !== body.data.id)
        : [body.data, ...old.filter((x) => x.id !== body.data.id)]);
      setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save labor entry"); }
    finally { setBusy(false); }
  }
  const gross = items.reduce((sum, x) => sum + x.hours_hundredths * x.hourly_rate_cents / 100, 0);
  return <div className="min-h-screen bg-slate-50"><main className="mx-auto max-w-5xl px-4 py-10 text-slate-900">
    <nav className="mb-8 text-sm"><a className="text-blue-700 hover:underline" href="/contract-payments">← Payment follow-up</a></nav>
    <div className="flex flex-wrap justify-between gap-4"><div><p className="text-sm font-semibold uppercase text-blue-700">Contrax Payments</p>
      <h1 className="mt-1 text-3xl font-bold">Labor review</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Record hours by worker and job before handing them to your payroll provider. Estimated gross is regular hours × entered rate. Review overtime, classification, taxes, and deductions in your payroll system.</p></div>
      <button className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" onClick={() => edit(blank)}>Add hours</button></div>
    <div className="mt-7 grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-5">Entries to review: <strong>{items.filter((x) => !x.reviewed).length}</strong></div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">Estimated gross for displayed entries: <strong>{money(gross)}</strong></div></div>
    {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {draft && <form className="mt-8 rounded-xl border bg-slate-50 p-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2 className="mb-4 text-xl font-bold">{draft.id ? "Edit hours" : "Record hours"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Worker name *<input required maxLength={200} className={inputClass} value={draft.worker_name} onChange={(e) => update("worker_name", e.target.value)} /></label>
        <label>Job or contract *<input required maxLength={200} className={inputClass} value={draft.job_name} onChange={(e) => update("job_name", e.target.value)} /></label>
        <label>Work date *<input required type="date" className={inputClass} value={draft.work_date} onChange={(e) => update("work_date", e.target.value)} /></label>
        <label>Hours (single day, max 24) *<input required inputMode="decimal" className={inputClass} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        <label>Hourly rate ($) *<input required inputMode="decimal" className={inputClass} value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <label>Notes<textarea maxLength={3000} className={inputClass} value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></label>
      </div>
      <label className="mt-4 flex items-center gap-2"><input type="checkbox" checked={draft.reviewed} onChange={(e) => update("reviewed", e.target.checked)} />Reviewed against timesheet</label>
      <div className="mt-5 flex gap-3"><button disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save entry"}</button>
        <button type="button" onClick={() => setDraft(null)}>Cancel</button>
        {draft.id && <button type="button" disabled={busy} className="ml-auto underline" onClick={() => void save(true)}>Archive</button>}</div>
    </form>}
    <section className="mt-8"><h2 className="mb-4 text-xl font-bold">Time entries</h2>
      {loading ? <p>Loading…</p> : items.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6">No hours recorded yet.</p> :
        <div className="space-y-3">{items.map((x) => <article key={x.id} className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex justify-between gap-3"><div><strong>{x.worker_name}</strong><p>{x.job_name} · {x.work_date}</p></div><strong>{money(x.hours_hundredths * x.hourly_rate_cents / 100)}</strong></div>
          <p className="mt-2 text-sm text-slate-600">{(x.hours_hundredths / 100).toFixed(2)} hours × {money(x.hourly_rate_cents)}/hour · {x.reviewed ? "Reviewed" : "Needs review"}</p>
          <button className="mt-2 text-sm font-semibold text-blue-700 underline" onClick={() => edit(x)}>Edit entry</button>
        </article>)}</div>}
    </section>
    <p className="mt-8 text-xs text-slate-500">Planning tool only. No paychecks, tax withholding, filings, or wage statements are generated.</p>
  </main></div>;
}
