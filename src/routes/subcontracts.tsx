import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { openSubcontracts } from "~/lib/subcontract-opportunities";
import { trackEvent } from "~/lib/track";

function easternDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function SubcontractsPage() {
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const available = openSubcontracts(easternDate());
  const trades = [...new Set(available.flatMap((item) => item.trades))].sort();
  const states = [...new Set(available.map((item) => item.state))].sort();
  const shown = available.filter((item) => (!trade || item.trades.includes(trade)) && (!state || item.state === state));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-5 py-9">
        <nav className="flex items-center justify-between gap-4 text-sm">
          <a href="/radar" className="font-semibold text-blue-700 hover:underline">← Contract Radar</a>
          <a href="/" className="font-semibold text-slate-600 hover:underline">Contrax</a>
        </nav>
        <div className="mt-9 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Prime contractor opportunities</p>
          <h1 className="mt-2 text-3xl font-bold">Subcontracting opportunities</h1>
          <p className="mt-3 text-slate-600">Verified notices where a named prime is seeking bids or quotes from other businesses. You would respond to the prime contractor, not bid to the government agency.</p>
          <p className="mt-3 text-sm text-slate-500">Pilot selection · Source pages checked September 25, 2026 · Confirm availability and requirements on the original notice before responding.</p>
        </div>
        <div className="mt-8 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <label className="flex min-w-44 flex-1 flex-col gap-1 text-sm font-medium" htmlFor="subcontract-trade">Trade
            <select id="subcontract-trade" value={trade} onChange={(event) => setTrade(event.target.value)} className="rounded-lg border border-slate-300 p-2.5 font-normal">
              <option value="">All listed trades</option>
              {trades.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex min-w-44 flex-1 flex-col gap-1 text-sm font-medium" htmlFor="subcontract-state">State
            <select id="subcontract-state" value={state} onChange={(event) => setState(event.target.value)} className="rounded-lg border border-slate-300 p-2.5 font-normal">
              <option value="">All listed states</option>
              {states.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-5 text-sm text-slate-600">{shown.length} verified {shown.length === 1 ? "notice" : "notices"} in this pilot</p>
        <div className="mt-4 grid gap-4">
          {shown.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No currently listed notices match these filters. <a href="https://legacy.sba.gov/federal-contracting/contracting-guide/prime-subcontracting/subcontracting-opportunities" target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Browse SBA SUBNet directly</a>.</div>}
          {shown.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">Subcontract · {item.state}</span><h2 className="mt-3 text-xl font-bold">{item.title}</h2></div><p className="text-sm font-semibold text-slate-700">Due {new Date(`${item.dueDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p></div>
              <p className="mt-3 text-sm"><span className="font-semibold">Prime:</span> {item.prime}</p>
              <p className="mt-2 text-sm text-slate-600">{item.scope}</p>
              <p className="mt-3 text-xs text-slate-500">Listed scopes: {item.trades.join(" · ")}. Trade labels reflect the notice; they are not an eligibility or fit determination.</p>
              {item.requirement && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>Check before bidding:</strong> {item.requirement}</p>}
              <div className="mt-5 flex flex-wrap gap-3">
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent("subcontract_source_open", item.id, "/subcontracts")} className="inline-flex rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">View original SBA notice →</a>
                <a href={`mailto:${item.contactEmail}`} onClick={() => trackEvent("subcontract_contact_click", item.id, "/subcontracts")} className="inline-flex rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">Email prime contact</a>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-8 text-xs text-slate-500">Listings may change or close early. This pilot is a selected set of independently checked SUBNet notices, not comprehensive nationwide coverage. Link clicks indicate interest, not that the prime received a response. Contrax does not submit bids on your behalf.</p>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/subcontracts")({
  component: SubcontractsPage,
  head: () => ({ meta: [{ title: "Subcontracting opportunities | Contrax" }, { name: "description", content: "Browse verified prime contractor subcontracting notices and check requirements at the original source." }] }),
});
