import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { formatDollars, fiscalYearLabel } from "~/lib/federal-trade-data";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { aOrAn, certCounts, findSubsIndexable, findSubsPath, stateSlugOf, tradeWords } from "~/lib/sub-finder";
import { trackEvent } from "~/lib/track";

/**
 * /find-subcontractors/{state}/{trade} — the prime's search page (owner 2026-11-09): "find HVAC
 * subcontractors in Missouri for a government bid". Every figure is a stored record: listed
 * members (opt-in, counted here, named only on Sub Finder) and USAspending.gov federal work.
 */
const PROD_URL = "https://www.contrax.company";
const STATES: Record<string, string> = {};
for (const [code, name] of Object.entries(STATE_NAMES)) {
  if (code.length === 2) STATES[stateSlugOf(name)] = code;
}

const getFindSubs = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ state: String((d as { state?: unknown })?.state ?? "").toLowerCase(), trade: String((d as { trade?: unknown })?.trade ?? "").toLowerCase() }))
  .handler(async ({ data }) => {
    const code = STATES[data.state] ?? null;
    const trade = SEO_TRADE_BY_SLUG[data.trade] ?? null;
    if (!code || !trade) return null;
    const out = {
      code,
      name: STATE_NAMES[code],
      trade: { slug: trade.slug, label: trade.label },
      listed: 0,
      certs: [] as { value: string; label: string; count: number }[],
      spend: 0,
      setAsideSpend: 0,
      fiscalYear: null as number | null,
      agencies: [] as string[],
      holders: 0,
      withPlan: 0,
      ending12: 0,
      ending12Value: 0,
      registered: 0,
      registeredCerts: {} as Record<string, number>,
    };
    try {
      const { findSubs } = await import("~/lib/sub-finder.server");
      const subs = await findSubs({ trade: trade.slug, state: code, cert: null });
      out.listed = subs.length;
      out.certs = certCounts(subs);
    } catch (e) {
      console.error("[find-subcontractors] listed subs failed:", e);
    }
    try {
      const { registeredSubCounts } = await import("~/lib/sam-registrants.server");
      const r = await registeredSubCounts(trade.slug, code);
      out.registered = r.total;
      out.registeredCerts = r.certs;
    } catch (e) {
      console.error("[find-subcontractors] registered counts failed:", e);
    }
    try {
      const { queryRecompetes, tradeSpendingFor } = await import("~/lib/federal-trade-data.server");
      const { loadPrimes } = await import("~/lib/prime-finder.server");
      const [spending, ending, primes] = await Promise.all([
        tradeSpendingFor(trade.slug, code),
        queryRecompetes({ trade: trade.slug, state: code, months: 12, limit: 1 }),
        loadPrimes(trade.slug, code),
      ]);
      if (spending) {
        out.spend = spending.total_amount;
        out.setAsideSpend = spending.set_aside_amount;
        out.fiscalYear = spending.fiscal_year;
        out.agencies = spending.top_agencies.map((a) => a.name).filter(Boolean).slice(0, 3);
      }
      out.ending12 = ending.count;
      out.ending12Value = ending.total;
      out.holders = primes.length;
      out.withPlan = primes.filter((p) => p.hasPlan).length;
    } catch (e) {
      console.error("[find-subcontractors] federal data failed:", e);
    }
    return out;
  });

export const Route = createFileRoute("/find-subcontractors/$state/$trade")({
  loader: ({ params }) => getFindSubs({ data: { state: params.state, trade: params.trade } }),
  head: ({ loaderData: d }) => {
    const title = d ? `Find ${d.trade.label} Subcontractors in ${d.name} for a Government Bid | Contrax` : "Find Subcontractors for a Government Bid | Contrax";
    const desc = d
      ? `Find ${tradeWords(d.trade.label)} subcontractors in ${d.name} for your government bid. See local subs listed for primes, send a Trade Package and collect quotes.`
      : "Find subcontractors by trade and state for your government bid.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { name: "robots", content: findSubsIndexable(d ? { ...d, listed: d.listed + d.registered } : d) ? "index, follow" : "noindex, follow" },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
      links: d ? [{ rel: "canonical", href: `${PROD_URL}${findSubsPath(d.name, d.trade.slug)}` }] : [],
    };
  },
  component: FindSubsPage,
});

/** "120 veteran-owned, 85 SDVOSB and 40 WOSB" from the counts (no names). PURE. */
function registeredCertText(c: Record<string, number>): string {
  const parts = [
    c.vosb ? `${c.vosb.toLocaleString("en-US")} veteran-owned` : null,
    c.sdvosb ? `${c.sdvosb.toLocaleString("en-US")} SDVOSB` : null,
    c.wosb ? `${c.wosb.toLocaleString("en-US")} WOSB` : null,
    c["8a"] ? `${c["8a"].toLocaleString("en-US")} 8(a)` : null,
    c.hubzone ? `${c.hubzone.toLocaleString("en-US")} HUBZone` : null,
  ].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
}

