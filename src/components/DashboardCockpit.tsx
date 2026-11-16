import { useEffect, useMemo, useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { cockpitStats, compactDollars, weekDelta, type CockpitBid } from "~/lib/dashboard-cockpit";

type Paths = { viewBox: { width: number; height: number }; paths: Record<string, string> };

/** One accent on a dark ground, dim to bright (owner 2026-11-16: the dark dashboard). */
const SHADES = ["#134e4a", "#0f766e", "#0d9488", "#14b8a6", "#2dd4bf"] as const;
const shade = (n: number, max: number) =>
  n <= 0 || max <= 0 ? "#1e293b" : SHADES[Math.min(SHADES.length - 1, Math.max(0, Math.ceil((Math.sqrt(n) / Math.sqrt(max)) * SHADES.length) - 1))];

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-5";

function Stat({ label, value, sub, tone = "flat", lead = false }: { label: string; value: string; sub: string; tone?: "up" | "down" | "flat" | "warn"; lead?: boolean }) {
  const toneClass = tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : tone === "warn" ? "text-amber-300" : "text-slate-400";
  return (
    <div className={`rounded-2xl border p-5 ${lead ? "border-teal-400/60 bg-teal-400/10" : "border-white/10 bg-white/[0.04]"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-2 text-4xl font-extrabold tracking-tight text-white tabular-nums">{value}</p>
      <p className={`mt-1 truncate text-xs font-medium ${toneClass}`} title={sub}>{sub}</p>
    </div>
  );
}

const dueDay = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "");

/**
 * Customer dashboard cockpit (owner 2026-11-06, restyled dark 2026-11-16 from a picture the owner
 * liked). The picture also showed a win rate, subcontractor quotes, a drive-time map and a match
 * score; nothing here records those, so they are not drawn. In their place: the bids closing
 * soonest, where the matches are, closings by week, and the summary already written for the next
 * deadline. Every figure comes from the matches already on the page.
 */
export function DashboardCockpit({ bids, savedCount, summaries = [] }: { bids: readonly CockpitBid[]; savedCount: number; summaries?: readonly { bid_id: number; summary_text: string }[] }) {
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
  const weekMax = Math.max(1, ...s.byWeek.map((w) => w.count));
  const next = s.top[0] ?? null;
  const nextSummary = next ? summaries.find((x) => x.bid_id === next.id)?.summary_text?.trim() || null : null;

  return (
    <section aria-labelledby="cockpit-heading" className="mb-8 rounded-3xl bg-[#0b1220] p-4 text-white shadow-lg sm:p-6">
      <h2 id="cockpit-heading" className="sr-only">Your bid overview</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat lead label="Open matches" value={s.open.toLocaleString("en-US")} sub={`${delta.text} · ${s.newThisWeek} new`} tone={delta.tone} />
        <Stat
          label="Stated value"
          value={s.statedValue.count ? compactDollars(s.statedValue.total) : "—"}
          sub={s.statedValue.count ? `across the ${s.statedValue.count.toLocaleString("en-US")} bid${s.statedValue.count === 1 ? "" : "s"} that state one` : "no open match states a value"}
        />
        <Stat
          label="Closing in 7 days"
          value={s.closing7.toLocaleString("en-US")}
          sub={s.soonest ? `Next: ${s.soonest.title}` : "nothing closing this week"}
          tone={s.closing7 > 0 ? "warn" : "flat"}
        />
        <Stat label="Saved bids" value={s.saved.toLocaleString("en-US")} sub={s.saved ? "you're tracking these" : "save a bid to track it"} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <div className={`${PANEL} lg:col-span-3`}>
          <h3 className="text-base font-bold">Closing soonest</h3>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="pb-2 font-semibold">Bid</th>
                <th className="hidden pb-2 font-semibold sm:table-cell">Agency</th>
                <th className="hidden pb-2 font-semibold md:table-cell">Trade</th>
                <th className="pb-2 text-right font-semibold">Due</th>
              </tr>
            </thead>
            <tbody>
              {s.top.map((b) => (
                <tr key={b.id} className="border-t border-white/10 align-top">
                  <td className="py-2 pr-3">
                    <a href={`/bid/${b.id}?source=dashboard_cockpit`} className="font-semibold text-white underline-offset-2 hover:text-teal-300 hover:underline">{b.title}</a>
                  </td>
                  <td className="hidden py-2 pr-3 text-slate-300 sm:table-cell">{b.agency || "Not listed"}</td>
                  <td className="hidden py-2 pr-3 text-slate-300 md:table-cell">{(b.category || "").trim() || "Other"}</td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <span className="font-semibold tabular-nums">{dueDay(b.due_date)}</span>
                    <span className={`block text-xs ${b.daysLeft <= 7 ? "font-semibold text-amber-300" : "text-slate-400"}`}>
                      {b.daysLeft === 0 ? "today" : `${b.daysLeft} day${b.daysLeft === 1 ? "" : "s"} left`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={`${PANEL} lg:col-span-2`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-bold">Where your matches are</h3>
            {focus && (
              <p className="text-sm text-slate-300">
                <b className="text-white">{STATE_NAMES[focus] ?? focus}</b> · {(s.byState[focus] ?? 0).toLocaleString("en-US")} open
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
                  stroke="#0b1220"
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
            <div className="mt-3 aspect-[959/593] w-full rounded-xl bg-white/5" />
          )}
          <p className="mt-2 text-[11px] text-slate-400">{states ? `${states} state${states === 1 ? "" : "s"} with open matches. Brighter means more.` : "No open match names a state."}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <div className={`${PANEL} lg:col-span-3`}>
          <h3 className="text-base font-bold">Deadlines by week</h3>
          <ol className="mt-4 flex h-36 items-end gap-2" aria-label="Open matches closing in each of the next six weeks">
            {s.byWeek.map((w) => (
              <li key={w.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-xs font-semibold tabular-nums text-slate-200">{w.count}</span>
                <span className="w-full rounded-t-md bg-teal-400/80" style={{ height: `${Math.max(w.count ? 6 : 2, (w.count / weekMax) * 100)}%`, opacity: w.count ? 1 : 0.25 }} />
                <span className="text-center text-[10px] leading-tight text-slate-400">{w.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className={`${PANEL} lg:col-span-2`}>
          <h3 className="text-base font-bold">Your next deadline</h3>
          {next ? (
            <>
              <p className="mt-2 text-sm font-semibold text-white">{next.title}</p>
              <p className="mt-1 text-xs text-slate-400">{[next.agency, `due ${dueDay(next.due_date)}`].filter(Boolean).join(" · ")}</p>
              {nextSummary ? (
                <p className="mt-3 max-h-40 overflow-hidden rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-snug text-slate-200 [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">{nextSummary}</p>
              ) : (
                <p className="mt-3 text-sm text-slate-300">No summary has been written for this bid yet. Open it to get the plain-English breakdown.</p>
              )}
              <a href={`/bid/${next.id}?source=dashboard_cockpit_next`} className="mt-3 inline-flex rounded-xl bg-teal-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-teal-300">Open this bid →</a>
            </>
          ) : null}
        </div>
      </div>

      <div className={`${PANEL} mt-3`}>
        <h3 className="text-base font-bold">Open matches by trade</h3>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="pb-2 font-semibold">Trade</th>
              <th className="pb-2 text-right font-semibold">Open</th>
              <th className="pb-2 text-right font-semibold">Close in 7 days</th>
              <th className="pb-2 text-right font-semibold" title="Half the bids close sooner, half later">Typical days left</th>
            </tr>
          </thead>
          <tbody>
            {s.trades.slice(0, 7).map((t) => (
              <tr key={t.trade} className="border-t border-white/10">
                <td className="py-2 font-medium text-white">{t.trade}</td>
                <td className="py-2 text-right font-semibold tabular-nums text-white">{t.count.toLocaleString("en-US")}</td>
                <td className={`py-2 text-right tabular-nums ${t.closing7 ? "font-semibold text-amber-300" : "text-slate-500"}`}>{t.closing7.toLocaleString("en-US")}</td>
                <td className="py-2 text-right tabular-nums text-slate-300">{t.medianDaysLeft ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.trades.length > 7 && <p className="mt-2 text-xs text-slate-400">+{s.trades.length - 7} more trades in your matches below.</p>}
      </div>
    </section>
  );
}
