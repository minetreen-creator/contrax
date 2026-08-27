import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import {
  buildContractMap,
  deriveStateCode,
  formatCompactMoney,
  STATE_NAMES,
  type ContractMapAggregate,
  type StateAggregate,
} from "~/lib/contract-map";
import { US_MAP_VIEWBOX, US_STATE_PATHS } from "~/lib/us-states-map";
import { US_STATES } from "~/lib/states";

/**
 * /map — "U.S. Contract Map"
 *
 * A clickable map of all 50 states (+ DC) proving nationwide coverage and
 * making browsing fun. Server-rendered (SSR): the map + aggregate totals render
 * with no JS. Interactivity (hover tooltip, click-to-drill-down) hydrates on top.
 *
 * Every number traces to the LIVE `bids` table via /api/contract-map
 * (aggregates) and /api/contract-map/bids (drill-down). No new external data.
 *
 * Honesty (owner-directed): "stated value" is exactly that — the sum of only
 * the estimated_value strings we can parse to a positive dollar figure, and the
 * tooltip/panels carry the "across N of M bids" denominator so the limitation
 * is transparent. Bids whose `location` can't be resolved to a specific state
 * are counted separately (totals.unspecified), never falsely assigned.
 */
interface DrillBid {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  set_aside: string | null;
  estimated_value: string | null;
  due_date: string | null;
  source_url: string | null;
}

const getContractMap = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContractMapAggregate> => {
    const rows = await sql()`
      SELECT location, set_aside, estimated_value, agency, category, due_date
      FROM bids
      WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
    `;
    return buildContractMap(rows as any);
  },
);

const getStateBids = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { state: string } }): Promise<{ state: string; name: string; bids: DrillBid[] }> => {
    const state = (data.state || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(state) || !US_STATES.includes(state as any)) {
      return { state, name: "", bids: [] };
    }
    const rows = await sql()`
      SELECT id, title, agency, location, set_aside, estimated_value, due_date, source_url
      FROM bids
      WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
      ORDER BY due_date ASC NULLS LAST
    `;
    const bids = (rows as any[])
      .filter((r) => deriveStateCode(r.location) === state)
      .map((r) => ({
        id: Number(r.id),
        title: r.title,
        agency: r.agency,
        location: r.location,
        set_aside: r.set_aside,
        estimated_value: r.estimated_value,
        due_date: r.due_date ? new Date(r.due_date).toISOString() : null,
        source_url: r.source_url,
      }));
    return { state, name: STATE_NAMES[state] ?? "", bids };
  },
);

