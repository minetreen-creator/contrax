import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * /subs-wanted — the Subs Wanted board (owner 2026-11-10: "build the subs wanted board"). Open Trade
 * Packages whose owners chose to list them, public or private work, so subs can find jobs on their own.
 * Each job opens its Trade Package page, where the sub sends a quote. Shows company, trade, place,
 * scope and due date only: never an email or phone. Contrax doesn't verify companies or licenses.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Subs Wanted: Subcontractor Jobs by Trade and State | Contrax";
const DESC = "Contractors looking for subs right now: HVAC, electrical, plumbing, construction, janitorial and more, by state. Open the job and send your quote.";
const REPORT_EMAIL = "contrax.companyllc@gmail.com";

const getBoard = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const o = (d ?? {}) as { trade?: unknown; state?: unknown };
    const trade = String(o.trade ?? "");
    const state = String(o.state ?? "").toUpperCase();
    return { trade: SEO_TRADE_BY_SLUG[trade] ? trade : "", state: STATE_NAMES[state] ? state : "" };
  })
  .handler(async ({ data }) => {
    const { boardJobs } = await import("~/lib/sub-finder.server");
    const jobs = await boardJobs({ trade: data.trade ? SEO_TRADE_BY_SLUG[data.trade].label : null, state: data.state || null });
    return { ...data, jobs };
  });

export const Route = createFileRoute("/subs-wanted")({
  validateSearch: (s: Record<string, unknown>) => ({
    trade: typeof s.trade === "string" ? s.trade : undefined,
    state: typeof s.state === "string" ? s.state : undefined,
  }),
  loaderDeps: ({ search }) => ({ trade: search.trade ?? "", state: search.state ?? "" }),
  loader: ({ deps }) => getBoard({ data: deps }),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: `${PROD_URL}/subs-wanted` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/subs-wanted` }],
  }),
  component: BoardPage,
});

const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const daysAgo = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

function BoardPage() {
  const { trade, state, jobs } = Route.useLoaderData();
  const tradeLabel = trade ? SEO_TRADE_BY_SLUG[trade]?.label ?? "" : "";
  const stateName = state ? STATE_NAMES[state] ?? state : "";
  const link = (t: string, s: string) => {
    const q = new URLSearchParams();
    if (t) q.set("trade", t);
    if (s) q.set("state", s);
    const qs = q.toString();
    return `/subs-wanted${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/sub-finder" className="hover:underline">Sub Finder</a> · Subs Wanted
        </p>
        <h1 className="mt-1 text-3xl font-bold">
          Subs wanted{tradeLabel ? ` · ${tradeLabel}` : ""}{stateName ? ` · ${stateName}` : ""}
        </h1>
        <p className="mt-2 text-slate-700">
          Contractors looking for subcontractors right now, on public and private jobs. Open a job to see the scope and send your quote straight to the contractor.
        </p>

        <form method="get" action="/subs-wanted" className="mt-5 flex flex-wrap gap-2 text-sm">
          <select name="trade" defaultValue={trade} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
            <option value="">All trades</option>
            {SEO_TRADES.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
          </select>
          <select name="state" defaultValue={state} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
            <option value="">All states</option>
            {Object.entries(STATE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white">Show jobs</button>
        </form>

        {jobs.length ? (
          <ul className="mt-6 space-y-3">
            {jobs.map((j) => (
              <li key={j.slug} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    {j.trade} · {[j.location, STATE_NAMES[j.state] ?? j.state].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-xs text-slate-500">
                    Posted {daysAgo(j.postedAt)}
                    {j.quotesDue ? ` · Quotes due ${fmtDate(j.quotesDue)}` : ""}
                  </p>
                </div>
                <p className="mt-1 text-base font-bold text-slate-900">{j.title}</p>
                <p className="text-xs text-slate-600">{j.company}</p>
                <p className="mt-2 line-clamp-3 text-slate-700">{j.scope}</p>
                <a
                  href={`/trade-package/${j.slug}`}
                  onClick={() => trackEvent("subs_wanted_open", j.slug)}
                  className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                >
                  See the job and send a quote →
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-700">
            <p className="font-semibold">
              No open jobs{tradeLabel ? ` for ${tradeLabel.toLowerCase()}` : ""}{stateName ? ` in ${stateName}` : ""} on the board right now.
            </p>
            <p className="mt-1">
              {trade || state ? (
                <a href={link("", "")} className="font-semibold text-blue-700">See every open job →</a>
              ) : (
                "New jobs show up here as contractors post them."
              )}
            </p>
          </div>
        )}

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border-2 border-slate-900 bg-white p-4 text-sm">
            <h2 className="font-bold">Need a sub?</h2>
            <p className="mt-1 text-slate-700">Describe the job once in a Trade Package, check "post it on the Subs Wanted board", and share the link. Quotes come back to you in one place.</p>
            <a href="/sub-finder" onClick={() => trackEvent("subs_wanted_post_cta", "board")} className="mt-2 inline-block font-semibold text-blue-700">
              Post a job in Sub Finder →
            </a>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <h2 className="font-bold">Are you a sub?</h2>
            <p className="mt-1 text-slate-700">Get listed so contractors can find you and ask for your quote, even before they post here.</p>
            <a href="/sub-finder/join" className="mt-2 inline-block font-semibold text-blue-700">Get listed →</a>
          </div>
        </section>

        <p className="mt-6 text-xs text-slate-500">
          Jobs are posted by the contractors named on them. Contrax doesn't verify companies, licenses or pay; check them before you work together. See something wrong?{" "}
          <a href={`mailto:${REPORT_EMAIL}?subject=${encodeURIComponent("Subs Wanted board report")}`} className="underline">Tell us</a>.
        </p>
      </main>
    </div>
  );
}
