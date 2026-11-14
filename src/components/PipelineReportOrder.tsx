import { useEffect, useState, type FormEvent } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { REPORT_CREDIT_NOTE, REPORT_DELIVERY, REPORT_INCLUDES, REPORT_PRICE } from "~/lib/pipeline-report";
import { trackEvent } from "~/lib/track";

const STATES = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

/** The $149 one-time pipeline report: four fields, then Stripe Checkout (src/lib/pipeline-report.ts). */
export function PipelineReportOrder() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"" | "paid" | "cancelled">("");
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("report");
    if (r === "paid" || r === "cancelled") setOutcome(r);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    trackEvent("teams_cta_click", "report_checkout");
    try {
      const res = await fetch("/api/pipeline-report/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) { window.location.href = data.url; return; }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl border-2 border-slate-900 bg-white p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Start here · a one-time snapshot</p>
      <h2 className="mt-1 text-xl font-bold text-slate-900">Pipeline Snapshot report: {REPORT_PRICE}</h2>
      <p className="mt-2 text-sm text-slate-700">
        One state, one line of work, paid once. Delivered to your inbox within {REPORT_DELIVERY} of payment.
        It shows where you stand on the day it is made and does not update; Contrax Managed below is the version that keeps going.
      </p>
      <p className="mt-3 text-sm font-semibold text-slate-900">
        Exactly what is in it (
        <a href="/sample-report" onClick={() => trackEvent("teams_cta_click", "sample_report")} className="text-blue-700 underline hover:text-blue-600">
          read a real sample
        </a>
        ):
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
        {REPORT_INCLUDES.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">{REPORT_CREDIT_NOTE}</p>
      {outcome === "paid" ? (
        <p role="status" className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
          Payment received. Your report will arrive by email within {REPORT_DELIVERY}. Orders placed on a weekend arrive Monday.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-800">
            Work email
            <input name="email" type="email" required autoComplete="email" maxLength={254} className={field} />
          </label>
          <label className="text-sm font-semibold text-slate-800">
            Company
            <input name="company" required autoComplete="organization" maxLength={150} className={field} />
          </label>
          <label className="text-sm font-semibold text-slate-800">
            State
            <select name="state" required defaultValue="" className={field}>
              <option value="" disabled>Choose a state</option>
              {STATES.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-800">
            What you sell
            <input name="trade" required maxLength={150} placeholder="IT services, janitorial, paving…" className={field} />
          </label>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60">
              {busy ? "Opening checkout…" : `Order the report: ${REPORT_PRICE} →`}
            </button>
            {outcome === "cancelled" && !error && <p className="mt-2 text-sm text-slate-600">Checkout was cancelled. Nothing was charged.</p>}
            {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
            <p className="mt-2 text-xs text-slate-600">
              One payment, no subscription. Federal contract data comes from USAspending.gov; an ending contract is not a promise of a rebid.
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
