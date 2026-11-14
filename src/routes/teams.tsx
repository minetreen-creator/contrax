import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { PLAN_COPY } from "~/lib/plan-features";
import { trackEvent } from "~/lib/track";

/**
 * /teams — the Professional plan for companies with someone responsible for government sales
 * (owner 2026-11-14: "a big pivot"). A day of outreach showed very small contractors do not answer
 * email or pay $5; a company with a sales or proposal person has a budget and already believes the
 * work is worth chasing. Everything on this page is what Professional ships today: Contracts Ending
 * Soon, forecasts, incumbents and past pricing, briefs, match scoring, drafting and the CRM.
 * Like /consultants, it is found by search and by direct outreach; the contractor pages keep their
 * single offer (src/lib/one-product.test.ts), so nothing links here from them.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Government Contract Intelligence for Sales Teams | Contrax";
const DESC =
  "See which government contracts are ending and who holds them before the next bid is posted. Then qualify each one with a brief, incumbent pricing and a match score, and draft the response.";

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

export const Route = createFileRoute("/teams")({
  loader: () => getCounts(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/teams` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/og/general.png` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/teams` }],
  }),
  component: TeamsPage,
});

/** The three stages, each with what Contrax does in it and a page a visitor can open without an account. */
const STAGES: { step: string; title: string; body: string; points: string[]; href: string; link: string }[] = [
  {
    step: "1",
    title: "See it before it is posted",
    body: "Most teams learn about a contract the day the solicitation appears, with three weeks to respond. The current contract's end date is public months earlier.",
    points: [
      "Contracts Ending Soon: who holds the work, which agency pays, the value and the end date",
      "Procurement forecasts from agencies that publish their planned purchases",
      "New bids in your trades and states at 6 AM, the day they post",
    ],
    href: "/recompetes",
    link: "Look at contracts ending soon",
  },
  {
    step: "2",
    title: "Decide in minutes whether to pursue it",
    body: "A bid you should not chase costs your team a week. Each opportunity comes with what you need to say yes or no.",
    points: [
      "An AI Executive Brief: mandatory requirements, key dates and red flags, drawn from the solicitation",
      "The incumbent and what the work was awarded for last time",
      "A match score against your company's profile",
    ],
    href: "/example-brief",
    link: "Read an example brief",
  },
  {
    step: "3",
    title: "Respond, and keep the relationship",
    body: "When you decide to bid, the work moves into one place your team can follow.",
    points: [
      "A first proposal draft written from the solicitation's requirements",
      "A pipeline of saved bids with deadlines in your calendar",
      "A CRM for contracting officers and partners, with follow-up reminders and drafted follow-ups you review before sending",
    ],
    href: "/pricing",
    link: "Compare the plans",
  },
];

const WHO: [string, string][] = [
  ["Software and IT services", "Firms selling to federal, state and local buyers who need to know which contracts come up for renewal."],
  ["Professional services", "Consulting, staffing, marketing and engineering firms with a person or small team writing proposals."],
  ["Construction and facilities", "General contractors and facilities companies large enough to have an estimator or a business development lead."],
];

function TeamsPage() {
  const counts = Route.useLoaderData();
  const plan = PLAN_COPY.professional;
  const features = plan.features.filter((f) => !/^Or \$/.test(f) && f !== "Cancel anytime");
  return (
    <>
      <SiteHeader />
      <main className="bg-white">
        <section className="bg-slate-950 px-4 py-14 text-white sm:py-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For teams that sell to government</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-5xl">Know about the contract before the bid is posted</h1>
            <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
              Contrax shows your team which government contracts are ending, who holds them now and what they were awarded for.
              When the solicitation arrives, it tells you in minutes whether it fits, and drafts the response when it does.
            </p>
            {counts && counts.open > 0 && (
              <dl className="mt-8 grid max-w-md grid-cols-2 gap-3">
                {[
                  ["Open bids tracked now", counts.open.toLocaleString("en-US")],
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
              href="/upgrade?plan=professional&source=teams"
              onClick={() => trackEvent("teams_cta_click", "hero")}
              className="mt-8 inline-block rounded-xl bg-amber-500 px-6 py-3 font-bold text-slate-950 hover:bg-amber-400"
            >
              Start Professional: $79 a month →
            </a>
            <p className="mt-2 text-xs text-slate-400">Month to month. Cancel anytime. Or $790 a year.</p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12">
          <h2 className="text-xl font-bold text-slate-900">From first sign to submitted response</h2>
          <ol className="mt-5 space-y-4">
            {STAGES.map((s) => (
              <li key={s.step} className="rounded-xl border border-slate-200 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-600">Stage {s.step}</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-700">{s.body}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                  {s.points.map((p) => (
                    <li key={p}>✓ {p}</li>
                  ))}
                </ul>
                <a href={s.href} onClick={() => trackEvent("teams_stage_click", s.step)} className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:text-blue-600">
                  {s.link} →
                </a>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-slate-50 px-4 py-12">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-xl font-bold text-slate-900">Who it is for</h2>
            <p className="mt-2 text-sm text-slate-700">Companies where someone's job includes winning government work.</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {WHO.map(([t, d]) => (
                <li key={t} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-bold text-slate-900">{t}</p>
                  <p className="mt-1 text-sm text-slate-700">{d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-12">
          <h2 className="text-xl font-bold text-slate-900">What Professional includes</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {features.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-600">
            Contract data comes from public records: USAspending.gov for federal awards, and each agency's own posting for bids.
            An ending contract is a sign to prepare, not a promise that the work will be rebid.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <a
              href="/upgrade?plan=professional&source=teams"
              onClick={() => trackEvent("teams_cta_click", "features")}
              className="inline-block rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              Start Professional →
            </a>
            <a
              href="mailto:contrax.companyllc@gmail.com?subject=Contrax%20for%20our%20team"
              onClick={() => trackEvent("teams_cta_click", "walkthrough")}
              className="text-sm font-semibold text-blue-700 hover:text-blue-600"
            >
              Or ask the founder for a walkthrough
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
