import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { money } from "~/lib/gap-map";
import { RADAR_PRO_HREF, RADAR_PRO_PRICE_NOTE } from "~/lib/plan-gates";
import { approachTiming, introEmail, type IntroProfile, type PrimeRow } from "~/lib/prime-finder";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { trackEvent } from "~/lib/track";

/**
 * /prime-finder — Prime Contractor Finder (owner 2026-11-09). For one trade and state: the
 * companies holding active federal contracts there, the ones with an SBA or GSA subcontracting
 * plan first (they must give part of the work to small businesses), what they hold, for which
 * agencies, and when their next contract ends. Each prime has an intro email draft built from the
 * member's own profile; the member sends it (Contrax never emails primes). Like /recompetes,
 * everyone sees the counts and the first 3; the full list is part of Professional.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Find Prime Contractors to Subcontract With, by Trade and State | Contrax";
const DESC =
  "The large prime contractors holding federal janitorial, security, construction, HVAC, IT and other contracts in your state, which ones must subcontract to small businesses, and when their contracts come up.";
const PREVIEW_ROWS = 3;
const FULL_LIMIT = 300;

const STATE_OPTIONS = Object.entries(STATE_NAMES)
  .filter(([c]) => c.length === 2 && !["PR", "GU", "VI", "AS", "MP"].includes(c))
  .sort((a, b) => a[1].localeCompare(b[1]));

function parseSearch(search: Record<string, unknown>): { trade: string; state: string } {
  const trade = typeof search.trade === "string" && SEO_TRADE_BY_SLUG[search.trade] ? search.trade : "janitorial";
  const st = typeof search.state === "string" ? search.state.toUpperCase() : "";
  return { trade, state: STATE_NAMES[st] ? st : "VA" };
}

const getPrimeFinder = createServerFn({ method: "GET" })
  .validator((d: unknown) => parseSearch((d ?? {}) as Record<string, unknown>))
  .handler(async ({ data }) => {
    let hasAccess = false;
    let signedIn = false;
    let profile: IntroProfile | null = null;
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      const user = await getCurrentUser();
      if (user) {
        signedIn = true;
        const { hasProfessionalAccess, loadUserTrialStatus } = await import("~/lib/trial");
        hasAccess = hasProfessionalAccess(await loadUserTrialStatus(user.id), user);
        const { loadIntroProfile } = await import("~/lib/prime-finder.server");
        profile = await loadIntroProfile(user.id);
      }
    } catch {
      /* visitors still see the page; access fails closed */
    }
    try {
      const { loadPrimes } = await import("~/lib/prime-finder.server");
      const all = await loadPrimes(data.trade, data.state);
      return {
        ...data,
        total: all.length,
        withPlan: all.filter((p) => p.hasPlan).length,
        rows: all.slice(0, hasAccess ? FULL_LIMIT : PREVIEW_ROWS),
        hasAccess,
        signedIn,
        profile,
        failed: false,
      };
    } catch (e) {
      console.error("[prime-finder] load failed:", e);
      return { ...data, total: 0, withPlan: 0, rows: [] as PrimeRow[], hasAccess, signedIn, profile, failed: true };
    }
  });

export const Route = createFileRoute("/prime-finder")({
  validateSearch: (search: Record<string, unknown>) => parseSearch(search),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getPrimeFinder({ data: deps }),
  component: () => (
    <>
      <SiteHeader />
      <PrimeFinderPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/prime-finder` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/prime-finder` }],
  }),
});

