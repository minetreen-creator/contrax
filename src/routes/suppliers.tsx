import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { PLAN_COPY } from "~/lib/plan-features";
import { trackEvent } from "~/lib/track";

/**
 * /suppliers — the Agency plan for material suppliers and equipment rental (owner 2026-11-12: "lift it for
 * suppliers", "$199 it is"). Concrete plants, supply houses and rental yards want the public jobs in their
 * territory before they are bid, so they can quote the contractors chasing them. Same plan and price as
 * /consultants; a workspace here is a territory or a branch. The contractor pages keep their single offer
 * (src/lib/one-product.test.ts), so nothing links here from them.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Public Construction Jobs for Material Suppliers and Equipment Rental | Contrax";
const DESC =
  "See the government construction, paving, concrete and site jobs bidding in your territory, before the contractors call you for a quote. For concrete plants, supply houses and equipment rental yards.";

/** Words in a bid title that mean materials or equipment on site. */
const SUPPLIER_JOB_SQL = String.raw`(title ~* '\m(concrete|paving|asphalt|sidewalk|curb|bridge|culvert|road|street|site ?work|excavat\w*|grading|storm ?water|drainage|water ?line|sewer|utility|demolition|renovation|construction|building|roof\w*|hvac|plumbing|electrical)\M')`;

const getCounts = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sql } = await import("~/db");
    const { LOW_CONTENT_SQL } = await import("~/lib/low-content");
    const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
    const s = sql();
    const r = (await s`
      SELECT COUNT(*)::int AS open, COUNT(DISTINCT normalized_state)::int AS states
      FROM bids WHERE due_date > NOW() AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
        AND ${s.unsafe(SUPPLIER_JOB_SQL)}`) as { open: number; states: number }[];
    return r[0] ?? null;
  } catch {
    return null;
  }
});

export const Route = createFileRoute("/suppliers")({
  loader: () => getCounts(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/suppliers` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/suppliers` }],
  }),
  component: SuppliersPage,
});

const STEPS: [string, string][] = [
  ["Set up each territory once", "The states and trades your branch or sales rep covers. Up to 10 territories on one login."],
  ["See the jobs before the calls", "Each territory lists the open public jobs that use what you sell: paving, concrete, site work, buildings, utilities."],
  ["Know who is buying and when", "The agency, the due date and the official bid documents, so your rep knows which contractors to call before the bid closes."],
  ["Plan the next round", "Contracts ending soon show which jobs come back up for bid, and who holds them now."],
];

function SuppliersPage() {
  const counts = Route.useLoaderData();
  const plan = PLAN_COPY.agency;
  const features = plan.features.filter((f) => !/^Or \$/.test(f) && f !== "Cancel anytime");
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-14 text-white sm:py-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For concrete plants, supply houses and equipment rental</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-5xl">Know the public jobs in your territory before the contractors call for a quote</h1>
            <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
              Contrax reads federal, state, county and city bid boards every weekday. Set up each territory once and see the
              paving, concrete, site and building jobs bidding there, who is buying, and when bids are due.
            </p>
            {counts && counts.open > 0 && (
              <dl className="mt-8 grid max-w-md grid-cols-2 gap-3">
                {[
                  ["Open construction-type jobs", counts.open.toLocaleString("en-US")],
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
              href="/upgrade?plan=agency&source=suppliers"
              onClick={() => trackEvent("suppliers_cta_click", "hero")}
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
            A workspace here is a territory or a branch. Each one belongs to your login; it is not an extra user seat.
          </p>
          <a
            href="/upgrade?plan=agency&source=suppliers"
            onClick={() => trackEvent("suppliers_cta_click", "features")}
            className="mt-6 inline-block rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            Start the Agency plan →
          </a>
        </section>
      </main>
    </>
  );
}
