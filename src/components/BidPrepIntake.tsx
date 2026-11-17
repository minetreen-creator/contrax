import { useState, type FormEvent } from "react";
import { BID_PREP_DELIVERY, INTAKE_FIELDS } from "~/lib/bid-prep";
import { trackEvent } from "~/lib/track";

const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

/**
 * The company details for a paid Bid Prep order, asked for the moment the buyer returns from
 * Stripe (owner 2026-11-17), so the work can start without an email back-and-forth.
 */
export function BidPrepIntake({ session }: { session: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bid-prep/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(e.currentTarget)), session }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) { setDone(true); trackEvent("bid_prep_intake_sent", "ok"); return; }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <p role="status" className="mt-8 rounded-2xl bg-emerald-50 p-5 text-sm font-semibold text-emerald-900">
        Got it. We have everything we need to start. Your bid package will arrive by email within {BID_PREP_DELIVERY}.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="mt-8 rounded-2xl border-2 border-emerald-500 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-900">One last step: tell us about your company</h2>
      <p className="mt-1 text-sm text-slate-700">
        We use this to fill in the forms. It takes about five minutes, and the {BID_PREP_DELIVERY} start when you send it.
        We never ask for tax ID, bank or card numbers here; those fields are left for you.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {INTAKE_FIELDS.map((f) => (
          <label key={f.name} className={`text-sm font-semibold text-slate-800 ${f.long || f.name === "address" || f.name === "signer" ? "sm:col-span-2" : ""}`}>
            {f.label}
            {f.long ? (
              <textarea name={f.name} required={f.required} maxLength={f.max} rows={f.name === "pastJobs" ? 5 : 3} className={field} />
            ) : (
              <input name={f.name} required={f.required} maxLength={f.max} className={field} />
            )}
            {f.hint ? <span className="mt-1 block text-xs font-normal text-slate-500">{f.hint}</span> : null}
          </label>
        ))}
      </div>
      <button type="submit" disabled={busy} className="mt-4 w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto">
        {busy ? "Sending…" : "Send my company details"}
      </button>
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
    </form>
  );
}
