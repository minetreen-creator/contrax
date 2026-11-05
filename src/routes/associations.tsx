import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";

/**
 * /associations — Association Partner plan, $149/month (owner 2026-11-05: "We need
 * a checkout option for that $149/month"). For contractor associations,
 * chambers and business groups that send members bid opportunities.
 */
export const Route = createFileRoute("/associations")({
  validateSearch: (s: Record<string, unknown>) => ({ checkout: typeof s.checkout === "string" ? s.checkout : undefined }),
  component: PartnersPage,
  head: () => ({
    meta: [
      { title: "Association Partner: weekly member bid lists | Contrax" },
      { name: "description", content: "For contractor associations and business groups: a ready-to-send weekly list of open public bids for your members' region and trades, under your name. $149 a month." },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/associations" }],
  }),
});

const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none";

function PartnersPage() {
  const { checkout } = Route.useSearch();
  const [form, setForm] = useState({ organization: "", contactName: "", email: "", region: "", website: "", company_site: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/partners/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error || "Something went wrong. Please try again.");
      window.location.assign(j.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        {checkout === "success" && (
          <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
            <p className="text-lg font-bold">You're in. Thank you!</p>
            <p className="mt-1">Your first weekly bid list for your region arrives within one business day. Nathaniel will email you to confirm your region and trades.</p>
          </div>
        )}
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">For associations and business groups</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Your members' weekly bid list, done for you</h1>
        <p className="mt-4 text-lg text-slate-700">
          If your staff collects bid opportunities and emails them to members, Contrax can do it for you. Every week you get a ready-to-send list of open public bids for your region, sorted by trade, with due dates and links to the agency documents, under your association's name.
        </p>
        <ul className="mt-6 space-y-2 text-slate-700">
          <li>✓ Federal, state, city, county, school district and transit bids, from more than 30,000 open solicitations nationwide</li>
          <li>✓ Your region and your members' trades: construction, HVAC, electrical and plumbing, landscaping, janitorial, security and more</li>
          <li>✓ The same bid posted on two boards appears once</li>
          <li>✓ Forward it as is, or paste it into your own newsletter</li>
        </ul>

        <section id="start" className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-bold">Association Partner</h2>
            <p className="text-2xl font-bold">$149<span className="text-base font-medium text-slate-500">/month</span></p>
          </div>
          <p className="mt-1 text-sm text-slate-600">Billed monthly. Cancel anytime.</p>
          {checkout === "canceled" && <p className="mt-3 text-sm text-slate-600">Checkout was canceled. Nothing was charged.</p>}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input type="text" name="company_site" value={form.company_site} onChange={set("company_site")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            <label className="block text-sm font-medium">
              Organization
              <input required className={field} value={form.organization} onChange={set("organization")} maxLength={160} placeholder="e.g. Central Texas Minority Contractors" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Your name
                <input required className={field} value={form.contactName} onChange={set("contactName")} maxLength={120} />
              </label>
              <label className="block text-sm font-medium">
                Email
                <input required type="email" className={field} value={form.email} onChange={set("email")} maxLength={200} />
              </label>
            </div>
            <label className="block text-sm font-medium">
              Region your members work in
              <input required className={field} value={form.region} onChange={set("region")} maxLength={200} placeholder="e.g. Central Texas, or Maryland, DC and Virginia" />
            </label>
            <label className="block text-sm font-medium">
              Website <span className="font-normal text-slate-500">(optional)</span>
              <input className={field} value={form.website} onChange={set("website")} maxLength={200} />
            </label>
            {error && <p className="text-sm font-medium text-red-700">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {busy ? "Opening secure checkout…" : "Start for $149/month"}
            </button>
            <p className="text-center text-xs text-slate-500">Secure checkout by Stripe. Questions first? Email hello@contrax.company.</p>
          </form>
        </section>
      </main>
    </div>
  );
}