function PrimeFinderPage() {
  const d = Route.useLoaderData();
  const trade = SEO_TRADE_BY_SLUG[d.trade];
  const lower = trade.label.toLowerCase();
  const stateName = STATE_NAMES[d.state];
  const [draftFor, setDraftFor] = useState<PrimeRow | null>(null);
  const locked = !d.hasAccess && d.total > d.rows.length;
  const here = `/prime-finder?trade=${d.trade}&state=${d.state}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Prime contractor finder</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">Work under the primes that already hold the contracts</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Large prime contractors hold much of the federal work, and many must give part of it to small businesses under a subcontracting plan.
        Here are the companies holding federal {lower} contracts in {stateName}, the ones required to subcontract first, with when their next contract ends.
      </p>

      <form method="get" action="/prime-finder" className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-sm">
          <span className="block text-xs text-slate-500">Trade</span>
          <select name="trade" defaultValue={d.trade} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5">
            {SEO_TRADES.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">State</span>
          <select name="state" defaultValue={d.state} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5">
            {STATE_OPTIONS.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          Find primes
        </button>
      </form>

      {d.failed ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The list could not load just now. Please try again in a minute.</p>
      ) : d.total === 0 ? (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
          No active federal {lower} contracts in {stateName} end in the next 18 months. Try a nearby state or another trade.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-slate-800">
            <strong>{d.total.toLocaleString("en-US")}</strong> compan{d.total === 1 ? "y holds" : "ies hold"} active federal {lower} contracts in {stateName};{" "}
            <strong>{d.withPlan}</strong> {d.withPlan === 1 ? "has" : "have"} a subcontracting plan and must give part of the work to small businesses.
          </p>
          <ul className="mt-3 space-y-3">
            {d.rows.map((p) => (
              <PrimeCard key={p.uei} p={p} onDraft={() => { setDraftFor(p); trackEvent("prime_finder_draft", `${d.trade}:${d.state}`); }} />
            ))}
          </ul>
          {locked && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="font-semibold text-slate-900">
                {(d.total - d.rows.length).toLocaleString("en-US")} more compan{d.total - d.rows.length === 1 ? "y" : "ies"} hold {lower} work in {stateName}
                {d.withPlan > PREVIEW_ROWS ? `, including ${d.withPlan - Math.min(d.withPlan, PREVIEW_ROWS)} more that must subcontract` : ""}.
              </p>
              <p className="mt-1 text-sm text-slate-700">The full list, with every prime, agency, value, end date and intro email, is part of Contrax Professional.</p>
              <a
                href={d.signedIn ? RADAR_PRO_HREF : `/signup?source=prime_finder&next=${encodeURIComponent(here)}`}
                onClick={() => trackEvent(d.signedIn ? "prime_finder_upgrade_click" : "prime_finder_signup_click", d.trade)}
                className="mt-3 inline-block rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800"
              >
                {d.signedIn ? "Upgrade to see every prime" : "Create an account to see every prime"}
              </a>
              {d.signedIn && <p className="mt-2 text-xs text-slate-500">{RADAR_PRO_PRICE_NOTE}</p>}
            </div>
          )}
        </>
      )}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">How to approach a prime</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>Register in the prime's supplier portal: search the company name with "supplier diversity" or "small business program".</li>
          <li>Send your capability statement to their small business liaison, naming the contract or agency you can support.</li>
          <li>Time it: 3 to 12 months before a contract ends is when primes line up teammates for the rebid.</li>
          <li>Follow up when the rebid is posted, and watch subcontracting postings on the{" "}
            <a href="/subcontracts" className="font-semibold text-blue-700 hover:text-blue-800">subcontracting board</a>.
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Sources: USAspending.gov (active contracts ending in the next 18 months, by place of performance) and the SBA and GSA directories of prime contractors
          with subcontracting plans. Contrax does not contact primes for you.
        </p>
      </section>

      {draftFor && (
        <DraftModal
          p={draftFor}
          tradeLabel={trade.label}
          stateName={stateName}
          profile={d.profile}
          signedIn={d.signedIn}
          onClose={() => setDraftFor(null)}
        />
      )}
    </main>
  );
}

function PrimeCard({ p, onDraft }: { p: PrimeRow; onDraft: () => void }) {
  const t = approachTiming(p.nextEnd);
  const tone = { now: "text-emerald-700", soon: "text-blue-700", later: "text-slate-500", late: "text-amber-700" }[t.tone];
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">{p.name}</p>
          {p.parent ? <p className="text-xs text-slate-500">Part of {p.parent}</p> : null}
        </div>
        {p.hasPlan ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Must subcontract (has a subcontracting plan)</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">No subcontracting plan on file</span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-700">
        {p.contracts} active contract{p.contracts === 1 ? "" : "s"} · {money(p.value)}
        {p.agencies.length ? ` · ${p.agencies.join(", ")}` : ""}
      </p>
      <p className={`mt-1 text-xs font-medium ${tone}`}>{t.label}</p>
      <button type="button" onClick={onDraft} className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:border-slate-500">
        Draft my intro email
      </button>
    </li>
  );
}

function DraftModal({ p, tradeLabel, stateName, profile, signedIn, onClose }: {
  p: PrimeRow; tradeLabel: string; stateName: string; profile: IntroProfile | null; signedIn: boolean; onClose: () => void;
}) {
  const draft = introEmail(p, tradeLabel, stateName, profile ?? {});
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Intro email draft">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Intro email to {p.name}</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {profile ? "Filled in from your business profile. Edit anything in brackets, then send it yourself." : signedIn ? "Add your business profile to fill this in. Edit anything in brackets, then send it yourself." : "Sign in with a business profile to fill this in. Edit anything in brackets, then send it yourself."}
        </p>
        <p className="mt-3 text-xs font-semibold text-slate-500">Subject</p>
        <p className="text-sm text-slate-900">{draft.subject}</p>
        <textarea readOnly value={draft.body} rows={16} className="mt-3 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-800" />
        <button type="button" onClick={copy} className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          {copied ? "Copied" : "Copy email"}
        </button>
      </div>
    </div>
  );
}
