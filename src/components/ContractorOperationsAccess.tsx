import { useEffect, useState, type ReactNode } from "react";

type State = { subscribed: boolean; status?: string | null; checkoutEnabled?: boolean; interval?: "month" | "year" | null };

export function ContractorOperationsAccess({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/contractor-operations/subscription")
      .then((r) => { if (!r.ok) throw new Error("Could not verify subscription"); return r.json(); })
      .then(setState).catch(() => setError("Could not verify subscription. Please reload."));
  }, []);

  async function redirect(path: "checkout" | "portal", interval?: "month" | "year") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/contractor-operations/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(interval ? { interval } : {}),
      });
      const body = await response.json();
      if (!response.ok || !body.url) throw new Error(body.error || "Billing unavailable");
      window.location.href = body.url;
    } catch (e) { setError(e instanceof Error ? e.message : "Billing unavailable"); setBusy(false); }
  }

  if (error && !state) return <div className="min-h-screen bg-slate-50 p-8 text-red-800" role="alert">{error}</div>;
  if (!state) return <div className="min-h-screen bg-slate-50 p-8 text-slate-900">Checking subscription…</div>;
  if (!state.subscribed) return <div className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
    <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <a className="text-sm text-blue-700 underline" href="/">← Home</a>
      <p className="mt-6 text-sm font-bold uppercase text-blue-700">Contrax Payments</p>
      <h1 className="mt-2 text-3xl font-bold">Payment follow-up and labor review</h1>
      <p className="mt-3 text-slate-600">Track invoices, follow-ups, and labor hours by job. Contrax Payments is a separate subscription from Radar and Bid Scout. It does not collect customer payments or process payroll.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button disabled={busy || !state.checkoutEnabled} onClick={() => redirect("checkout", "month")} className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50">$9/month</button>
        <button disabled={busy || !state.checkoutEnabled} onClick={() => redirect("checkout", "year")} className="rounded-lg border border-blue-700 bg-white px-5 py-3 font-semibold text-blue-800 disabled:opacity-50">$90/year</button>
      </div>
      {!state.checkoutEnabled && <p className="mt-4 text-sm text-slate-600">Checkout is temporarily unavailable. Please check back shortly.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
    </section>
  </div>;
  return <>
    <div className="bg-slate-50 px-4 pt-4 text-right">
      <button disabled={busy} onClick={() => redirect("portal")} className="text-sm font-semibold text-blue-700 underline disabled:opacity-50">Manage Contrax Payments billing</button>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </div>
    {children}
  </>;
}
