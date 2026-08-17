/**
 * IncumbentCard — "🏛️ Incumbent Intelligence" panel.
 *
 * Logged-in users (any tier, incl. Starter trial) see the full FPDS/USAspending
 * incumbent data exactly as before. Logged-out users see a TEASED panel: the
 * incumbent name is masked (first character of the first word + asterisks,
 * length-preserving, derived from the real name), while the real "Total
 * obligated" figure, UEI, and period of performance stay visible. The chart
 * area is replaced by a teaser panel with an unlock CTA
 * (`/signup?plan=professional&next=/awards`).
 *
 * `freeReveal` (session-scoped "first one's free" grant from /awards) renders
 * a logged-out panel exactly like the logged-in one — full data, no wall.
 *
 * The logged-in/logged-out branch is driven entirely by the `user` prop so SSR
 * renders the correct state from the route loader's server-resolved
 * `currentUser` (same pattern as SaveToPipeline) — no client-side auth fetch,
 * no flash of unblurred data for logged-out visitors.
 */
import type { FPDSIntel } from "~/lib/fpds";
import type { AuthUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";

// Mask the first word of a real incumbent name, preserving its length:
// "General Dynamics" → "G****** Dynamics". Derived from real data only —
// never invented.
function maskIncumbentName(name: string): string {
  const firstWord = name.trim().split(/\s+/)[0] ?? "";
  if (!firstWord) return name;
  return firstWord[0] + "*".repeat(Math.max(0, firstWord.length - 1)) + name.trim().slice(firstWord.length);
}

export function IncumbentCard({
  intel,
  winner,
  user,
  bidId,
  freeReveal,
}: {
  intel: FPDSIntel;
  winner?: string;
  user?: AuthUser | null;
  bidId?: number;
  freeReveal?: boolean;
}) {
  // gated = logged-out AND not granted the session-scoped free reveal.
  // Logged-out cards that got the free reveal render exactly like logged-in.
  const gated = !user && !freeReveal;
  const max = Math.max(...intel.historical_pricing.map((x) => x.total_obligated), 1);
  const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

  const bars = intel.historical_pricing.map((x) => (
    <div key={x.fiscal_year} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
      <span className="text-[10px] text-slate-500">{money(x.total_obligated)}</span>
      <div className="w-full max-w-12 rounded-t bg-indigo-400" style={{ height: `${Math.max(5, x.total_obligated / max * 65)}px` }} title={`${x.award_count} awards`} />
      <span className="text-[10px] text-slate-600">FY{x.fiscal_year}</span>
    </div>
  ));
  // Gated tease CTA — always present when the panel is gated, never only with
  // a chart (keeps the invariant that a gated card always presents the signup CTA).
  const gateTeaser = gated ? (
    <div className="flex h-40 flex-col items-center justify-center gap-2 bg-white p-4 text-center">
      <p className="text-sm font-semibold text-slate-800">Full 5-year pricing history</p>
      <a
        href="/signup?plan=professional&next=/awards"
        onClick={() => trackEvent("incumbent_gate_signup", bidId != null ? String(bidId) : undefined, "/awards")}
        className="inline-flex w-full max-w-sm items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
      >
        Unlock full name &amp; pricing history
      </a>
      <p className="text-xs text-slate-400">Free 21-day trial · No credit card required</p>
    </div>
  ) : null;

  return <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-4" aria-label="Incumbent Intelligence">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-indigo-900">🏛️ Incumbent Intelligence</h3>{winner && winner !== "Open opportunity" && winner.toLowerCase() !== intel.incumbent_name.toLowerCase() && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Re-compete</span>}</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-slate-500">Incumbent</p><p className="font-semibold text-slate-900">{gated ? maskIncumbentName(intel.incumbent_name) : intel.incumbent_name}</p>{intel.incumbent_uei && <p className="text-xs text-slate-500">UEI: {intel.incumbent_uei}</p>}</div><div><p className="text-xs uppercase tracking-wide text-slate-500">Total obligated</p><p className="font-semibold text-slate-900">{money(intel.total_obligated)}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Period of performance</p><p className="text-sm text-slate-700">{intel.pop_start_date || "—"} → {intel.pop_end_date || "—"}</p></div></div>
    {/* Chart section renders when there is historical data to show, OR whenever the panel is
        gated — the teaser must ALWAYS present the unlock CTA, even when the incumbent has no
        5-year pricing (teaser keeps the same visual height). Logged-in / free-reveal users
        with no data keep the current behavior: no section at all. */}
    {(intel.historical_pricing.length > 0 || gated) && (
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">5-year historical pricing</p>
        <div className="relative overflow-hidden rounded-lg border border-indigo-100">
          {gated ? (
            gateTeaser
          ) : (
            <div className="flex h-24 items-end gap-2 border-b border-indigo-100 px-1">{bars}</div>
          )}
        </div>
      </div>
    )}
    <p className="mt-3 text-[11px] text-slate-400">Powered by FPDS / USASpending.gov</p>
  </section>;
}
