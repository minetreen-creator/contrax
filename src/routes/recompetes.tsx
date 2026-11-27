import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { fmtEndDate, RecompeteRow } from "~/components/FederalTradeFacts";
import { STATE_NAMES } from "~/lib/contract-map";
import { awardUrl, formatDollars, RECOMPETE_MONTH_CHOICES, type Recompete } from "~/lib/federal-trade-data";
import { FEATURED_CTA, FEATURED_HIDDEN_LABEL, FEATURED_LEAD, FEATURED_PRIVATE_NOTE, featuredEnding, pickFeatured, type FeaturedEnding } from "~/lib/ending-featured";
import { ENDING_ACCOUNT_ROWS } from "~/lib/ending-pages";
import { RADAR_PRO_HREF, RADAR_PRO_PRICE_NOTE } from "~/lib/plan-gates";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { tradeAlertProfile } from "~/lib/bid-alert";

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
// Owner 2026-11-14 ("1"): one rule on both ending-contract pages. A visitor sees a few, a free
// account sees 10 (ENDING_ACCOUNT_ROWS), Professional sees everything.
const ACCOUNT_ROWS = ENDING_ACCOUNT_ROWS;
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
      result = await queryRecompetes({ ...data, limit: hasAccess ? FULL_LIMIT : signedIn ? ACCOUNT_ROWS : PREVIEW_ROWS });
    } catch (e) {
      console.error("[recompetes] query failed:", e);
      failed = true;
    }
    // Owner 2026-11-27 ("do it"): one real contract at the top, the holder hidden until the visitor
    // has an account. The name, award number and record link are removed here, on the server.
    let featured: FeaturedEnding | null = null;
    if (!failed && result.count > 0) {
      try {
        const { largestRecompetes } = await import("~/lib/federal-trade-data.server");
        const candidates = await largestRecompetes({ ...data, limit: PREVIEW_ROWS + ACCOUNT_ROWS + 1 });
        featured = featuredEnding(pickFeatured(candidates, result.rows.map((r) => r.award_key)), signedIn, SEO_TRADE_BY_SLUG[data.trade]?.label ?? "Federal");
      } catch (e) {
        console.error("[recompetes] featured contract failed (hidden):", (e as Error).message);
      }
    }
    return { ...data, ...result, hasAccess, signedIn, failed, featured };
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

/** One real contract, shown like a record card. The holder is a black bar until the viewer has an account. */
function FeaturedContract({ f, signupHref, note, onCta }: { f: FeaturedEnding; signupHref: string; note: string; onCta: () => void }) {
  return (
    <div className="mt-6">
      <p className="text-lg font-bold text-slate-900">{FEATURED_LEAD}</p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-300 border-t-4 border-t-amber-500 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Federal contract · USAspending.gov record</p>
        <p className="mt-2 text-xl font-extrabold leading-snug text-slate-900 sm:text-2xl">{f.title}</p>
        {f.agency && <p className="mt-1 text-sm text-slate-600">{f.agency}</p>}
        <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Contract value</p>
            <p className="mt-1 inline-block bg-amber-200 px-1 text-3xl font-extrabold text-slate-900">{formatDollars(f.amount)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Contract ends</p>
            <p className="mt-1 text-2xl font-extrabold text-red-700">{fmtEndDate(f.end_date)}</p>
          </div>
        </div>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Held by</p>
          {f.holder ? (
            <>
              <p className="mt-1 text-lg font-bold text-slate-900">{f.holder}</p>
              {f.award_key && (
                <a href={awardUrl(f.award_key)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-blue-700 hover:underline">
                  View contract {f.award_id} on USAspending.gov
                </a>
              )}
            </>
          ) : (
            <>
              <p className="mt-1">
                <span role="img" aria-label={FEATURED_HIDDEN_LABEL} className="inline-block h-7 w-56 max-w-full rounded-sm bg-slate-900 align-middle" />
              </p>
              <a href={signupHref} onClick={onCta} className="mt-3 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800">
                {FEATURED_CTA}
              </a>
            </>
          )}
        </div>
        <p className="mt-4 text-xs text-slate-500">{note} {FEATURED_PRIVATE_NOTE}</p>
      </div>
    </div>
  );
}

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
        {d.featured && (
          <FeaturedContract
            f={d.featured}
            signupHref={`/signup?source=recompetes_featured&next=${encodeURIComponent(here)}`}
            note={`The largest ${lower} contract in ${where} ending in the next ${d.months} months that is not listed below.`}
            onCta={() => trackEvent("recompetes_featured_click", d.trade)}
          />
        )}
        <p className="mt-4 text-lg text-slate-700">
          When a federal contract ends, the agency usually buys the work again, and the new solicitation often appears only weeks before it is due.
          This list shows contracts in your trade whose end date is coming up, who holds them now and what they are worth, so you can prepare early.
        </p>
        <p className="mt-2 text-sm">
          <a href="/gap-map" className="font-semibold text-emerald-700 hover:text-emerald-800">
            See the gap map: which states have big spending and few companies holding the work →
          </a>{" "}
          <a href="/prime-finder" className="font-semibold text-blue-700 hover:text-blue-800">
            Find primes to subcontract with →
          </a>
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
                  The full list, with every holder, agency, value and end date, is part of Contrax Professional.
                </p>
                <a
                  href={d.signedIn ? RADAR_PRO_HREF : `/signup?source=recompetes&next=${encodeURIComponent(here)}`}
                  onClick={() => trackEvent(d.signedIn ? "recompetes_upgrade_click" : "recompetes_signup_click", d.trade)}
                  className="mt-3 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800"
                >
                  {d.signedIn ? "Upgrade to see the full list" : `Create a free account to see ${ACCOUNT_ROWS}`}
                </a>
                {d.signedIn && <p className="mt-2 text-xs text-slate-500">{RADAR_PRO_PRICE_NOTE}</p>}
                {/* Owner 2026-11-14: a visitor who will not make an account can still have the list prepared. */}
                <p className="mt-3 text-sm text-slate-700">
                  Rather have it prepared for you?{" "}
                  <a href="/sample-report?source=recompetes" onClick={() => trackEvent("recompetes_report_click", d.trade)} className="font-semibold text-blue-700 underline hover:text-blue-600">
                    Read a real report
                  </a>
                  .
                </p>
              </div>
            )}
            {/* Owner 2026-10-19: a lighter ask than an account for visitors who
                browse ending contracts. Hidden for signed-in users. */}
            <BidAlertCapture
              alertProfile={tradeAlertProfile(trade, d.state ?? null)}
              source="recompetes"
              heading="Not ready for an account? Get new bids by email"
              note="When one of these contracts is rebid, the new solicitation is the kind of bid we'll send. Once a week we also tell you which contracts here have come inside six months of ending."
              tone="light"
            />
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
