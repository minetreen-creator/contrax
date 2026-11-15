import { useEffect, useState, type FormEvent } from "react";
import { PARTNER_MAX_CLIENTS, PARTNER_SLA, PARTNER_VOLUME_AT, partnerMonthlyCents, partnerUnitCents } from "~/lib/reseller";
import { trackEvent } from "~/lib/track";

const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

/** Reseller checkout: firm, email and number of clients, then a Stripe subscription billed per client (src/lib/reseller.ts). */
export function ResellerOrder() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clients, setClients] = useState(5);
  const [outcome, setOutcome] = useState<"" | "started" | "cancelled">("");
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("reseller");
    if (r === "started" || r === "cancelled") setOutcome(r);
  }, []);
  const n = Math.min(Math.max(Math.floor(clients) || 1, 1), PARTNER_MAX_CLIENTS);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    trackEvent("reseller_click", "checkout");
    try {
      const res = await fetch("/api/resellers/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(e.currentTarget)), clients: n }),
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
        You are signed up. We will email you to ask for each client's state and line of work, and each report follows within {PARTNER_SLA} of your reply.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-3">
      <label className="text-sm font-semibold text-slate-800">
        Work email
        <input name="email" type="email" required autoComplete="email" maxLength={254} className={field} />
      </label>
      <label className="text-sm font-semibold text-slate-800">
        Your firm
        <input name="firm" required autoComplete="organization" maxLength={150} className={field} />
      </label>
      <label className="text-sm font-semibold text-slate-800">
        Clients to start with
        <input name="clients" type="number" min={1} max={PARTNER_MAX_CLIENTS} required value={clients} onChange={(e) => setClients(Number(e.target.value))} className={field} />
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <div className="sm:col-span-3">
        <p className="text-sm text-slate-700">
          {n} {n === 1 ? "client" : "clients"} at {dollars(partnerUnitCents(n))} each: <strong>{dollars(partnerMonthlyCents(n))} a month</strong>.
          {n < PARTNER_VOLUME_AT && ` At ${PARTNER_VOLUME_AT} clients the price drops to ${dollars(partnerUnitCents(PARTNER_VOLUME_AT))} each.`}
        </p>
        <button type="submit" disabled={busy} className="mt-3 rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60">
          {busy ? "Opening checkout…" : "Start with secure checkout →"}
        </button>
        {outcome === "cancelled" && !error && <p className="mt-2 text-sm text-slate-600">Checkout was cancelled. Nothing was charged.</p>}
        {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
      </div>
    </form>
  );
}
