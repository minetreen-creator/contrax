import { useState } from "react";
import { trackEvent } from "~/lib/track";
import { STATE_NAMES } from "~/lib/contract-map";
import { SUPPLIER_AUDIENCE, SUPPLIER_FORWARD_NOTE, SUPPLIER_MULTI_STATE, SUPPLIER_PLAN_NAME, SUPPLIER_PRICE, SUPPLIER_TAILOR_NOTE, SUPPLIER_TYPES } from "~/lib/supplier-report";

/** The free supplier report request (see ~/lib/supplier-report). Used on /suppliers and at the top of the homepage. */
const STATES = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

export function SupplierRequestForm({ where }: { where: string }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [type, setType] = useState(SUPPLIER_TYPES[0].id);
  // No state is chosen for the visitor (owner's review 2026-11-18): a pre-picked South Carolina told
  // someone in Pennsylvania the report was for the Southeast only.
  const [state, setState] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  if (status === "done") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-slate-900">
        <p className="text-lg font-bold">Got it. Your {STATE_NAMES[state]} report is on its way.</p>
        <p className="mt-2 text-sm text-slate-700">Nathaniel, the founder, sends it himself to {email}, usually within one business day.</p>
      </div>
    );
  }
  const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900";
  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setStatus("sending");
        trackEvent("supplier_report_request", where);
        try {
          const res = await fetch("/api/supplier-report", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, company, type, state }),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
          setStatus("done");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
          setStatus("idle");
        }
      }}
    >
      <p className="text-lg font-bold">Send me this week's report for my state, free</p>
      <p className="mt-1 text-sm text-slate-600">{SUPPLIER_TAILOR_NOTE}</p>
      <label className="mt-4 block text-sm font-semibold">
        Work email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      </label>
      <label className="mt-3 block text-sm font-semibold">
        Company
        <input type="text" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} className={field} />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          What you sell
          <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
            {SUPPLIER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          State
          <select required value={state} onChange={(e) => setState(e.target.value)} className={field}>
            <option value="">Choose your state</option>
            {STATES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      <p aria-live="polite" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-slate-800">{SUPPLIER_TYPES.find((t) => t.id === type)?.why}</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={status === "sending"} className="mt-5 w-full rounded-xl bg-amber-500 px-6 py-3 font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
        {status === "sending" ? "Sending…" : "Send my free report →"}
      </button>
      <p className="mt-2 text-center text-xs font-semibold text-slate-600">{SUPPLIER_AUDIENCE}</p>
      <p className="mt-2 text-xs text-slate-500">One report, free. To keep getting it, the {SUPPLIER_PLAN_NAME} is {SUPPLIER_PRICE} a month, month to month, and only if you choose it.</p>
      <p className="mt-1 text-xs text-slate-500">{SUPPLIER_MULTI_STATE}</p>
      <p className="mt-1 text-xs text-slate-500">{SUPPLIER_FORWARD_NOTE}</p>
    </form>
  );
}