export const Route = createFileRoute("/map")({
  validateSearch: (search: Record<string, unknown>) => ({
    state: typeof search.state === "string" ? search.state.slice(0, 2).toUpperCase() : undefined,
  }),
  loader: async ({ context }) => {
    const aggregate = await getContractMap();
    const searchState = context.search?.state;
    let initialBids: { state: string; name: string; bids: DrillBid[] } | null = null;
    if (searchState && /^[A-Z]{2}$/.test(searchState) && US_STATES.includes(searchState as any)) {
      initialBids = await getStateBids({ data: { state: searchState } });
    }
    return { aggregate, initialBids };
  },
  component: MapPage,
  head: () => ({
    meta: [
      { title: "U.S. Contract Map — See where government money is moving | Contrax" },
      {
        name: "description",
        content:
          "Explore open federal, state and local contract opportunities across the country. Select a state to see what agencies are buying and which contracts match your business.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "U.S. Contract Map — Contrax" },
      { property: "og:description", content: "Explore open contract opportunities across all 50 states. Select a state to see what agencies are buying and which contracts match your business." },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/map" }],
  }),
});

// ── Fill scale ───────────────────────────────────────────────────────────────
// Owner spec shading: gray=no records, light→dark blue as open count grows,
// bright green > 300. More open opportunities = brighter.
const BUCKETS: { min: number; fill: string; label: string; glow?: boolean }[] = [
  { min: 0, fill: "#2b3a52", label: "No recorded open bids" },
  { min: 1, fill: "#5b8def", label: "1–25 open bids" },
  { min: 26, fill: "#3b74e8", label: "26–100" },
  { min: 101, fill: "#2557c9", label: "101–300" },
  { min: 301, fill: "#22c58b", label: ">300 — most active", glow: true },
];
function fillFor(count: number): { fill: string; glow: boolean } {
  let out = BUCKETS[0];
  for (const b of BUCKETS) if (count >= b.min) out = b;
  return { fill: out.fill, glow: !!out.glow };
}
const SELECTED_FILL = "#f5a623"; // gold for the selected state

function compactValueLabel(agg: StateAggregate): string {
  if (agg.withValue <= 0) return "stated value not disclosed";
  return `${formatCompactMoney(agg.statedValue)} in stated value`;
}

function fmtDate(d: string | null) {
  if (!d) return "Not specified";
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? "Not specified"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function BidCard({ bid }: { bid: DrillBid }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-800/60 p-4 transition-colors hover:border-slate-500">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-slate-100">{bid.title || "Untitled opportunity"}</h3>
        {bid.set_aside ? (
          <span className="inline-flex rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
            {bid.set_aside}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        {bid.agency ? <span>{bid.agency}</span> : null}
        {bid.location ? (
          <span className="inline-flex items-center gap-1">📍 {bid.location}</span>
        ) : null}
        {bid.estimated_value ? <span>{bid.estimated_value}</span> : null}
        <span>Due {fmtDate(bid.due_date)}</span>
      </div>
      {bid.source_url ? (
        <a
          href={bid.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs font-medium text-sky-300 hover:text-sky-200"
        >
          Open original notice &rarr;
        </a>
      ) : null}
    </div>
  );
}

function StatePanel({
  state,
  aggs,
  onBack,
}: {
  state: string;
  aggs: Record<string, StateAggregate>;
  onBack: () => void;
}) {
  const agg = aggs[state];
  if (!agg) return null;
  return (
    <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{STATE_NAMES[state] ?? state}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {agg.count} open bids · {agg.setAsideCount} set-asides · {compactValueLabel(agg)} across{" "}
            {agg.withValue} of {agg.count} bids
          </p>
        </div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700"
        >
          &larr; Back to all states
        </button>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Most active agencies</h3>
          {agg.agencies.length ? (
            <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
              {agg.agencies.map((a) => (
                <li key={a.name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{a.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No data</p>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top industries</h3>
          {agg.industries.length ? (
            <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
              {agg.industries.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{i.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{i.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No data</p>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Set-aside breakdown</h3>
          {agg.setAsideBreakdown.length ? (
            <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
              {agg.setAsideBreakdown.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.key}</span>
                  <span className="shrink-0 text-xs text-slate-500">{s.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No set-aside tags</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MapPage() {
  const { aggregate, initialBids } = Route.useLoaderData();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(initialBids?.state ?? null);
  const [bids, setBids] = useState<DrillBid[]>(initialBids?.bids ?? []);
  const [loadingBids, setLoadingBids] = useState(false);
  const [hovered, setHovered] = useState<{ code: string; x: number; y: number } | null>(null);

  const selectState = async (code: string) => {
    setSelected(code);
    setLoadingBids(true);
    setBids([]);
    try {
      const res = await fetch(`/api/contract-map/bids?state=${code}`);
      const data = await res.json();
      setBids(Array.isArray(data?.bids) ? data.bids : []);
    } catch {
      setBids([]);
    } finally {
      setLoadingBids(false);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    setBids([]);
  };

  const handleMove = (e: React.MouseEvent<SVGSVGElement>, code: string) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHovered({ code, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Reset hovered when leaving the map container
  useEffect(() => {
    const onLeave = () => setHovered(null);
    const el = containerRef.current;
    el?.addEventListener("mouseleave", onLeave);
    return () => el?.removeEventListener("mouseleave", onLeave);
  }, []);

  const hoverAgg = hovered ? aggregate.states[hovered.code] : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Contrax Opportunity Map</p>
          <h1 className="mt-2 text-3xl font-extrabold text-white sm:text-4xl">See where government money is moving.</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400">
            Explore open federal, state and local contract opportunities across the country. Hover a state for its
            totals — click one to filter the live database and see exactly what's being bought in that state.
          </p>
        </div>

        {/* Totals strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
            <div className="text-2xl font-extrabold text-white">
              {aggregate.totals.totalOpen.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-400">open opportunities</div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
            <div className="text-2xl font-extrabold text-white">{aggregate.totals.totalStates}</div>
            <div className="mt-1 text-xs text-slate-400">states + DC</div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
            <div className="text-2xl font-extrabold text-emerald-400">
              {formatCompactMoney(aggregate.totals.totalStatedValue)}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              stated value across {aggregate.totals.totalWithValue.toLocaleString()} bids
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
            <div className="text-2xl font-extrabold text-amber-400">{aggregate.totals.setAsideCount ?? "—"}</div>
            <div className="mt-1 text-xs text-slate-400">set-aside opportunities</div>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">
          Based on {aggregate.totals.totalOpen.toLocaleString()} open opportunities sync'd from SAM.gov · updated{" "}
          {new Date(aggregate.totals.generatedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          {" "}
          {aggregate.totals.unspecified > 0
            ? `· ${aggregate.totals.unspecified.toLocaleString()} more in locations not tied to one state`
            : ""}
        </p>

        {/* Map */}
        <div
          ref={containerRef}
          className="relative mt-6 overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 p-4"
        >
          <svg
            viewBox={`0 0 ${US_MAP_VIEWBOX.width} ${US_MAP_VIEWBOX.height}`}
            className="w-full"
            role="img"
            aria-label="Interactive map of US states showing open contract opportunities"
          >
            <defs>
              <filter id="mapGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#38bdf8" floodOpacity="0.85" />
              </filter>
            </defs>
            {Object.keys(US_STATE_PATHS).map((code) => {
              const agg = aggregate.states[code];
              const count = agg?.count ?? 0;
              const isSelected = selected === code;
              const { fill, glow } = isSelected ? { fill: SELECTED_FILL, glow: true } : fillFor(count);
              const tooltip = agg
                ? `${STATE_NAMES[code] ?? code}: ${count} open bids · ${agg.setAsideCount} set-asides · ${compactValueLabel(agg)}`
                : `${STATE_NAMES[code] ?? code}: no recorded open bids`;
              return (
                <a
                  key={code}
                  href={`/map?state=${code}`}
                  onClick={(e) => {
                    e.preventDefault();
                    selectState(code);
                  }}
                  onMouseMove={(e) => handleMove(e.nativeEvent as any, code)}
                  onMouseEnter={(e) => handleMove(e.nativeEvent as any, code)}
                  className="outline-none"
                  aria-label={tooltip}
                >
                  <path
                    d={US_STATE_PATHS[code]}
                    fill={fill}
                    stroke="#0b1220"
                    strokeWidth="1"
                    className="cursor-pointer transition-all duration-150 hover:brightness-125"
                    style={glow ? { filter: "url(#mapGlow)" } : undefined}
                  />
                </a>
              );
            })}
          </svg>

          {/* Tooltip */}
          {hovered && hoverAgg ? (
            <div
              className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-600 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
              style={{
                left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 700) - 260),
                top: hovered.y + 14,
              }}
            >
              <div className="font-semibold text-white">
                {STATE_NAMES[hovered.code] ?? hovered.code}: {hoverAgg.count} open bids · {hoverAgg.setAsideCount}{" "}
                set-asides · {compactValueLabel(hoverAgg)}
              </div>
              <div className="mt-1 text-slate-400">
                {hoverAgg.closingSoon} closing this week · stated value across {hoverAgg.withValue} of {hoverAgg.count}{" "}
                bids
              </div>
            </div>
          ) : hovered ? (
            <div
              className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-slate-600 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
              style={{
                left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 700) - 260),
                top: hovered.y + 14,
              }}
            >
              <div className="font-semibold text-white">
                {STATE_NAMES[hovered.code] ?? hovered.code}: no recorded open bids
              </div>
            </div>
          ) : null}

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
            <span className="font-medium text-slate-300">Fewer</span>
            {BUCKETS.map((b) => (
              <span key={b.label} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: b.fill }} />
                {b.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: SELECTED_FILL }} />
              Selected
            </span>
            <span className="text-slate-500">Brighter = more open opportunities</span>
          </div>
        </div>

        {/* Drill-down */}
        {selected ? (
          <>
            <StatePanel state={selected} aggs={aggregate.states} onBack={clearSelection} />
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  {STATE_NAMES[selected] ?? selected} — open bids
                </h2>
                <span className="text-sm text-slate-400">
                  {loadingBids ? "Loading…" : `${bids.length} open`}
                </span>
              </div>
              <div className="mt-3 grid gap-3">
                {loadingBids ? (
                  <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-6 text-center text-sm text-slate-400">
                    Loading open bids for {STATE_NAMES[selected] ?? selected}…
                  </div>
                ) : bids.length === 0 ? (
                  <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-6 text-center text-sm text-slate-400">
                    No open bids found in this state right now.
                  </div>
                ) : (
                  bids.map((b) => <BidCard key={b.id} bid={b} />)
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
            Click any state above to see the open contracts, agencies and set-asides in that state.
          </div>
        )}
      </div>
    </div>
  );
}
