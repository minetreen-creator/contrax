import type { FPDSIntel } from "~/lib/fpds";

export function IncumbentCard({ intel, winner }: { intel: FPDSIntel; winner?: string }) {
  const max = Math.max(...intel.historical_pricing.map((x) => x.total_obligated), 1);
  const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;
  return <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-4" aria-label="Incumbent Intelligence">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-indigo-900">🏛️ Incumbent Intelligence</h3>{winner && winner !== "Open opportunity" && winner.toLowerCase() !== intel.incumbent_name.toLowerCase() && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Re-compete</span>}</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-slate-500">Incumbent</p><p className="font-semibold text-slate-900">{intel.incumbent_name}</p>{intel.incumbent_uei && <p className="text-xs text-slate-500">UEI: {intel.incumbent_uei}</p>}</div><div><p className="text-xs uppercase tracking-wide text-slate-500">Total obligated</p><p className="font-semibold text-slate-900">{money(intel.total_obligated)}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Period of performance</p><p className="text-sm text-slate-700">{intel.pop_start_date || "—"} → {intel.pop_end_date || "—"}</p></div></div>
    {intel.historical_pricing.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">5-year historical pricing</p><div className="flex h-24 items-end gap-2 border-b border-indigo-100 px-1">{intel.historical_pricing.map((x) => <div key={x.fiscal_year} className="flex h-full flex-1 flex-col items-center justify-end gap-1"><span className="text-[10px] text-slate-500">{money(x.total_obligated)}</span><div className="w-full max-w-12 rounded-t bg-indigo-400" style={{ height: `${Math.max(5, x.total_obligated / max * 65)}px` }} title={`${x.award_count} awards`} /><span className="text-[10px] text-slate-600">FY{x.fiscal_year}</span></div>)}</div></div>}
    <p className="mt-3 text-[11px] text-slate-400">Powered by FPDS / USASpending.gov</p>
  </section>;
}
