import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { fmtEndDate, RecompeteRow } from "~/components/FederalTradeFacts";
import { STATE_NAMES } from "~/lib/contract-map";
import { formatDollars, RECOMPETE_MONTH_CHOICES, type Recompete } from "~/lib/federal-trade-data";
import { RADAR_PRO_HREF, RADAR_PRO_PRICE_NOTE } from "~/lib/plan-gates";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * /recompetes — Contracts Ending Soon (owner 2026-10-13, USAspending idea #1).
 * Federal contracts in a trade whose current end date falls in the next 6, 12
 * or 18 months, with the holder and value, so a small business can prepare
 * before the rebid reaches SAM.gov. Every row is a public USAspending.gov
 * record with a link to check it. The full list is a Professional feature
 * (including the 7-day trial); everyone else sees the count and the first 3.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Federal Contracts Ending Soon by Trade and State | Contrax";
const DESC =
  "Federal janitorial, security, construction, HVAC, IT and other contracts whose end date is in the next 6 to 18 months, with the current holder and value. Prepare before the rebid is posted.";
const PREVIEW_ROWS = 3;
const FULL_LIMIT = 500;

interface Search {
  trade: string;
  state: string | null;
  months: number;
}

function parseSearch(search: Record<string, unknown>): Search {
  const trade = typeof search.trade === "string" && SEO_TRADE_BY_SLUG[search.trade] ? search.trade : "janitorial";
  const st = typeof search.state === "string" ? search.state.toUpperCase() : "";
  const m = Number(search.months);
  return {
    trade,
    state: STATE_NAMES[st] ? st : null,
    months: (RECOMPETE_MONTH_CHOICES as readonly number[]).includes(m) ? m : 12,
  };
}

const getRecompetesPage = createServerFn({ method: "GET" })
  .validator((d: unknown) => parseSearch((d ?? {}) as Record<string, unknown>))
  .handler(async ({ data }) => {
    let hasAccess = false;
    let signedIn = false;
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      const user = await getCurrentUser();
      if (user) {
        signedIn = true;
        const { hasProfessionalAccess, loadUserTrialStatus } = await import("~/lib/trial");
        hasAccess = hasProfessionalAccess(await loadUserTrialStatus(user.id), user);
      }
    } catch {
      /* page still renders for visitors; fail closed on access */
    }
    let result: { count: number; total: number; rows: Recompete[] } = { count: 0, total: 0, rows: [] };
    let failed = false;
    try {
      const { queryRecompetes } = await import("~/lib/federal-trade-data.server");
      result = await queryRecompetes({ ...data, limit: hasAccess ? FULL_LIMIT : PREVIEW_ROWS });
    } catch (e) {
      console.error("[recompetes] query failed:", e);
      failed = true;
    }
    return { ...data, ...result, hasAccess, signedIn, failed };
  });

export const Route = createFileRoute("/recompetes")({
  validateSearch: (search: Record<string, unknown>) => parseSearch(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getRecompetesPage({ data: deps }),
  component: () => (
    <>
      <SiteHeader />
      <RecompetesPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/recompetes` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/recompetes` }],
  }),
});

const STATE_OPTIONS = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

function RecompetesPage() {
  const d = Route.useLoaderData();
  const trade = SEO_TRADE_BY_SLUG[d.trade];
  const lower = (trade?.label ?? "").toLowerCase();
  const where = d.state ? STATE_NAMES[d.state] : "the U.S.";
  const here = `/recompetes?trade=${d.trade}&months=${d.months}${d.state ? `&state=${d.state}` : ""}`;
  const locked = !d.hasAccess && d.count > d.rows.length;
  const last = d.rows[d.rows.length - 1];
  return (
    <main className="bg-slate-50">
      <section className="mx-auto max-w-4xl px-4 pb-6 pt-12">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Contracts Ending Soon</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">See which federal contracts are about to end</h1>
        <p className="mt-4 text-lg text-slate-700">
          When a federal contract ends, the agency usually buys the work again, and the new solicitation often appears only weeks before it is due.
          This list shows contracts in your trade whose end date is coming up, who holds them now and what they are worth, so you can prepare early.
        </p>

        <form method="get" action="/recompetes" className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">
            Trade
            <select name="trade" defaultValue={d.trade} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2">
              {SEO_TRADES.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            State
            <select name="state" defaultValue={d.state ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2">
              <option value="">All states</option>
              {STATE_OPTIONS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Ending within
            <select name="months" defaultValue={String(d.months)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2">
              {RECOMPETE_MONTH_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="self-end rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">
            Show contracts
          </button>
        </form>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-10">
        {d.failed ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">The list could not load. Please try again in a minute.</p>
        ) : d.count === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No {lower} contracts in {where} with an end date in the next {d.months} months are on file. Try a longer window or all states.
          </p>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-900">
              {d.count.toLocaleString("en-US")} {lower} contract{d.count === 1 ? "" : "s"} in {where} end in the next {d.months} months
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Worth {formatDollars(d.total)} together. Soonest end date first
              {d.hasAccess && d.count > d.rows.length ? `, showing the first ${d.rows.length}` : ""}.
            </p>
            <ul className="mt-4 grid gap-3">
              {d.rows.map((c) => (
                <RecompeteRow key={c.award_key} c={c} />
              ))}
            </ul>
            {locked && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="font-semibold text-slate-900">
                  {(d.count - d.rows.length).toLocaleString("en-US")} more {lower} contract{d.count - d.rows.length === 1 ? "" : "s"} end
                  {last ? ` after ${fmtEndDate(last.end_date)}` : ""}.
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  The full list, with every holder, agency, value and end date, is part of Contrax Professional. Every new account includes a 7-day
                  Professional trial with no card required.
                </p>
                <a
                  href={d.signedIn ? RADAR_PRO_HREF : `/signup?source=recompetes&next=${encodeURIComponent(here)}`}
                  onClick={() => trackEvent(d.signedIn ? "recompetes_upgrade_click" : "recompetes_signup_click", d.trade)}
                  className="mt-3 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800"
                >
                  {d.signedIn ? "Upgrade to see the full list" : "Create an account to see the full list"}
                </a>
                {d.signedIn && <p className="mt-2 text-xs text-slate-500">{RADAR_PRO_PRICE_NOTE}</p>}
              </div>
            )}
          </>
        )}
        <p className="mt-8 text-xs text-slate-500">
          Source: USAspending.gov contract records (definitive contracts and purchase orders of $25,000 or more), by place of performance,
          refreshed every weekday. The end date is the current end date on file. An agency can extend a contract, exercise options or decide not
          to buy the work again, so an end date does not promise a new solicitation.
        </p>
      </section>
    </main>
  );
}
