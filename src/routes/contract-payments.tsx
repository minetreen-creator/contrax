import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import { PAYMENT_STATUSES, type PaymentInput } from "~/lib/contract-payments";

type RecordItem = PaymentInput & { id: number; created_at: string; updated_at: string };
const empty: PaymentInput = {
  id: null, customer_name: "", job_name: "", invoice_number: "", amount_cents: 0,
  invoice_due_date: null, purchase_order_number: "", status: "draft",
  invoice_attached: false, po_confirmed: false, supporting_docs_ready: false,
  next_action: "", follow_up_date: null, notes: "", archived: false,
};
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none";
const label = "block text-sm font-medium text-slate-700";

export const Route = createFileRoute("/contract-payments")({
  loader: async (): Promise<{ user: AuthUser | null }> => ({ user: await getCurrentUser() }),
  component: Guard,
  head: () => ({ meta: [{ title: "Payment Follow-up | Contrax" }, { name: "robots", content: "noindex, nofollow" }] }),
});

function Guard() {
  const { user } = Route.useLoaderData();
  const navigate = useNavigate();
  useEffect(() => { if (!user) navigate({ to: "/login" }); }, [user, navigate]);
  return user ? <PaymentPage /> : null;
}

function PaymentPage() {
  const [items, setItems] = useState<RecordItem[]>([]);
  const [draft, setDraft] = useState<PaymentInput | null>(null);
  const [amount, setAmount] = useState("0.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/contract-payments")
      .then(async (r) => { if (!r.ok) throw new Error("Could not load payment records"); return r.json(); })
      .then((body) => setItems(body.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function edit(item: PaymentInput) {
    setDraft({ ...item, archived: false });
    setAmount((item.amount_cents / 100).toFixed(2));
    setError("");
  }

  async function save(archive = false) {
    if (!draft || busy) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) { setError("Enter an amount in dollars and cents."); return; }
    const [dollars, cents = ""] = amount.split(".");
    const amountCents = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountCents)) { setError("Amount is too large."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/contract-payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, amount_cents: amountCents, archived: archive }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not save payment record");
      setItems((old) => archive ? old.filter((x) => x.id !== body.data.id)
        : [body.data, ...old.filter((x) => x.id !== body.data.id)]);
      setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save payment record"); }
    finally { setBusy(false); }
  }

  const open = items.filter((x) => x.status !== "paid");
  const owed = open.reduce((sum, x) => sum + x.amount_cents, 0);
  const today = new Date().toISOString().slice(0, 10);
  const needsFollowUp = open.filter((x) => x.follow_up_date && x.follow_up_date <= today).length;
  const update = <K extends keyof PaymentInput>(key: K, value: PaymentInput[K]) =>
    setDraft((old) => old ? { ...old, [key]: value } : old);

  return <main className="mx-auto max-w-5xl px-4 py-10 text-slate-900">
    <nav className="mb-8 flex gap-6 text-sm"><a className="text-blue-700 hover:underline" href="/dashboard">← Dashboard</a><a className="text-blue-700 hover:underline" href="/contract-labor">Labor review →</a></nav>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Pilot workspace</p>
        <h1 className="mt-1 text-3xl font-bold">Contract payment follow-up</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Keep invoice details, required items, and your next follow-up together. Statuses are entered by you; Contrax does not verify receipt or collect payment.</p></div>
      <button className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800" onClick={() => edit(empty)}>Add invoice</button>
    </div>
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      {[['Open records', String(open.length)], ['Amount tracked as open', money(owed)], ['Follow-ups due', String(needsFollowUp)]].map(([name, value]) =>
        <div key={name} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{name}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}
    </div>
    {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {draft && <form className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2 className="mb-5 text-xl font-bold">{draft.id ? 'Update invoice' : 'Track an invoice'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Customer *<input className={field} required maxLength={200} value={draft.customer_name} onChange={(e) => update('customer_name', e.target.value)} /></label>
        <label className={label}>Job or contract *<input className={field} required maxLength={200} value={draft.job_name} onChange={(e) => update('job_name', e.target.value)} /></label>
        <label className={label}>Invoice number *<input className={field} required maxLength={100} value={draft.invoice_number} onChange={(e) => update('invoice_number', e.target.value)} /></label>
        <label className={label}>Amount ($) *<input className={field} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className={label}>PO number<input className={field} maxLength={100} value={draft.purchase_order_number} onChange={(e) => update('purchase_order_number', e.target.value)} /></label>
        <label className={label}>Invoice due date<input className={field} type="date" value={draft.invoice_due_date || ''} onChange={(e) => update('invoice_due_date', e.target.value || null)} /></label>
        <label className={label}>Status<select className={field} value={draft.status} onChange={(e) => update('status', e.target.value as PaymentInput['status'])}>{PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
        <label className={label}>Next follow-up date<input className={field} type="date" value={draft.follow_up_date || ''} onChange={(e) => update('follow_up_date', e.target.value || null)} /></label>
      </div>
      <fieldset className="mt-5"><legend className="font-semibold">Items to check before submission</legend><p className="mb-2 text-sm text-slate-600">Check these manually against your customer's requirements.</p>
        {([['invoice_attached', 'Invoice copy ready'], ['po_confirmed', 'PO number confirmed'], ['supporting_docs_ready', 'Required supporting documents ready']] as const).map(([key, text]) =>
          <label key={key} className="mr-6 inline-flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={draft[key]} onChange={(e) => update(key, e.target.checked)} />{text}</label>)}
      </fieldset>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={label}>Next action<input className={field} maxLength={300} value={draft.next_action} onChange={(e) => update('next_action', e.target.value)} /></label>
        <label className={label}>Notes<textarea className={field} maxLength={3000} rows={3} value={draft.notes} onChange={(e) => update('notes', e.target.value)} /></label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3"><button disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save record'}</button>
        <button type="button" className="px-3 py-2 text-slate-600" onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
        {draft.id && <button type="button" disabled={busy} className="ml-auto px-3 py-2 text-slate-600 underline" onClick={() => void save(true)}>Archive record</button>}
      </div>
    </form>}
    <section className="mt-8"><h2 className="mb-4 text-xl font-bold">Invoices</h2>
      {loading ? <p>Loading…</p> : items.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-7 text-slate-600">No invoices tracked yet. Add one to record the next action and follow-up date.</p> :
        <div className="space-y-3">{items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{item.job_name} · {item.customer_name}</h3><p className="text-sm text-slate-600">Invoice {item.invoice_number}{item.purchase_order_number ? ` · PO ${item.purchase_order_number}` : ''}</p></div>
            <div className="text-right"><p className="font-bold">{money(item.amount_cents)}</p><p className="text-sm capitalize text-slate-600">{item.status}</p></div></div>
          <p className="mt-3 text-sm text-slate-600">Due: {item.invoice_due_date || 'Not set'} · Follow-up: {item.follow_up_date || 'Not set'}</p>
          <p className="mt-1 text-sm text-slate-600">Checklist: {[item.invoice_attached && 'invoice', item.po_confirmed && 'PO', item.supporting_docs_ready && 'supporting documents'].filter(Boolean).join(', ') || 'No items confirmed'}</p>
          {item.next_action && <p className="mt-2 text-sm">Next: {item.next_action}</p>}
          <button className="mt-3 text-sm font-semibold text-blue-700 hover:underline" onClick={() => edit(item)}>Edit details</button>
        </article>)}</div>}
    </section>
    <p className="mt-8 text-xs text-slate-500">Pilot access is free while this workflow is evaluated. Planned price: $9/month or $90/year. No payment method is collected here.</p>
  </main>;
}
