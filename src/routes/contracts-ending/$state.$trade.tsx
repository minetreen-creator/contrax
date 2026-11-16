import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import {
  ENDING_ACCOUNT_ROWS,
  ENDING_FREE_ROWS,
  ENDING_TRADES,
  endingDescription,
  endingIndexable,
  endingMarket,
  endingPath,
  endingTitle,
  publicSlice,
  type EndingFull,
  type EndingMarket,
  type EndingPublic,
} from "~/lib/ending-pages";
import { awardUrl, formatDollars, notCompetedNote } from "~/lib/federal-trade-data";
import { REPORT_DELIVERY, REPORT_PRICE } from "~/lib/pipeline-report";
import { RADAR_PRO_HREF } from "~/lib/plan-gates";
import { seoHead } from "~/lib/seo-landing";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * /contracts-ending/{state}/{trade} — e.g. /contracts-ending/virginia/janitorial (owner
 * 2026-11-14). The public part of a Pipeline Snapshot for one market, built by the same function
 * a paid report uses. Rules and wording live in src/lib/ending-pages.ts. The loader sends only the
 * public part; /api/ending-list gives a free account 10 rows and Professional the full list.
 */
const PROD_URL = "https://www.contrax.company";

const getEnding = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ state: String((d as { state?: unknown } | null)?.state ?? ""), trade: String((d as { trade?: unknown } | null)?.trade ?? "") }))
  .handler(async ({ data }): Promise<{ market: EndingMarket | null; page: EndingPublic | null }> => {
    const market = endingMarket(data.state, data.trade);
    if (!market) return { market: null, page: null };
    try {
      const { reportData } = await import("~/lib/pipeline-report-data.server");
      return { market, page: publicSlice(await reportData(market.code, market.trade, 12)) };
    } catch (e) {
      console.error("[contracts-ending] failed", e);
      return { market, page: null };
    }
  });

export const Route = createFileRoute("/contracts-ending/$state/$trade")({
  validateSearch: (s: Record<string, unknown>): { full?: 1 } => (String(s.full) === "1" ? { full: 1 } : {}),
  loader: ({ params }) => getEnding({ data: { state: params.state, trade: params.trade } }),
  head: ({ loaderData }) => {
    const m = loaderData?.market;
    const head = seoHead({
      title: m ? endingTitle(m, loaderData?.page ?? null) : "Federal Contracts Ending Soon by State and Trade | Contrax",
      description: m ? endingDescription(m, loaderData?.page ?? null) : "Federal contracts ending in the next 12 months, by state and trade, from USAspending.gov records.",
      canonical: m ? `${PROD_URL}${endingPath(m.stateName, m.trade)}` : `${PROD_URL}/contracts-ending`,
    });
    // An unknown address, or a market with too few contracts to say anything, stays out of search.
    if (!m || !endingIndexable(loaderData?.page)) {
      head.meta = head.meta.map((x) => ("name" in x && x.name === "robots" ? { name: "robots", content: "noindex, follow" } : x));
    }
    return head;
  },
  component: ContractsEnding,
});

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const th = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600";
const td = "px-3 py-2 align-top";

