/**
 * IncumbentCard — "🏛️ Incumbent Intelligence" panel.
 *
 * Logged-in users (any tier, incl. Starter trial) see the full FPDS/USAspending
 * incumbent data exactly as before. Logged-out users see the incumbent name,
 * UEI, and period of performance in clear text, but the "Total obligated"
 * figure and the 5-year historical pricing chart are BLURRED (CSS filter blur +
 * aria-hidden + pointer-events-none + select-none) behind a signup CTA
 * (`/signup?plan=professional&next=/awards`).
 *
 * The logged-in/logged-out branch is driven entirely by the `user` prop so SSR
 * renders the correct state from the route loader's server-resolved
 * `currentUser` (same pattern as SaveToPipeline) — no client-side auth fetch,
 * no flash of unblurred data for logged-out visitors.
 */
import type { FPDSIntel } from "~/lib/fpds";
import type { AuthUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";

const GATE_CTA_COPY = "Sign up for free to see this incumbent's full historical pricing";

export function IncumbentCard({
  intel,
  winner,
  user,
  bidId,
}: {
  intel: FPDSIntel;
  winner?: string;
  user?: AuthUser | null;
  bidId?: number;
}) {
  const locked = !user;
  const max = Math.max(...intel.historical_pricing.map((x) => x.total_obligated), 1);
  const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

  const bars = intel.historical_pricing.map((x) => (
    <div key={x.fiscal_year} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
      <span className="text-[10px] text-slate-500">{money(x.total_obligated)}</span>
      <div className="w-full max-w-12 rounded-t bg-indigo-400" style={{ height: `${Math.max(5, x.total_obligated / max * 65)}px` }} title={`${x.award_count} awards`} />
      <span className="text-[10px] text-slate-600">FY{x.fiscal_year}</span>
    </div>
  ));

  return <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-4" aria-label="Incumbent Intelligence">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-indigo-900">🏛️ Incumbent Intelligence</h3>{winner && winner !== "Open opportunity" && winner.toLowerCase() !== intel.incumbent_name.toLowerCase() && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Re-compete</span>}</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-slate-500">Incumbent</p><p className="font-semibold text-slate-900">{intel.incumbent_name}</p>{intel.incumbent_uei && <p className="text-xs text-slate-500">UEI: {intel.incumbent_uei}</p>}</div><div><p className="text-xs uppercase tracking-wide text-slate-500">Total obligated</p>{locked ? <p aria-hidden="true" className="pointer-events-none select-none font-semibold text-slate-900 blur-[4px]">{money(intel.total_obligated)}</p> : <p className="font-semibold text-slate-900">{money(intel.total_obligated)}</p>}</div><div><p className="text-xs uppercase tracking-wide text-slate-500">Period of performance</p><p className="text-sm text-slate-700">{intel.pop_start_date || "—"} → {intel.pop_end_date || "—"}</p></div></div>
    {intel.historical_pricing.length > 0 && (
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">5-year historical pricing</p>
        <div className="relative overflow-hidden rounded-lg border border-indigo-100">
          {locked ? (
            <>
              {/* Blurred chart — not readable, not selectable, not interactive */}
              <div aria-hidden="true" className="pointer-events-none select-none blur-[5px]">
                <div className="flex h-40 items-end gap-2 border-b border-indigo-100 px-1">{bars}</div>
              </div>
              {/* Signup CTA overlay — reachable and tappable at 390px viewport */}
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-indigo-50/70 p-3">
                <div className="w-full max-w-sm rounded-xl border border-indigo-100 bg-white p-3 text-center shadow-md">
                  <p className="text-sm font-semibold leading-snug text-slate-800">{GATE_CTA_COPY}</p>
                  <a
                    href="/signup?plan=professional&next=/awards"
                    onClick={() => trackEvent("incumbent_gate_signup", bidId != null ? String(bidId) : undefined, "/awards")}
                    className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                  >
                    Sign up free
                  </a>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-24 items-end gap-2 border-b border-indigo-100 px-1">{bars}</div>
          )}
        </div>
      </div>
    )}
    <p className="mt-3 text-[11px] text-slate-400">Powered by FPDS / USASpending.gov</p>
  </section>;
}
