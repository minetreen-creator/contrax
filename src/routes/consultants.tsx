import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { PLAN_COPY } from "~/lib/plan-features";
import { trackEvent } from "~/lib/track";

/**
 * /consultants — the Agency plan for bid consultants and proposal writers (owner 2026-11-12: "different
 * kind of customer"). The plan has been on sale since 2026-10-20 at /upgrade?plan=agency but had no page
 * a consultant could find. Search engines and AI assistants find this page; the contractor pages keep
 * their single offer (src/lib/one-product.test.ts), so nothing links here from them.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Government Bid Tracking for Consultants and Proposal Writers | Contrax";
const DESC =
  "One login for up to 10 client workspaces: each client's own open-bid matches, saved bids and pipeline, plus a dashboard of every client's deadlines. For bid consultants and proposal writers.";

const getCounts = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const { LOW_CONTENT_SQL } = await import("~/lib/low-content");
    const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
    const s = sql();
    const r = (await s`
      SELECT COUNT(*)::int AS open, COUNT(DISTINCT normalized_state)::int AS states
      FROM bids WHERE due_date > NOW() AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}`) as { open: number; states: number }[];
    return r[0] ?? null;
  } catch {
    return null;
  }
});

export const Route = createFileRoute("/consultants")({
  loader: () => getCounts(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/consultants` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/consultants` }],
  }),
  component: ConsultantsPage,
});

const STEPS: [string, string][] = [
  ["Add each client once", "Their states, trades and certifications. Up to 10 clients on one login."],
  ["Switch between clients", "Each workspace has its own matched bids, saved bids and pipeline, so one client's list never mixes with another's."],
  ["See every deadline in one place", "A dashboard row per client: due this week, past due, moving, or gone quiet."],
  ["Hand off cleanly", "Export a client's saved bids and contacts as a spreadsheet whenever they need it."],
];

function ConsultantsPage() {
  const counts = Route.useLoaderData();
  const plan = PLAN_COPY.agency;
  const features = plan.features.filter((f) => !/^Or \$/.test(f) && f !== "Cancel anytime");
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-14 text-white sm:py-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For bid consultants and proposal writers</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-5xl">Track open government bids for every client from one login</h1>
            <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
              Set up each client once. Contrax matches open federal, state and local bids to each of them, keeps their saved bids
              and pipeline apart, and shows you every client's deadlines on one screen.
            </p>
            {counts && counts.open > 0 && (
              <dl className="mt-8 grid max-w-md grid-cols-2 gap-3">
                {[
                  ["Open bids now", counts.open.toLocaleString("en-US")],
                  ["States and territories", String(counts.states)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <dt className="text-xs text-slate-400">{k}</dt>
                    <dd className="mt-1 text-2xl font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <a
              href="/upgrade?plan=agency&source=consultants"
              onClick={() => trackEvent("consultants_cta_click", "hero")}
              className="mt-8 inline-block rounded-xl bg-amber-500 px-6 py-3 font-bold text-slate-950 hover:bg-amber-400"
            >
              Start the Agency plan: $199 a month →
            </a>
            <p className="mt-2 text-xs text-slate-400">Month to month. Cancel anytime. Or $1,990 a year.</p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12">
          <h2 className="text-xl font-bold text-slate-900">How it works</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-bold text-slate-900">{i + 1}. {t}</p>
                <p className="mt-1 text-sm text-slate-700">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-12">
          <h2 className="text-xl font-bold text-slate-900">What the Agency plan includes</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {features.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-600">
            Each workspace belongs to your login. It is a client file, not an extra user seat.
          </p>
          <a
            href="/upgrade?plan=agency&source=consultants"
            onClick={() => trackEvent("consultants_cta_click", "features")}
            className="mt-6 inline-block rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            Start the Agency plan →
          </a>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-16">
          <h2 className="text-xl font-bold text-slate-900">Need the bids as data instead?</h2>
          <p className="mt-2 text-sm text-slate-700">
            If you would rather pull bids into your own tools, the{" "}
            <a href="/data" className="font-semibold text-blue-700 hover:underline">bid data API</a> delivers them as JSON.
          </p>
        </section>
      </main>
    </>
  );
}
