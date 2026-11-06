import { useEffect, useMemo, useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { cockpitStats, compactDollars, weekDelta, type CockpitBid } from "~/lib/dashboard-cockpit";

type Paths = { viewBox: { width: number; height: number }; paths: Record<string, string> };

/** One accent, light to dark (owner 2026-11-06: calm, one color). */
const SHADES = ["#e8f1ff", "#bfd8ff", "#7fb2ff", "#3d8bff", "#1677ff"] as const;
const shade = (n: number, max: number) =>
  n <= 0 || max <= 0 ? "#f1f4f8" : SHADES[Math.min(SHADES.length - 1, Math.max(0, Math.ceil((Math.sqrt(n) / Math.sqrt(max)) * SHADES.length) - 1))];

function Stat({ label, value, sub, tone = "flat" }: { label: string; value: string; sub: string; tone?: "up" | "down" | "flat" | "warn" }) {
  const toneClass = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-slate-500";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-4xl font-extrabold tracking-tight text-[#0f1f38] tabular-nums">{value}</p>
      <p className={`mt-1 truncate text-xs font-medium ${toneClass}`} title={sub}>{sub}</p>
    </div>
  );
}

/**
 * Customer dashboard cockpit (owner 2026-11-06): the contractor's own matches as
 * four big numbers with context, a map of where they are, and open bids by
 * trade. Every figure comes from the matches already on the page.
 */
export function DashboardCockpit({ bids, savedCount }: { bids: readonly CockpitBid[]; savedCount: number }) {
  const s = useMemo(() => cockpitStats(bids, savedCount), [bids, savedCount]);
  const [paths, setPaths] = useState<Paths | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("~/lib/us-states-map")
      .then((m) => alive && setPaths({ viewBox: m.US_MAP_VIEWBOX, paths: m.US_STATE_PATHS }))
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (s.open === 0) return null;
  const max = Math.max(0, ...Object.values(s.byState));
  const states = Object.keys(s.byState).length;
  const delta = weekDelta(s.newThisWeek, s.newLastWeek);
  const focus = hover ?? s.topState?.code ?? null;

  return (
    <section aria-labelledby="cockpit-heading" className="mb-8">
      <h2 id="cockpit-heading" className="sr-only">Your bid overview</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open matches" value={s.open.toLocaleString("en-US")} sub={states ? `across ${states} state${states === 1 ? "" : "s"}` : "matching your profile"} />
        <Stat label="New this week" value={s.newThisWeek.toLocaleString("en-US")} sub={delta.text} tone={delta.tone} />
        <Stat
          label="Closing in 7 days"
          value={s.closing7.toLocaleString("en-US")}
          sub={s.soonest ? `Next: ${s.soonest.title}` : "nothing closing this week"}
          tone={s.closing7 > 0 ? "warn" : "flat"}
        />
        <Stat label="Saved bids" value={s.saved.toLocaleString("en-US")} sub={s.saved ? "you're tracking these" : "save a bid to track it"} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-bold text-[#0f1f38]">Where your matches are</h3>
            {focus && (
              <p className="text-sm text-slate-600">
                <b className="text-[#0f1f38]">{STATE_NAMES[focus] ?? focus}</b> · {(s.byState[focus] ?? 0).toLocaleString("en-US")} open
              </p>
            )}
          </div>
          {paths ? (
            <svg viewBox={`0 0 ${paths.viewBox.width} ${paths.viewBox.height}`} className="mt-3 h-auto w-full" role="img" aria-label="Map of your open matches by state">
              {Object.entries(paths.paths).map(([code, d]) => (
                <path
                  key={code}
                  d={d}
                  fill={shade(s.byState[code] ?? 0, max)}
                  stroke="#ffffff"
                  strokeWidth={1}
                  className={s.byState[code] ? "cursor-pointer transition-opacity hover:opacity-80" : ""}
                  onMouseEnter={() => s.byState[code] && setHover(code)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`${STATE_NAMES[code] ?? code}: ${s.byState[code] ?? 0} open`}</title>
                </path>
              ))}
            </svg>
          ) : (
            <div className="mt-3 aspect-[959/593] w-full rounded-xl bg-slate-50" />
          )}
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span>Fewer</span>
            {SHADES.map((c) => <span key={c} className="h-2 w-6 rounded-sm" style={{ background: c }} />)}
            <span>More</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="text-base font-bold text-[#0f1f38]">Open matches by trade</h3>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="pb-2 font-semibold">Trade</th>
                <th className="pb-2 text-right font-semibold">Open</th>
                <th className="pb-2 text-right font-semibold">Value</th>
                <th className="pb-2 text-right font-semibold">Days left</th>
              </tr>
            </thead>
            <tbody>
              {s.trades.slice(0, 7).map((t) => (
                <tr key={t.trade} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-[#0f1f38]">{t.trade}</td>
                  <td className="py-2 text-right tabular-nums">{t.count}</td>
                  <td className="py-2 text-right tabular-nums text-slate-600" title={t.statedValue ? `Stated value: ${t.valued} of ${t.count} bids state one` : "No bid states a value"}>
                    {t.statedValue ? compactDollars(t.statedValue) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{t.avgDaysLeft ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.trades.length > 7 && <p className="mt-2 text-xs text-slate-500">+{s.trades.length - 7} more trades in your matches below.</p>}
        </div>
      </div>
    </section>
  );
}
