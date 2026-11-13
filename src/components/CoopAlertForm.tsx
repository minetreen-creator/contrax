import { useState } from "react";
import { SEO_TRADES } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * "Tell me when my trade opens" on /co-op-contracts (owner 2026-11-13). Saves an alert; one email is sent
 * only when a new co-op category for the trade opens (never a daily email).
 */
export function CoopAlertForm({ trade, emphasis = false }: { trade: string; emphasis?: boolean }) {
  const [pick, setPick] = useState(trade);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pick) return setError("Pick your trade.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    setStatus("busy");
    setError("");
    try {
      const r = await fetch("/api/coop-alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), trade: pick }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "Please try again.");
      setStatus("done");
      trackEvent("coop_alert_saved", pick);
    } catch (err) {
      setStatus("error");
      setError((err as Error).message || "Please try again.");
    }
  }

  const label = SEO_TRADES.find((t) => t.slug === pick)?.label ?? "your trade";
  if (status === "done") {
    return (
      <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        ✓ You're set. We'll email you once when a {label.toLowerCase()} co-op category opens for vendors, and not before.
      </div>
    );
  }
  return (
    <form onSubmit={submit} className={`mt-4 rounded-xl border p-4 text-sm ${emphasis ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="font-bold text-slate-900">🔔 Tell me when my trade opens</p>
      <p className="mt-1 text-slate-700">Co-op categories open every few years. Leave your email and we'll send one email when yours opens at Sourcewell, BuyBoard or Choice Partners. Nothing else.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2" aria-label="Your trade">
          <option value="">Your trade</option>
          {SEO_TRADES.map((t) => (
            <option key={t.slug} value={t.slug}>{t.label}</option>
          ))}
        </select>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2" aria-label="Email" />
        <button type="submit" disabled={status === "busy"} className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
          {status === "busy" ? "Saving…" : "Notify me"}
        </button>
      </div>
      {error ? <p className="mt-2 text-red-700">{error}</p> : null}
      <p className="mt-2 text-xs text-slate-500">One-click unsubscribe in every email.</p>
    </form>
  );
}
