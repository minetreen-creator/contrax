import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { GAP_LABELS, money, stateTradeHref, topOpenings, type GapState } from "~/lib/gap-map";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { US_MAP_VIEWBOX, US_STATE_PATHS } from "~/lib/us-states-map";
import { trackEvent } from "~/lib/track";

/**
 * /gap-map — Opportunity Gap Map (owner 2026-11-09, "I want all the ideas"). For one trade: where
 * federal agencies spend, the small-business share, the top buyers, contracts ending in the next
 * year and how many companies already hold the work, by state. Public USAspending.gov figures
 * (src/lib/gap-map.ts). Open to everyone; the contract lists behind it are on /recompetes.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Federal Contracting Opportunity Gap Map by Trade and State | Contrax";
const DESC =
  "Where federal agencies spend on janitorial, security, construction, HVAC, IT and more, how much goes to small businesses, who buys it, and which states have big spending but few companies holding the work.";

function parseSearch(search: Record<string, unknown>): { trade: string } {
  const trade = typeof search.trade === "string" && SEO_TRADE_BY_SLUG[search.trade] ? search.trade : "janitorial";
  return { trade };
}

const getGapMap = createServerFn({ method: "GET" })
  .validator((d: unknown) => parseSearch((d ?? {}) as Record<string, unknown>))
  .handler(async ({ data }) => {
    try {
      const { loadGapMap } = await import("~/lib/gap-map.server");
      return { ...(await loadGapMap(data.trade)), failed: false };
    } catch (e) {
      console.error("[gap-map] load failed:", e);
      return { trade: data.trade, fiscalYear: null, states: [] as GapState[], failed: true };
    }
  });

export const Route = createFileRoute("/gap-map")({
  validateSearch: (search: Record<string, unknown>) => parseSearch(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getGapMap({ data: deps }),
  component: () => (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <GapMapPage />
    </div>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/gap-map` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/gap-map` }],
  }),
});

const pct = (x: number) => `${Math.round(x * 100)}%`;

function GapMapPage() {
  const data = Route.useLoaderData();
  const trade = SEO_TRADE_BY_SLUG[data.trade];
  const byState = new Map(data.states.map((s) => [s.state, s]));
  const openings = topOpenings(data.states, 5);
  const [selected, setSelected] = useState<string | null>(openings[0]?.state ?? data.states[0]?.state ?? null);
  const pick = selected ? byState.get(selected) : undefined;
  const totalSpend = data.states.reduce((a, s) => a + s.spend, 0);
  const totalEnding = data.states.reduce((a, s) => a + s.ending12, 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
        <a href="/pathway" className="hover:underline">Contrax Pathway</a> · Step 1 · Opportunity gap map
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">Where the federal {trade.label.toLowerCase()} work is, and who already has it</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Federal spending{data.fiscalYear ? ` in fiscal year ${data.fiscalYear}` : ""}, the share set aside for small businesses, the top buying agencies,
        contracts ending in the next 12 months, and how many companies hold the work now. Green states have big spending but few companies holding it.
        Source: USAspending.gov, by state.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {SEO_TRADES.map((t) => (
          <a
            key={t.slug}
            href={`/gap-map?trade=${t.slug}`}
            className={`rounded-full border px-3 py-1 text-sm ${t.slug === data.trade ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`}
            onClick={() => trackEvent("gap_map_trade", t.slug)}
          >
            {t.label}
          </a>
        ))}
      </div>

      {data.failed || data.states.length === 0 ? (
        <p className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {data.failed ? "The map could not load just now. Please try again in a minute." : "No federal spending figures for this trade yet."}
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat label={`Federal ${trade.label.toLowerCase()} spending`} value={money(totalSpend)} />
            <Stat label="Contracts ending in 12 months" value={totalEnding.toLocaleString("en-US")} />
            <Stat label="Openings (green states)" value={String(data.states.filter((s) => s.label === "opening").length)} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <svg viewBox={`0 0 ${US_MAP_VIEWBOX.width} ${US_MAP_VIEWBOX.height}`} className="w-full" role="img" aria-label={`Map of ${trade.label} opportunity by state`}>
                {Object.keys(US_STATE_PATHS).map((code) => {
                  const s = byState.get(code);
                  const fill = s ? GAP_LABELS[s.label].fill : "#e2e8f0";
                  return (
                    <path
                      key={code}
                      d={US_STATE_PATHS[code]}
                      fill={fill}
                      stroke={selected === code ? "#0f172a" : "#ffffff"}
                      strokeWidth={selected === code ? 2.5 : 1}
                      className="cursor-pointer hover:opacity-80"
                      onClick={() => {
                        setSelected(code);
                        trackEvent("gap_map_state", `${data.trade}:${code}`);
                      }}
                    >
                      <title>{s ? `${s.name}: ${GAP_LABELS[s.label].text}, ${money(s.spend)} federal spending` : code}</title>
                    </path>
                  );
                })}
              </svg>
              <div className="mt-2 flex flex-wrap gap-4 px-1 text-xs text-slate-600">
                {(Object.keys(GAP_LABELS) as (keyof typeof GAP_LABELS)[]).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ background: GAP_LABELS[k].fill }} />
                    <strong>{GAP_LABELS[k].text}</strong>: {GAP_LABELS[k].detail}
                  </span>
                ))}
              </div>
            </div>

            <aside className="rounded-2xl border border-slate-200 bg-white p-4">
              {pick ? <StatePanel s={pick} trade={data.trade} tradeLabel={trade.label} /> : <p className="text-sm text-slate-600">Tap a state.</p>}
            </aside>
          </div>

          <h2 className="mt-8 text-lg font-bold text-slate-900">Best openings for {trade.label.toLowerCase()}</h2>
          <p className="text-sm text-slate-600">Big federal spending, few companies holding the work, ranked with the small-business share and contracts coming up.</p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Spending</th>
                  <th className="px-3 py-2">Small-business share</th>
                  <th className="px-3 py-2">Companies holding work</th>
                  <th className="px-3 py-2">Ending in 12 months</th>
                  <th className="px-3 py-2">Rating</th>
                </tr>
              </thead>
              <tbody>
                {data.states.slice(0, 15).map((s) => (
                  <tr key={s.state} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setSelected(s.state)}>
                    <td className="px-3 py-2 font-medium text-slate-900">{s.name}</td>
                    <td className="px-3 py-2">{money(s.spend)}</td>
                    <td className="px-3 py-2">{pct(s.setAsideShare)}</td>
                    <td className="px-3 py-2">{s.holders}</td>
                    <td className="px-3 py-2">{s.ending12}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: GAP_LABELS[s.label].fill }}>
                        {GAP_LABELS[s.label].text}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            "Companies holding work" counts the companies whose federal {trade.label.toLowerCase()} contracts in the state end in the next 18 months.
            Figures are by place of performance and state; county figures are not available from this source.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function StatePanel({ s, trade, tradeLabel }: { s: GapState; trade: string; tradeLabel: string }) {
  const l = GAP_LABELS[s.label];
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">{s.name}</h2>
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: l.fill }}>
          {l.text}
        </span>
      </div>
      <p className="text-xs text-slate-500">{l.detail}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Federal spending</dt>
          <dd className="font-semibold">{money(s.spend)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Set aside for small business</dt>
          <dd className="font-semibold">
            {money(s.setAsideSpend)} ({pct(s.setAsideShare)})
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Contracts ending in 12 months</dt>
          <dd className="font-semibold">
            {s.ending12}
            {s.ending12Value ? ` · ${money(s.ending12Value)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Companies holding work</dt>
          <dd className="font-semibold">{s.holders}</dd>
        </div>
      </dl>
      {s.topAgencies.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top buyers</p>
          <ul className="mt-1 space-y-1 text-sm">
            {s.topAgencies.map((a) => (
              <li key={a.name} className="flex justify-between gap-2">
                <span className="text-slate-800">{a.name}</span>
                <span className="shrink-0 text-slate-500">{money(a.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <a
          href={`/recompetes?trade=${trade}&state=${s.state}`}
          className="rounded-lg bg-slate-900 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-slate-800"
          onClick={() => trackEvent("gap_map_recompetes", `${trade}:${s.state}`)}
        >
          See the {s.ending12} contracts ending and who holds them
        </a>
        <a
          href={stateTradeHref(s.state, trade)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold text-slate-800 hover:border-slate-500"
          onClick={() => trackEvent("gap_map_open_bids", `${trade}:${s.state}`)}
        >
          Open {tradeLabel.toLowerCase()} bids in {s.name}
        </a>
        <a
          href={`/prime-finder?trade=${trade}&state=${s.state}`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold text-slate-800 hover:border-slate-500"
          onClick={() => trackEvent("gap_map_primes", `${trade}:${s.state}`)}
        >
          Primes holding this work in {s.name}
        </a>
      </div>
    </div>
  );
}
