import { useEffect, useState, type FormEvent } from "react";
import { MANAGED_FIRST_REPORT } from "~/lib/contrax-managed";
import { trackEvent } from "~/lib/track";

const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

/** Contrax Managed checkout: four fields, then a Stripe subscription (src/lib/contrax-managed.ts). */
export function ManagedOrder({ price }: { price: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"" | "started" | "cancelled">("");
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("managed");
    if (r === "started" || r === "cancelled") setOutcome(r);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    trackEvent("teams_cta_click", "managed_checkout");
    try {
      const res = await fetch("/api/managed/checkout", {
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

  if (outcome === "started") {
    return (
      <p role="status" className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
        You are signed up. Your first report will arrive by email within {MANAGED_FIRST_REPORT}, and we will set up your team's Professional login.
      </p>
    );
  }
  return (
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
        States you work in
        <input name="states" required maxLength={200} placeholder="Virginia, Maryland, DC" className={field} />
      </label>
      <label className="text-sm font-semibold text-slate-800">
        What you sell
        <input name="trade" required maxLength={150} placeholder="IT services, janitorial, paving…" className={field} />
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60">
          {busy ? "Opening checkout…" : `Start Contrax Managed: ${price} a month →`}
        </button>
        {outcome === "cancelled" && !error && <p className="mt-2 text-sm text-slate-600">Checkout was cancelled. Nothing was charged.</p>}
        {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
      </div>
    </form>
  );
}