function ContractTable({ rows }: { rows: EndingPublic["top"] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[640px] text-sm text-slate-700">
        <thead className="bg-slate-50">
          <tr><th className={th}>Holder</th><th className={th}>Agency</th><th className={th}>Award value</th><th className={th}>Ends</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.award_key} className="border-t border-slate-200">
              <td className={td}>
                <a href={awardUrl(c.award_key)} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:text-blue-600">{c.recipient_name}</a>
                {c.not_competed && <span className="ml-2 whitespace-nowrap rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700" title="Awarded without open bidding, per the federal record">Not competed</span>}
              </td>
              <td className={td}>{c.sub_agency ?? c.agency ?? "Not listed"}</td>
              <td className={`${td} whitespace-nowrap`}>{formatDollars(c.amount)}</td>
              <td className={`${td} whitespace-nowrap`}>{day(c.end_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The rest of the list: shown to a signed-in account, offered to everyone else. */
function FullList({ m, p, askNow }: { m: EndingMarket; p: EndingPublic; askNow: boolean }) {
  const [state, setState] = useState<"closed" | "loading" | "open" | "signin" | "failed">("closed");
  const [full, setFull] = useState<EndingFull | null>(null);
  const here = endingPath(m.stateName, m.trade);
  const load = async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/ending-list?state=${m.stateSlug}&trade=${m.trade}`, { credentials: "same-origin" });
      if (res.status === 401) return setState("signin");
      if (!res.ok) return setState("failed");
      setFull((await res.json()) as EndingFull);
      setState("open");
      trackEvent("ending_page_full_list", `${m.code}_${m.trade}`);
    } catch {
      setState("failed");
    }
  };
  // Back from creating an account: open the list without another click.
  useEffect(() => {
    if (askNow) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askNow]);

  if (state === "open" && full) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-10">
        <h2 className="text-xl font-bold text-slate-900">
          {full.full ? "The full list: " : "Your account: "}the {full.largest.length} largest contracts ending in the next 6 months
        </h2>
        <ContractTable rows={full.largest} />
        {full.full ? (
          <>
            <h2 className="mt-10 text-xl font-bold text-slate-900">Agencies with the most work ending</h2>
            <ol className="mt-3 max-w-2xl space-y-2 text-sm text-slate-700">
              {full.byAgency.map((a, i) => (
                <li key={a.agency} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <span>{i + 1}. {a.agency}</span>
                  <span className="whitespace-nowrap font-semibold text-slate-900">{formatDollars(a.total)} · {a.n.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
            <p className="font-semibold text-slate-900">
              {full.more > 0 ? `${full.more} more contracts and the agency breakdown` : "The agency breakdown"} come with the Pipeline Snapshot or Contrax Professional.
            </p>
            <p className="mt-1 text-sm text-slate-700">
              The Snapshot is the whole report prepared for you, {REPORT_PRICE} once, emailed within {REPORT_DELIVERY}.
            </p>
            <a
              href="/sample-report#order"
              onClick={() => trackEvent("ending_page_click", "snapshot_after_account")}
              className="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              See a sample and order →
            </a>
            <a href={RADAR_PRO_HREF} onClick={() => trackEvent("ending_page_click", "professional")} className="ml-4 text-sm font-semibold text-blue-700 hover:underline">
              Or see Professional →
            </a>
          </div>
        )}
      </section>
    );
  }
  const signup = `/signup?source=ending_page&state=${m.code}&next=${encodeURIComponent(`${here}?full=1`)}`;
  return (
    <section id="full-list" className="bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-xl font-bold text-slate-900">
          {p.more > 0 ? `${p.more} more contracts and the agency breakdown` : "The agency breakdown and the rest of the report"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-700">
          This page shows the {Math.min(ENDING_FREE_ROWS, p.top.length)} largest. A free account opens the {ENDING_ACCOUNT_ROWS} largest. The full list of up to 25,
          and which of {p.agencies.toLocaleString("en-US")} {p.agencies === 1 ? "agency has" : "agencies have"} the most work ending, come in the Pipeline Snapshot.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-bold text-slate-900">Free account</h3>
            <p className="mt-1 text-sm text-slate-700">Read the {ENDING_ACCOUNT_ROWS} largest on this page. No card.</p>
            <a
              href={signup}
              onClick={() => trackEvent("ending_page_click", "signup")}
              className="mt-4 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700"
            >
              Create a free account →
            </a>
            <p className="mt-3 text-sm text-slate-700">
              Already have one?{" "}
              <button type="button" onClick={() => void load()} disabled={state === "loading"} className="font-semibold text-blue-700 hover:underline">
                {state === "loading" ? "Loading…" : "Show my list"}
              </button>
            </p>
            {state === "signin" && (
              <p className="mt-2 text-sm text-slate-700">
                You are not signed in.{" "}
                <a href="/login" className="font-semibold text-blue-700 hover:underline">Sign in</a>, then come back to this page and choose "Show my list".
              </p>
            )}
            {state === "failed" && <p className="mt-2 text-sm text-red-700">The list did not load. Please try again in a minute.</p>}
          </div>
          <div className="rounded-xl border border-amber-300 bg-white p-5">
            <h3 className="font-bold text-slate-900">Pipeline Snapshot · {REPORT_PRICE} once</h3>
            <p className="mt-1 text-sm text-slate-700">
              The whole report prepared for you and emailed within {REPORT_DELIVERY}: the 25 contracts, the agencies, the companies holding the most
              and which of them must subcontract to small businesses, month by month, and up to 5 open bids.
            </p>
            <a
              href="/sample-report#order"
              onClick={() => trackEvent("ending_page_click", "snapshot")}
              className="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              See a sample and order →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContractsEnding() {
  const { market: m, page: p } = Route.useLoaderData();
  const { full } = Route.useSearch();
  if (!m) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="text-2xl font-bold text-slate-900">We do not have a page for that state and trade</h1>
          <p className="mt-3 text-slate-700"><a href="/contracts-ending" className="font-semibold text-blue-700 hover:underline">See every state and trade we cover →</a></p>
        </main>
      </>
    );
  }
  const lower = m.tradeLabel.toLowerCase();
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Contracts ending soon", item: `${PROD_URL}/contracts-ending` },
      { "@type": "ListItem", position: 2, name: `${m.tradeLabel} in ${m.stateName}`, item: `${PROD_URL}${endingPath(m.stateName, m.trade)}` },
    ],
  };
  return (
    <>
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-12 text-white">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">Federal contracts ending soon · {m.stateName}</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">Expiring federal {lower} contracts in {m.stateName}</h1>
            {p && p.totals.n > 0 ? (
              <>
                <p className="mt-3 max-w-2xl text-slate-300">
                  When a contract ends, the agency usually has to buy the work again. These are the ones ending by {day(p.until)}, from public records.
                </p>
                <dl className="mt-8 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Contracts ending by " + day(p.until), p.totals.n.toLocaleString("en-US")],
                    ["Their combined award value", formatDollars(p.totals.total)],
                    ["Companies holding them", p.totals.holders.toLocaleString("en-US")],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <dt className="text-xs text-slate-400">{k}</dt>
                      <dd className="mt-1 text-2xl font-bold">{v}</dd>
                    </div>
                  ))}
                </dl>
                {notCompetedNote(p.totals) && <p className="mt-4 max-w-2xl rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{notCompetedNote(p.totals)}</p>}
            <p className="mt-3 text-xs text-slate-400">As of {day(p.asOf)}. Source: USAspending.gov contract records.</p>
              </>
            ) : (
              <p className="mt-3 max-w-2xl text-slate-300">
                {p ? `Our records show no federal ${lower} contracts in ${m.stateName} ending in the next 12 months.` : "These numbers are being refreshed. Please check back shortly."}
              </p>
            )}
          </div>
        </section>

        {p && p.top.length > 0 && (
          <section className="mx-auto max-w-4xl px-4 py-10">
            <h2 className="text-xl font-bold text-slate-900">The {p.top.length === 1 ? "largest contract" : `${p.top.length} largest contracts`} ending in the next 6 months</h2>
            <p className="mt-1 text-sm text-slate-700">Each one links to its public record, so you can check it.</p>
            <ContractTable rows={p.top} />
          </section>
        )}

        {p?.priceRange && (
          <section className="mx-auto max-w-4xl px-4 pb-10">
            <h2 className="text-xl font-bold text-slate-900">What contracts like these were awarded for</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-700">
              Half of these contracts were awarded for between {formatDollars(p.priceRange.low)} and {formatDollars(p.priceRange.high)}. The midpoint
              is {formatDollars(p.priceRange.median)}. Use it to judge which ones are your size, not as a price to bid. A few very large umbrella
              contracts can make the combined total look bigger than the work one firm could win, so the midpoint is the better guide.
            </p>
          </section>
        )}

        {p && p.totals.n > 0 && <FullList m={m} p={p} askNow={full === 1} />}

        <section className="mx-auto max-w-4xl px-4 py-10">
          <h2 className="text-xl font-bold text-slate-900">Open {lower} bids in {m.stateName} right now</h2>
          {p && p.openBids.length ? (
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {p.openBids.map((b) => (
                <li key={b.id} className="rounded-lg border border-slate-200 p-3">
                  <a href={`/bid/${b.id}`} className="font-semibold text-blue-700 hover:text-blue-600">{b.title}</a>
                  <span className="block text-xs text-slate-600">{b.agency ?? "Agency not listed"} · due {day(b.due)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-700">None that fit are open today.</p>
          )}
          <p className="mt-3 text-sm">
            <a href={endingPath(m.stateName, m.trade).replace("/contracts-ending/", "/contracts-in/")} className="font-semibold text-blue-700 hover:underline">
              See every open {lower} bid in {m.stateName} →
            </a>
          </p>
          <p className="mt-8 text-sm text-slate-600">
            Award values are the amounts USAspending.gov reports, not yearly spending. An end date can move if an agency extends the contract,
            and an ending contract is a sign to prepare, not a promise that the work will be rebid.
          </p>
          <nav aria-label="Other trades" className="mt-8 border-t border-slate-200 pt-6 text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Other trades in {m.stateName}: </span>
            {ENDING_TRADES.filter((t) => t !== m.trade).map((t, i) => (
              <span key={t}>
                {i > 0 && " · "}
                <a href={endingPath(m.stateName, t)} className="text-blue-700 hover:underline">{SEO_TRADE_BY_SLUG[t].label}</a>
              </span>
            ))}
            <span> · <a href="/contracts-ending" className="text-blue-700 hover:underline">All states</a></span>
          </nav>
        </section>
      </main>
    </>
  );
}
