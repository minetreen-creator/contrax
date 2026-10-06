import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { usaspendingUrl, type AwardLead } from "~/lib/award-leads";

/**
 * /leads — Award Leads (owner 2026-10-06, revenue idea #6): new federal contract
 * winners for companies that sell TO contractors. Every row is a public
 * USAspending.gov record with a link to verify it; nothing here is invented, and an
 * empty table says so instead of showing examples.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "New Government Contract Winners | Award Leads | Contrax";
const DESC =
  "Every weekday, the businesses that just won federal contracts: winner, amount, agency, work state and NAICS. Built for surety bond, financing, equipment, staffing and insurance sales teams.";

const getLeadsPage = createServerFn({ method: "GET" }).handler(async () => {
  let summary: { sample: AwardLead[]; last30: number; total30: number } | null = null;
  let hasAccess = false;
  let signedIn = false;
  try {
    const { awardLeadsSummary } = await import("~/lib/award-leads.server");
    summary = await awardLeadsSummary();
  } catch {
    summary = null;
  }
  try {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (user) {
      signedIn = true;
      const { dataPlanForUser } = await import("~/lib/data-feed.server");
      const { tierHasAwardLeads } = await import("~/lib/data-feed-billing.server");
      const plan = user.is_admin ? { tier: null } : await dataPlanForUser(user.id);
      hasAccess = !!plan && tierHasAwardLeads(plan.tier);
    }
  } catch {
    /* page still renders for visitors */
  }
  return { summary, hasAccess, signedIn };
});

export const Route = createFileRoute("/leads")({
  loader: () => getLeadsPage(),
  component: () => (
    <>
      <SiteHeader />
      <LeadsPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/leads` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/leads` }],
  }),
});

const money = (n: number) =>
  n >= 1_000_000_000
    ? `$${(n / 1_000_000_000).toFixed(1)}B`
    : n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : `$${Math.round(n).toLocaleString("en-US")}`;

const WHO: [string, string][] = [
  ["Surety bond agents", "A new federal contract usually needs performance and payment bonds."],
  ["Factoring and financing", "Winners need working capital before the first government payment arrives."],
  ["Equipment rental and suppliers", "Construction and service awards start buying within weeks."],
  ["Staffing agencies", "New contracts mean new crews to hire."],
  ["Insurance brokers", "Contracts carry insurance requirements the winner must meet now."],
];

