import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

type Forecast = {
  id: string; title: string; description: string; fiscalYear: number; fiscalQuarter: string;
  agency: string; naics: string; city: string; state: string; country: string;
  valueRange: string; setAside: string; strategy: string; dateFlags: string[];
};
type Payload = { forecasts: Forecast[]; total: number; snapshotDate: string };
export const Route = createFileRoute("/forecasts")({
  head: () => ({ meta: [{ title: "Upcoming Procurement Forecasts | Contrax" }] }),
  component: Forecasts,
});
function Forecasts() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [year, setYear] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/forecasts", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Procurement forecasts are temporarily unavailable.");
      return response.json() as Promise<Payload>;
    }).then(setData).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  const rows = data?.forecasts ?? [];
  const matches = useMemo(() => rows.filter(row => {
    const text = [row.title, row.description, row.naics, row.agency].join(" ").toLowerCase();
    return (!query.trim() || text.includes(query.trim().toLowerCase())) &&
      (!state || row.state === state) && (!year || String(row.fiscalYear) === year);
  }), [rows, query, state, year]);
  const pages = Math.max(1, Math.ceil(matches.length / 20));
  const currentPage = Math.min(page, pages);
  const change = (fn: () => void) => { fn(); setPage(1); };
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <div className="mx-auto max-w-5xl px-4 py-10">
      <a href="/radar" className="font-semibold text-blue-700">← Contract Radar</a>
      <h1 className="mt-6 text-3xl font-bold">Upcoming procurement forecasts</h1>
      <p className="mt-3 max-w-3xl text-slate-600">Explore planned Commerce and Homeland Security purchases. Forecasts may change and are not open solicitations. Estimated quarters are not bid deadlines.</p>
      <p className="mt-3 text-sm text-slate-600">Source snapshot: September 30, 2026. Includes fiscal years 2027–2029; fiscal year 2027 begins October 1, 2026.</p>
      <a href="https://www.commerce.gov/oam/industry/procurement-forecasts" target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700">View Commerce's current forecast report →</a>
      <div className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <label className="text-sm font-semibold">Keyword or NAICS
          <input className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" value={query} onChange={e => change(() => setQuery(e.target.value))} placeholder="Search titles, scope or NAICS" />
        </label>
        <label className="text-sm font-semibold">Place of performance
          <select className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" value={state} onChange={e => change(() => setState(e.target.value))}>
            <option value="">All stated locations</option>
            {[...new Set(rows.map(r => r.state).filter(Boolean))].sort().map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Fiscal year
          <select className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" value={year} onChange={e => change(() => setYear(e.target.value))}>
            <option value="">All forecast years</option>
            {[...new Set(rows.map(r => r.fiscalYear))].sort().map(y => <option key={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <div aria-live="polite" className="mt-5">
        {error ? <p role="alert" className="rounded-lg bg-amber-50 p-4 text-amber-900">{error}</p> :
          !data ? <p>Loading forecasts…</p> : <p>{matches.length} matching forecasts of {data.total} stored records</p>}
      </div>
      {data && !matches.length ? <p className="mt-4">No forecasts match these filters.</p> : null}
      <div className="mt-5 grid gap-5">
        {matches.slice((currentPage - 1) * 20, currentPage * 20).map(row => <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-6">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">Forecast · not open for bidding</span>
          <h2 className="mt-3 text-xl font-bold">{row.title}</h2>
          <p className="mt-2 text-sm text-slate-600">{row.agency} · Forecast ID {row.id}</p>
          <p className="mt-3 text-sm font-semibold">Estimated solicitation: FY{row.fiscalYear}, {row.fiscalQuarter} quarter</p>
          <p className="mt-2 text-sm">Place of performance: {[row.city, row.state, row.country].filter(Boolean).join(", ") || "Not stated"}</p>
          <p className="mt-2 text-sm">NAICS: {row.naics || "Not stated"}</p>
          <p className="mt-2 text-sm">Estimated value range: {row.valueRange || "Not stated"}</p>
          <p className="mt-2 text-sm">Anticipated set-aside / awardee: {row.setAside || "Not stated"}</p>
          {row.strategy ? <p className="mt-2 text-sm">Competition strategy: {row.strategy}</p> : null}
          <details className="mt-4"><summary className="cursor-pointer font-semibold text-blue-700">Read planned scope</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{row.description}</p></details>
          {row.dateFlags.length ? <p className="mt-3 text-xs text-amber-800">The source contains a creation or modification date after the snapshot date. Verify this entry with the issuing agency.</p> : null}
        </article>)}
      </div>
      {data && matches.length > 20 ? <nav aria-label="Forecast pages" className="mt-6 flex items-center gap-4">
        <button className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage} of {pages}</span>
        <button className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
      </nav> : null}
    </div>
  </main>;
}
