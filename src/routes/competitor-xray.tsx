import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { cleanXrayQuery, summarizeXray, xrayLikePattern, type XrayContract, type XraySummary } from "~/lib/competitor-xray";
import { seoHead } from "~/lib/seo-landing";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";

// /competitor-xray — "Who is winning in [State]?" (owner 2026-11-08). Counts and totals for anyone;
// the itemized contract list with agencies, amounts and end dates for paid members.
type XrayResult = { summary: XraySummary; contracts: XrayContract[] | null; paid: boolean } | { error: string };

const lookupCompetitor = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const q = cleanXrayQuery((d as any)?.q);
    const st = String((d as any)?.state ?? "").toUpperCase();
    return { q, state: /^[A-Z]{2}$/.test(st) ? st : "" };
  })
  .handler(async ({ data }): Promise<XrayResult> => {
    if (!data.q) return { error: "Type at least 3 letters of the company name." };
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { checkIpLimit } = await import("~/lib/rate-limit");
      const limit = await checkIpLimit(getRequest(), "competitor-xray", 30, 3600);
      if (!limit.allowed) return { error: "That's a lot of lookups. Try again in a little while." };
      const { sql } = await import("~/db");
      const pattern = xrayLikePattern(data.q);
      const rows = (data.state
        ? await sql()`SELECT award_key, recipient_name, amount, start_date, end_date, agency, sub_agency, description, pop_state
            FROM recompete_contracts WHERE recipient_name ILIKE ${pattern} AND pop_state = ${data.state} AND end_date >= CURRENT_DATE
            ORDER BY end_date ASC LIMIT 500`
        : await sql()`SELECT award_key, recipient_name, amount, start_date, end_date, agency, sub_agency, description, pop_state
            FROM recompete_contracts WHERE recipient_name ILIKE ${pattern} AND end_date >= CURRENT_DATE
            ORDER BY end_date ASC LIMIT 500`) as any[];
      const { summary, contracts } = summarizeXray(data.q, rows);
      const { getCurrentUser } = await import("~/lib/auth");
      const { hasPaidBidAccess } = await import("~/lib/head-start.server");
      const paid = await hasPaidBidAccess(await getCurrentUser());
      // Free viewers get the counts and totals only; the itemized list never leaves the server for them.
      return { summary, contracts: paid ? contracts.slice(0, 100) : null, paid };
    } catch (e) {
      console.error("[competitor-xray] lookup failed:", e);
      return { error: "The lookup isn't available right now. Try again in a minute." };
    }
  });

export const Route = createFileRoute("/competitor-xray")({
  head: () =>
    seoHead({
      title: "Who Is Winning Government Contracts in Your State? Competitor Lookup | Contrax",
      description:
        "Type a competitor's name to see how many active federal contracts they hold, what they are worth and how many end in the next 12 months.",
      canonical: "https://www.contrax.company/competitor-xray",
    }),
  component: CompetitorXray,
});

const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n).toLocaleString("en-US")}`;
const day = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Not stated";

function CompetitorXray() {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<XrayResult | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    trackEvent("xray_search", state || "all");
    try {
      setResult(await lookupCompetitor({ data: { q, state } }));
    } catch {
      setResult({ error: "The lookup isn't available right now. Try again in a minute." });
    } finally {
      setBusy(false);
    }
  };
  const stateName = state ? STATE_NAMES[state] ?? state : "";
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Competitor X-Ray</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Who's winning government work near you?</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Type a competitor's company name to see how many active federal contracts they hold, what they're worth, and how many end in the next 12 months.
        </p>
        <form onSubmit={run} className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_12rem_auto]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company name, e.g. Acme Facility Services"
            aria-label="Competitor company name"
            className="rounded-lg border border-slate-300 px-3 py-2.5"
          />
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State" className="rounded-lg border border-slate-300 px-3 py-2.5">
            <option value="">Any state</option>
            {Object.entries(STATE_NAMES)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
          </select>
          <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-5 py-2.5 font-bold text-white hover:bg-slate-700 disabled:opacity-60">
            {busy ? "Looking…" : "X-Ray"}
          </button>
        </form>

        {result && "error" in result ? <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-amber-900">{result.error}</p> : null}

        {result && "summary" in result ? (
          <section className="mt-6" aria-live="polite">
            {result.summary.contracts === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <p className="font-semibold">No active federal contracts found for "{result.summary.query}"{stateName ? ` in ${stateName}` : ""}.</p>
                <p className="mt-2 text-sm text-slate-600">
                  Try a shorter part of the name (e.g. "Acme" instead of "Acme Facility Services LLC"). Many local competitors only win city, county and school work, which isn't in this federal data.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="Active federal contracts" value={result.summary.contracts.toLocaleString("en-US")} />
                  <Stat label="Total value" value={money(result.summary.totalValue)} />
                  <Stat label="End in the next 12 months" value={result.summary.expiringSoon.toLocaleString("en-US")} accent />
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  Matched: {result.summary.names.join(" · ")}
                  {result.summary.states.length ? ` · Work in ${result.summary.states.join(", ")}` : ""}
                </p>

                {result.paid && result.contracts ? (
                  <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {result.contracts.map((c, i) => (
                      <div key={i} className="border-b border-slate-100 p-4 last:border-0">
                        <div className="flex justify-between gap-3">
                          <b className="text-sm">{c.agency}</b>
                          <b className="shrink-0 text-sm">{money(c.amount)}</b>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {day(c.start)} to <span className="font-semibold text-amber-700">{day(c.end)}</span>
                          {c.state ? ` · ${c.state}` : ""}
                        </p>
                        {c.description ? <p className="mt-1 text-sm text-slate-600">{c.description}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="relative mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="select-none p-4 blur-[5px]" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="border-b border-slate-100 py-3 last:border-0">
                          <div className="flex justify-between"><b className="text-sm">Department of Xxxxxxxx Xxxxxxx</b><b className="text-sm">$000K</b></div>
                          <p className="mt-1 text-xs">Jan 0, 2025 to Mar 00, 2027 · XX</p>
                        </div>
                      ))}
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 p-4 text-center">
                      <p className="font-bold">See every contract: agency, amount and end date</p>
                      <p className="mt-1 text-sm text-slate-600">Know which ones come up for re-bid, and when.</p>
                      <a
                        href="/upgrade?plan=starter&source=competitor-xray"
                        onClick={() => trackEvent("xray_unlock_click", state || "all")}
                        className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400"
                      >
                        Unlock the contract list · ${STARTER_FIRST_MONTH_PRICE} for 30 days
                      </a>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        ) : null}

        <p className="mt-8 text-xs text-slate-500">
          Source: active federal contracts from USAspending.gov, kept by Contrax for the trades it tracks. City, county, school and most state awards aren't included.
          Names are matched as typed, so similar company names can appear together; check the matched names above.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${accent ? "text-amber-600" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