function LeadsPage() {
  const { summary, hasAccess, signedIn } = Route.useLoaderData();
  return (
    <main className="bg-slate-50">
      <section className="mx-auto max-w-4xl px-4 pb-10 pt-12">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Award Leads</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">Know who just won a government contract</h1>
        <p className="mt-4 text-lg text-slate-700">
          Every weekday, Contrax lists the businesses that just won federal contracts: the winner, the amount, the agency, where the work is and the
          industry code. Reach them while they&rsquo;re buying bonds, financing, equipment and crews.
        </p>
        {summary && summary.last30 > 0 && (
          <p className="mt-4 text-sm font-medium text-slate-700">
            {summary.last30.toLocaleString("en-US")} new awards in the last 30 days, worth {money(summary.total30)} in total.
          </p>
        )}
        <a href="#plans" className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">
          See the plan
        </a>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-10">
        <h2 className="text-xl font-bold text-slate-900">Latest winners</h2>
        <p className="mt-1 text-sm text-slate-600">Public records from USAspending.gov. Click any amount to check it at the source.</p>
        {summary && summary.sample.length > 0 ? (
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {summary.sample.map((r) => (
              <li key={r.award_key} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold text-slate-900">{r.recipient_name}</span>
                  <a className="font-semibold text-blue-700 underline" href={usaspendingUrl(r.award_key)} target="_blank" rel="noopener noreferrer">
                    {money(r.amount)}
                  </a>
                </div>
                <p className="mt-0.5 text-slate-600">
                  {[r.sub_agency || r.agency, r.pop_state && `work in ${r.pop_state}`, r.naics_description, r.awarded_on].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            The first list is being collected. Winners appear here every weekday morning.
          </p>
        )}
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-10">
        <h2 className="text-xl font-bold text-slate-900">Who it&rsquo;s for</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {WHO.map(([t, d]) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-semibold text-slate-900">{t}</p>
              <p className="mt-1 text-slate-600">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-10">
        <h2 className="text-xl font-bold text-slate-900">What you get</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
          <li>✓ New federal contract awards of $25,000 or more, updated every weekday</li>
          <li>✓ Winner name, UEI and city, amount, award date, agency and office, work state, NAICS and description</li>
          <li>✓ Spreadsheet download filtered by state, industry and award size</li>
          <li>✓ API access for your CRM or sales tools</li>
          <li>✓ A link to the official public record on every row</li>
        </ul>
        <p className="mt-3 text-sm text-slate-600">
          Federal award records don&rsquo;t include phone numbers or emails. Each row has the winner&rsquo;s name, city and UEI so your team can look
          them up.
        </p>
      </section>

      {hasAccess ? <Download /> : <Plan signedIn={signedIn} />}
    </main>
  );
}

function Plan({ signedIn }: { signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("checkout") : null;
  const buy = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/data-feed/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "leads" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 && j.needsAccount) {
        window.location.assign(`/signup?plan=basic&next=${encodeURIComponent("/leads#plans")}`);
        return;
      }
      if (!res.ok || !j.url) throw new Error(j.error || "Checkout is unavailable right now.");
      window.location.assign(j.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout is unavailable right now.");
      setBusy(false);
    }
  };
  return (
    <section id="plans" className="mx-auto max-w-4xl px-4 pb-14">
      {status === "success" && (
        <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          You&rsquo;re in. Refresh this page in a minute to download your first list; your API key is on its way by email.
        </p>
      )}
      <div className="max-w-md rounded-2xl border border-amber-400 bg-white p-6 ring-1 ring-amber-400">
        <p className="text-sm font-semibold text-amber-700">Award Leads</p>
        <p className="mt-1 text-3xl font-extrabold text-slate-900">
          $249<span className="text-base font-medium text-slate-500">/month</span>
        </p>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
          <li>✓ Every state, every weekday</li>
          <li>✓ Unlimited spreadsheet downloads</li>
          <li>✓ API key included</li>
          <li>✓ Cancel anytime</li>
        </ul>
        <button
          onClick={buy}
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
        >
          {busy ? "Opening checkout…" : "Subscribe to Award Leads"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <p className="mt-3 text-xs text-slate-500">
          {signedIn ? "" : "You’ll need a free Contrax account so we can attach your plan. "}Also included with the{" "}
          <a className="underline" href="/data#plans">
            Bid Data Pro plan
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function Download() {
  const [state, setState] = useState("");
  const [naics, setNaics] = useState("");
  const [min, setMin] = useState("");
  const [days, setDays] = useState("30");
  const href = () => {
    const p = new URLSearchParams();
    if (state.trim()) p.set("state", state.replace(/\s+/g, ""));
    if (naics.trim()) p.set("naics", naics.replace(/\s+/g, ""));
    if (min.trim()) p.set("min_amount", min.replace(/[$,\s]/g, ""));
    p.set("since", new Date(Date.now() - Number(days) * 86_400_000).toISOString().slice(0, 10));
    return `/api/award-leads.csv?${p.toString()}`;
  };
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  return (
    <section id="plans" className="mx-auto max-w-4xl px-4 pb-14">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">Download your list</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">
            States
            <input value={state} onChange={(e) => setState(e.target.value)} placeholder="All, or VA, NC" className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            NAICS
            <input value={naics} onChange={(e) => setNaics(e.target.value)} placeholder="All, or 23, 5617" className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Minimum amount
            <input value={min} onChange={(e) => setMin(e.target.value)} placeholder="e.g. 250000" className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Awarded in the last
            <select value={days} onChange={(e) => setDays(e.target.value)} className={input}>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
        </div>
        <a href={href()} className="mt-5 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">
          Download spreadsheet (CSV)
        </a>
        <p className="mt-3 text-xs text-slate-500">
          Up to 1,000 rows per download. API: <code>GET /api/v1/awards</code> with your key, same filters. Manage billing from the link in your welcome
          email.
        </p>
      </div>
    </section>
  );
}
