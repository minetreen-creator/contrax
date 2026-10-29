import { useEffect, useMemo, useState } from "react";
import type { ContractMapAggregate } from "~/lib/contract-map";
import { STATE_NAMES } from "~/lib/contract-map";
import {
  HOME_MAP_SHADES,
  busiestState,
  categoryTrade,
  homeMapStates,
  lightUpOrder,
  shadeIndex,
} from "~/lib/home-map";
import { getNearYou, NEAR_YOU_TRADES, nearYouRadarHref } from "~/lib/near-you";
import { trackEvent } from "~/lib/track";

type Paths = { viewBox: { width: number; height: number }; paths: Record<string, string> };

/**
 * Homepage "Spin the map" (owner 2026-10-29: "Do 3"). States light up busiest
 * first; the visitor's own state starts selected. Tapping a state shows its open
 * bids, what closes this week and what it buys most, with one-tap trade chips
 * into Radar. The 42 KB of state outlines load after the page is up, so the
 * hero's first paint is unchanged; the picker below the map works without them.
 */
export function HomeStateMap({ contractMap }: { contractMap: ContractMapAggregate | null | undefined }) {
  const states = useMemo(() => homeMapStates(contractMap), [contractMap]);
  const counts = useMemo(() => Object.fromEntries(Object.values(states).map((s) => [s.code, s.count])), [states]);
  const order = useMemo(() => lightUpOrder(counts), [counts]);
  const max = useMemo(() => Math.max(0, ...Object.values(counts)), [counts]);
  const [paths, setPaths] = useState<Paths | null>(null);
  const [selected, setSelected] = useState("");
  const [visitorState, setVisitorState] = useState("");

  useEffect(() => {
    let alive = true;
    import("~/lib/us-states-map")
      .then((m) => alive && setPaths({ viewBox: m.US_MAP_VIEWBOX, paths: m.US_STATE_PATHS }))
      .catch(() => {});
    getNearYou()
      .then((d) => {
        if (!alive || !d.state || !states[d.state]) return;
        setVisitorState(d.state);
        setSelected((cur) => cur || d.state);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [states]);

  const shown = selected || busiestState(states);
  const info = states[shown];
  if (!info) return null;
  const name = STATE_NAMES[shown] ?? shown;
  const pick = (code: string, how: string) => {
    if (!states[code]) return;
    setSelected(code);
    trackEvent("home_map_state_pick", `${code}:${how}`);
  };
  const trades = Array.from(new Set([...info.topWork.map((w) => categoryTrade(w.name)), ...NEAR_YOU_TRADES])).slice(0, 7);

  return (
    <section aria-labelledby="home-map-title" className="mx-auto max-w-[1120px] px-4 py-10 sm:px-6">
      <div className="rounded-3xl border border-blue-400/25 bg-[#0a1830] p-5 text-white shadow-[0_10px_40px_rgba(37,99,235,0.18)] sm:p-8">
        <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-widest text-blue-300">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-400" />
          </span>
          Live map · tap your state
        </p>
        <h2 id="home-map-title" className="mt-2 text-2xl font-extrabold sm:text-3xl">
          Where the government is buying right now
        </h2>

        <div className="mt-5 grid items-center gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            {paths ? (
              <svg
                viewBox={`0 0 ${paths.viewBox.width} ${paths.viewBox.height}`}
                className="h-auto w-full"
                role="group"
                aria-label="Map of open government bids by state"
              >
                {Object.entries(paths.paths).map(([code, d]) => {
                  const has = !!states[code];
                  const on = code === shown;
                  return (
                    <path
                      key={code}
                      d={d}
                      className="home-map-state cursor-pointer outline-none"
                      style={{ animationDelay: `${Math.min(order[code] ?? 60, 60) * 35}ms` }}
                      fill={on ? "#f59e0b" : has ? HOME_MAP_SHADES[shadeIndex(states[code].count, max)] : "#1e293b"}
                      stroke={on ? "#fde68a" : "#0a1830"}
                      strokeWidth={on ? 2.5 : 1}
                      role="button"
                      tabIndex={has ? 0 : -1}
                      aria-label={`${STATE_NAMES[code] ?? code}: ${(states[code]?.count ?? 0).toLocaleString("en-US")} open bids`}
                      onClick={() => pick(code, "map")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          pick(code, "map");
                        }
                      }}
                    >
                      <title>{`${STATE_NAMES[code] ?? code}: ${(states[code]?.count ?? 0).toLocaleString("en-US")} open bids`}</title>
                    </path>
                  );
                })}
              </svg>
            ) : (
              <div className="aspect-[959/593] w-full animate-pulse rounded-2xl bg-slate-800/60" aria-hidden="true" />
            )}
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400" aria-hidden="true">
              Fewer
              {HOME_MAP_SHADES.map((c) => (
                <span key={c} className="h-2.5 w-6 rounded-sm" style={{ background: c }} />
              ))}
              More open bids
            </div>
          </div>

          <div aria-live="polite">
            <label className="text-xs font-semibold text-slate-400" htmlFor="home-map-pick">
              Or pick a state
            </label>
            <select
              id="home-map-pick"
              value={shown}
              onChange={(e) => pick(e.target.value, "list")}
              className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              {Object.keys(states)
                .sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b))
                .map((code) => (
                  <option key={code} value={code}>
                    {STATE_NAMES[code] ?? code}
                  </option>
                ))}
            </select>

            <p className="mt-4 text-sm font-semibold text-amber-300">
              {shown === visitorState ? `📍 ${name} (near you)` : name}
            </p>
            <p className="text-5xl font-extrabold tracking-tight">{info.count.toLocaleString("en-US")}</p>
            <p className="text-sm text-slate-300">government bids open right now</p>
            {info.closingSoon > 0 && (
              <p className="mt-2 text-sm font-semibold text-rose-300">⏰ {info.closingSoon.toLocaleString("en-US")} close in the next 7 days</p>
            )}
            {info.topWork.length > 0 && (
              <p className="mt-3 text-sm text-slate-300">
                Buying most:{" "}
                {info.topWork.map((w, i) => (
                  <span key={w.name}>
                    {i > 0 && " · "}
                    <span className="font-semibold text-white">{w.name}</span> {w.count.toLocaleString("en-US")}
                  </span>
                ))}
              </p>
            )}
            <p className="mt-4 text-sm text-slate-300">What does your business do?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {trades.map((t) => (
                <a
                  key={t}
                  href={nearYouRadarHref(shown, t)}
                  onClick={() => trackEvent("home_map_trade_click", `${shown}:${t}`)}
                  className="rounded-full border border-slate-600 bg-slate-900/60 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:border-amber-400 hover:bg-amber-500/15"
                >
                  {t}
                </a>
              ))}
              <a
                href={nearYouRadarHref(shown)}
                onClick={() => trackEvent("home_map_trade_click", `${shown}:other`)}
                className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-amber-300 hover:text-amber-200"
              >
                Something else →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
