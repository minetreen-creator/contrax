import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { trackEvent } from "~/lib/track";

/**
 * /sub-list — the $49 local-subcontractor list (owner 2026-10-30: "find me the
 * revenue" → "2,3"). For companies that won work far from home: tell us the
 * trade and city, pay once, get a list of local companies by email. The first
 * list is free (prime outreach and the homepage "Subcontracting leads").
 */
const TITLE = "Find Local Subcontractors | Contrax";
const DESC =
  "Won a contract far from home? Tell us the trade and the city and we'll email you a list of local companies near the job site. $49 per list, one time.";

export const Route = createFileRoute("/sub-list")({
  component: () => (
    <>
      <SiteHeader />
      <SubListPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/sub-list" }],
  }),
});

function SubListPage() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const paid = params?.get("paid") === "1";
  const [trade, setTrade] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const buy = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    trackEvent("sub_list_checkout_start", `${trade} | ${city}`.slice(0, 120));
    try {
      const res = await fetch("/api/sub-list/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade, city }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error || "Checkout is unavailable right now.");
      window.location.assign(j.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout is unavailable right now.");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {paid && (
        <p className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          Paid. Your list arrives by email within one business day. Thank you!
        </p>
      )}
      <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">For contract winners</p>
      <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Find local subcontractors near your job site</h1>
      <p className="mt-3 text-slate-700">
        Won a contract hundreds of miles from home? Tell us the trade and the city. We'll email you a list of local companies near the site:
        names, websites, phone numbers and addresses, ready to call.
      </p>
      <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
        <li>✓ Janitorial, landscaping, security, pest control, HVAC, roofing, painting, facilities and more</li>
        <li>✓ Delivered by email within one business day</li>
        <li>✓ From public business listings. Check each company's license and insurance yourself.</li>
      </ul>

      <form onSubmit={buy} className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold text-slate-800" htmlFor="sl-trade">Trade</label>
        <input id="sl-trade" required maxLength={80} value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Janitorial"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        <label className="mt-3 block text-sm font-semibold text-slate-800" htmlFor="sl-city">City and state of the job site</label>
        <input id="sl-city" required maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Galveston, TX"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        <button type="submit" disabled={busy}
          className="mt-4 w-full rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
          {busy ? "Opening checkout…" : "Get my list: $49, one time"}
        </button>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <p className="mt-3 text-xs text-slate-500">
          First time? Your first list is free:{" "}
          <a className="underline" href={`mailto:contrax.companyllc@gmail.com?subject=${encodeURIComponent("Free local subcontractor list")}`}>
            email us the trade and city
          </a>
          .
        </p>
      </form>
    </main>
  );
}