function FindSubsPage() {
  const d = Route.useLoaderData();
  if (!d) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <h1 className="text-2xl font-bold text-slate-900">We don't have that page</h1>
          <a href="/sub-finder" className="mt-3 inline-block font-semibold text-blue-700">Go to Sub Finder →</a>
        </main>
      </div>
    );
  }
  const label = tradeWords(d.trade.label);
  const finder = `/sub-finder?trade=${d.trade.slug}&state=${d.code}`;
  const fy = d.fiscalYear ? fiscalYearLabel(d.fiscalYear) : null;
  const share = d.spend > 0 ? Math.round((100 * d.setAsideSpend) / d.spend) : null;
  const otherTrades = SEO_TRADES.filter((t) => t.slug !== d.trade.slug);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/sub-finder" className="hover:underline">Sub Finder</a> · {d.name}
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">
          Find {label} subcontractors in {d.name}
        </h1>
        <p className="mt-2 text-slate-700">
          Bidding a government job as the prime and need {aOrAn(label)} {label} sub? See local businesses that listed themselves for primes, then send a Trade Package (your scope and
          deadline) and collect quotes in one place.
        </p>

        <section className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900">
            {d.listed > 0
              ? `${d.listed} ${label} sub${d.listed === 1 ? "" : "s"} listed for primes in ${d.name}`
              : `No ${label} subs listed in ${d.name} yet`}
          </h2>
          {d.certs.length ? (
            <p className="mt-1 text-sm text-slate-700">
              Certifications (self-reported): {d.certs.map((c) => `${c.count} ${c.label}`).join(", ")}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-slate-600">
            {d.listed > 0
              ? "Open Sub Finder to see them and send a quote request. Only businesses that chose to be listed appear, and each request lets them stop."
              : "Make a Trade Package anyway and share the link with the subs you know, by text or email. Every sub who opens it can list their business here."}
          </p>
          {d.registered > 0 ? (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <strong>{d.registered.toLocaleString("en-US")}</strong> small businesses in {d.name} are registered with the government (SAM.gov) for {label} work
              {registeredCertText(d.registeredCerts) ? `, including ${registeredCertText(d.registeredCerts)}` : ""}. Sub Finder shows them by name with their websites.
            </p>
          ) : null}
          <a href={finder} onClick={() => trackEvent("find_subs_page_click", `${d.trade.slug}-${d.code}`)} className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white">
            {d.listed > 0 || d.registered > 0 ? `See ${label} subs in ${d.name} →` : "Make a Trade Package →"}
          </a>
        </section>

        {d.spend > 0 || d.holders > 0 ? (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">Federal {label} work in {d.name}</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {d.spend > 0 ? (
                <li>
                  {formatDollars(d.spend)} spent{fy ? ` in ${fy}` : ""}
                  {share != null ? `, ${share}% through small-business set-asides` : ""}.
                </li>
              ) : null}
              {d.agencies.length ? <li>Top buyers: {d.agencies.join(", ")}.</li> : null}
              {d.holders > 0 ? (
                <li>
                  {d.holders} compan{d.holders === 1 ? "y holds" : "ies hold"} active contracts here
                  {d.withPlan > 0 ? `; ${d.withPlan} ${d.withPlan === 1 ? "has" : "have"} a federal subcontracting plan` : ""}.
                </li>
              ) : null}
              {d.ending12 > 0 ? (
                <li>
                  {d.ending12} contract{d.ending12 === 1 ? "" : "s"} worth {formatDollars(d.ending12Value)} end{d.ending12 === 1 ? "s" : ""} in the next 12 months and will be bid again.
                </li>
              ) : null}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Source: USAspending.gov federal award records.</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
              <a href={`/contracts-in/${stateSlugOf(d.name)}/${d.trade.slug}`} className="text-blue-700">Open {label} bids in {d.name} →</a>
              <a href={`/prime-finder?trade=${d.trade.slug}&state=${d.code}`} className="text-blue-700">Who holds this work →</a>
            </div>
          </section>
        ) : null}

        <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
          <h2 className="font-bold text-slate-900">How it works</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Pick the bid or project and describe the {label} scope and when you need quotes.</li>
            <li>Send it to listed subs, or share the link from your own phone or email with subs you already know.</li>
            <li>Subs send their quote on the page. Each one comes to your email and you reply to them directly.</li>
          </ol>
          <p className="mt-3">
            Are you {aOrAn(label)} {label} sub in {d.name}? <a href="/sub-finder#listing" className="font-semibold text-blue-700">List your business for primes →</a>
          </p>
        </section>

        <nav className="mt-6 text-sm">
          <h2 className="font-semibold text-slate-900">Other trades in {d.name}</h2>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {otherTrades.map((t) => (
              <a key={t.slug} href={findSubsPath(d.name, t.slug)} className="text-blue-700 hover:underline">
                {t.label}
              </a>
            ))}
          </div>
          <a href="/find-subcontractors" className="mt-2 inline-block text-blue-700 hover:underline">All states →</a>
        </nav>
      </main>
    </div>
  );
}
