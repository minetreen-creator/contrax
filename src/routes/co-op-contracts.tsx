import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { CoopAlertForm } from "~/components/CoopAlertForm";
import { COOPS, COOP_BY_KEY, type CoopSolicitation } from "~/lib/coop-contracts";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * /co-op-contracts — Pathway step 5 (owner 2026-11-10: "How does this work" → "yes build it"). How
 * purchasing co-ops work, the co-ops and where each posts its calls for vendors, and the open Sourcewell
 * and BuyBoard, Choice Partners and OMNIA solicitations (src/jobs/coop-sync.ts), filterable by trade.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Co-op Contracts: Sell to Agencies Without a Bid | Contrax";
const DESC =
  "How purchasing co-ops like Sourcewell, BuyBoard and TIPS work, which categories are open for vendors now, and how a small business gets on a contract that thousands of agencies buy from with a purchase order.";

const getCoop = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const t = String((d as { trade?: unknown })?.trade ?? "");
    return { trade: SEO_TRADE_BY_SLUG[t] ? t : "" };
  })
  .handler(async ({ data }) => {
    const { openCoopSolicitations } = await import("~/lib/coop-contracts.server");
    const all = await openCoopSolicitations(null);
    return { trade: data.trade, all };
  });

export const Route = createFileRoute("/co-op-contracts")({
  validateSearch: (s: Record<string, unknown>) => ({ trade: typeof s.trade === "string" ? s.trade : undefined }),
  loaderDeps: ({ search }) => ({ trade: search.trade ?? "" }),
  loader: ({ deps }) => getCoop({ data: { trade: deps.trade } }),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: `${PROD_URL}/co-op-contracts` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/co-op-contracts` }],
  }),
  component: CoopPage,
});

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" });

const STEPS = [
  ["One bid for many buyers", "A purchasing co-op runs one competitive bid for a category, such as roofing, HVAC, flooring or janitorial, on behalf of its member agencies: cities, counties, school districts, colleges and more."],
  ["Members buy without their own bid", "Because the competition already happened, a member agency can usually buy from the winners with a purchase order. Whether it may depends on its state's law and its own rules; many states, Texas among them, allow it."],
  ["Answer when your category opens", "You can't join any time. Each co-op re-bids each category on a cycle and posts the call for vendors on its own site. Answer it like any bid: your pricing, the area you cover, references and insurance. Many categories award several vendors."],
  ["Then sell it", "Winning brings no orders by itself. Tell agencies you're on the contract, with its number, so they can buy from you without a bid. The co-op usually takes a small fee on each sale; check its terms."],
] as const;

function CoopPage() {
  const { trade, all } = Route.useLoaderData();
  const list = trade ? all.filter((s) => s.trades.includes(trade)) : all;
  const open = list.filter((s) => s.dueAt);
  const soon = list.filter((s) => !s.dueAt);
  const tradeLabel = trade ? SEO_TRADE_BY_SLUG[trade]?.label ?? "" : "";
  const counts = Object.fromEntries(SEO_TRADES.map((t) => [t.slug, all.filter((s) => s.trades.includes(t.slug)).length]));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/pathway" className="hover:underline">The Contrax Pathway</a> · Step 5
        </p>
        <h1 className="mt-1 text-3xl font-bold">Get on a co-op contract</h1>
        <p className="mt-2 text-slate-700">
          A co-op contract lets thousands of agencies buy from you with a purchase order, without running their own bid. You get on it by winning the co-op's bid for your
          category, once, when that category opens.
        </p>

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          {STEPS.map(([h, p], i) => (
            <div key={h} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-bold">
                {i + 1}. {h}
              </p>
              <p className="mt-1 text-slate-700">{p}</p>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border-2 border-slate-900 bg-white p-5" aria-labelledby="open-title">
          <h2 id="open-title" className="text-lg font-bold">
            Open for vendors now{tradeLabel ? ` · ${tradeLabel}` : ""}
          </h2>
          <p className="mt-1 text-sm text-slate-600">From the co-ops' own pages (Sourcewell, BuyBoard, Choice Partners and OMNIA), checked every day. Answer before the due time on the co-op's site.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <a href="/co-op-contracts" className={`rounded-full border px-3 py-1 font-semibold ${!trade ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>
              All ({all.length})
            </a>
            {SEO_TRADES.filter((t) => counts[t.slug] > 0).map((t) => (
              <a
                key={t.slug}
                href={`/co-op-contracts?trade=${t.slug}`}
                className={`rounded-full border px-3 py-1 font-semibold ${trade === t.slug ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}
              >
                {t.label} ({counts[t.slug]})
              </a>
            ))}
          </div>
          {open.length ? (
            <ul className="mt-4 divide-y divide-slate-100 text-sm">
              {open.map((s) => (
                <CoopRow key={s.key} s={s} />
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-600">
              {trade ? `No co-op category for ${tradeLabel.toLowerCase()} is open at the co-ops we read right now. ` : "No open co-op solicitations are stored yet. "}
              Categories open on a cycle; check back, or watch the co-ops below.
            </p>
          )}
          {/* Owner 2026-11-13: a visitor whose trade has nothing open can ask to be told when it opens. */}
          <CoopAlertForm trade={trade} emphasis={Boolean(trade) && open.length === 0} />
          {soon.length ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-semibold">Announced or open, no due date listed here (check the co-op's page)</p>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {soon.map((s) => (
                  <li key={s.key}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{s.title}</a> <span className="text-slate-500">({COOP_BY_KEY[s.coop]?.name})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="mt-8" aria-labelledby="coops-title">
          <h2 id="coops-title" className="text-lg font-bold">The co-ops</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {COOPS.map((c) => (
              <div key={c.key} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <p className="text-base font-bold">{c.name}</p>
                <p className="mt-1 text-slate-700">{c.runBy}</p>
                <p className="mt-1 text-slate-600">
                  <span className="font-semibold text-slate-800">Who buys:</span> {c.members}
                </p>
                <p className="mt-1 text-slate-600">
                  <span className="font-semibold text-slate-800">How to get awarded:</span> {c.howToGetOn}
                </p>
                <a href={c.postsAt.url} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("coop_site_click", c.key)} className="mt-2 inline-block font-semibold text-blue-700 hover:underline">
                  {c.postsAt.label} →
                </a>
                <p className="mt-1 text-xs text-slate-500">{c.inContrax ? "Its open solicitations are listed above." : "Not read by Contrax; check its site."}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold">Equipment categories: a way in for local installers</h2>
          <p className="mt-1 text-slate-800">
            Some open categories, such as scoreboards, playgrounds or recycling equipment, are written for manufacturers. Many manufacturers on co-op contracts sell
            and install through authorized dealers and local installers, so a service business can often get the work by becoming one. Ask the manufacturer whether
            it adds dealers or installers to its co-op contract, and check that co-op's contract page for its dealer list.
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm">
          <h2 className="text-lg font-bold">For construction</h2>
          <p className="mt-1 text-slate-800">
            Many states require agencies to bid building projects themselves, with bonds and sometimes prevailing wages, so co-ops matter most for repeat repair, renovation
            and trade-service work. The common construction route is a job-order or indefinite-quantity contract: one award with set unit prices, then a stream of smaller
            jobs. Sourcewell posts its indefinite-quantity construction solicitations in their own list; they show above when one is open.
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold">Before your category opens</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
            <li>Register as a vendor on the co-op's site so you get its notices.</li>
            <li>Have your insurance certificates, references and a price list or unit prices ready.</li>
            <li>Decide the area you can serve well; co-ops ask, and agencies check.</li>
            <li>
              Keep finding regular bids in the meantime: <a href={trade ? `/radar?trade=${trade}` : "/radar"} className="font-semibold text-blue-700">search Radar →</a>
            </li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Each co-op's rules, fees and member lists are its own; read the solicitation before you answer. Contrax lists these calls for vendors so you see them; it is not part of
            any co-op.
          </p>
        </section>
      </main>
    </div>
  );
}

function CoopRow({ s }: { s: CoopSolicitation }) {
  const coop = COOP_BY_KEY[s.coop];
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("coop_solicitation_click", s.key)} className="font-semibold text-slate-900 hover:underline">
          {s.title}
        </a>
        <p className="text-xs text-slate-500">
          {coop?.name}
          {s.number ? ` · Proposal ${s.number}` : ""}
          {s.construction ? " · Indefinite-quantity construction" : ""}
          {s.trades.length ? ` · ${s.trades.map((t) => SEO_TRADE_BY_SLUG[t]?.label ?? t).join(", ")}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-slate-700">Due {fmtDue(s.dueAt!)}</span>
    </li>
  );
}
