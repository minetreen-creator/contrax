import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { GrantsPricing } from "~/components/GrantsPricing";
import { resolveGrantsUpgradeEnabled } from "~/lib/grants-upgrade-signal";
import { SiteHeader } from "~/components/SiteHeader";
import { FoundingOffer } from "~/components/FoundingOffer";
import { PLAN_COPY } from "~/lib/plan-features";

const getGrantsPricingData = createServerFn({ method: "GET" }).handler(async () => {
  const grantsUpgradeEnabled = resolveGrantsUpgradeEnabled(
    typeof process !== "undefined" ? process.env : undefined,
  );
  return { grantsUpgradeEnabled };
});

export const Route = createFileRoute("/pricing/")({
  loader: () => getGrantsPricingData(),
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing | Contrax" },
      { name: "description", content: "Contrax plans for every stage of growth. Every new account starts with a 7-day Professional trial, no credit card. After it, choose a plan or keep searching on free Basic." },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Pricing | Contrax" },
      { property: "og:description", content: "Contrax plans for every stage of growth. Every new account starts with a 7-day Professional trial. Starter $19/mo, Professional $79/mo, Basic search free." },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Pricing | Contrax" },
      { name: "twitter:description", content: "Contrax plans for every stage of growth." },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/pricing" }],
  }),
});

// Owner 2026-10-19 (item 3): two choices up front. Basic, Agency and the
// done-for-you services are one line below the cards. `headline` is what the
// plan gets you, in one sentence; the feature list stays underneath.
const plans = [
  {
    name: "Starter",
    price: "19",
    period: "/month",
    headline: "Every new bid in your trade and states, emailed at 6 AM.",
    description: PLAN_COPY.starter.description,
    features: PLAN_COPY.starter.features,
    cta: "Choose Starter",
    slug: "starter",
    featured: false,
  },
  {
    name: "Professional",
    price: "79",
    period: "/month",
    headline: "Everything in Starter, plus who won last time and for how much.",
    description: PLAN_COPY.professional.description,
    features: PLAN_COPY.professional.features,
    cta: "Choose Professional",
    slug: "professional",
    featured: true,
  },
];

// Agency ($199/mo) is NOT on the main grid: the page leads with three plans and
// the done-for-you services, and Agency is a one-line link below them.

function PricingPage() {
  const { grantsUpgradeEnabled } = Route.useLoaderData();
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      {/* Hero */}
      <section className="pricing-section py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-sm font-semibold uppercase tracking-widest text-amber-600">Pricing</h1>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Plans for every stage of growth
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Every new account starts with a 7-day Professional trial, no credit card. When it ends, choose the plan that fits or keep searching on free Basic. No long-term contracts required.
            </p>
          </div>

          <FoundingOffer source="pricing" />

          {/* Plan cards */}
          <div className="mx-auto mt-14 grid max-w-4xl gap-8 md:grid-cols-2">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-2xl border bg-white p-8 shadow-sm transition-all hover:shadow-lg ${
                  plan.featured
                    ? "border-blue-500 ring-2 ring-blue-500/20 scale-[1.02] lg:scale-105"
                    : "border-gray-200"
                }`}
              >
                {plan.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-md">
                    Recommended
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                  <p className="mt-2 text-base font-semibold text-slate-800">{plan.headline}</p>
                  <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-extrabold text-slate-900">${plan.price}</span>
                  <span className="text-gray-500">{plan.period}</span>
                </div>
                <ul className="mb-8 flex-1 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <svg
                        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${plan.featured ? "text-blue-600" : "text-green-500"}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={`/signup?plan=${plan.slug}&next=${encodeURIComponent(`/upgrade?plan=${plan.slug}`)}`}
                  className={`block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${
                    plan.featured
                      ? "bg-amber-500 text-white"
                      : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>

          {/* Footer notes */}
          <p className="mt-8 text-center text-sm text-gray-500">Plans are billed monthly. Cancel anytime.</p>
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-gray-600">
            Not ready to pay? Keep searching on{" "}
            <a href="/signup?plan=basic" className="font-medium text-amber-600 hover:text-amber-500">free Basic</a>: one state and
            one trade, 2 Radar searches, 1 saved bid, and new bids open to you after a 7-day head start for paying members.
          </p>
          <p className="mt-3 text-center text-sm text-gray-500">
            Also available:{" "}
            <a href="/bid-scout?source=pricing" className="font-medium text-amber-600 hover:text-amber-500">Bid Scout</a> ($99/month, five handpicked bids every Friday) ·{" "}
            <a href="/bid-fit-review" className="font-medium text-amber-600 hover:text-amber-500">Bid Fit Review</a> ($99 once) ·{" "}
            <a href="/signup?plan=agency" className="font-medium text-amber-600 hover:text-amber-500">Agency</a> ($199/month, for teams and consultants) ·{" "}
            <a href="#grants" className="font-medium text-amber-600 hover:text-amber-500">Contrax Grants</a> (free for verified nonprofits) ·{" "}
            <a href="/contract-payments" className="font-medium text-amber-600 hover:text-amber-500">Contrax Payments</a> ($9/month)
          </p>
          <p className="mt-3 text-center">
            <a href="/signup?plan=professional" className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
              Or start your 7-day Professional trial &rarr;
            </a>
          </p>
          <p className="mt-3 text-center text-sm text-gray-500">
            Veterans Against Diabetes partner?{" "}
            <a href="/vad" className="font-medium text-amber-600 hover:text-amber-500 transition-colors">
              View exclusive VAD pricing
            </a>
          </p>
        </div>
      </section>

      <GrantsPricing grantsUpgradeEnabled={grantsUpgradeEnabled} />

      {/* FAQ */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-slate-900 text-center">Frequently asked questions</h2>
          <div className="mt-10 space-y-6">
            {[
              { q: "Can I switch plans later?", a: "Yes — upgrade or downgrade anytime. Changes take effect at the start of your next billing cycle." },
              { q: "How much does Basic cost?", a: "Basic is $0/mo and is where an account lands after its 7-day trial if no plan is chosen. It includes 2 Radar searches per account, basic solicitations search, standard set-aside filters, and 1 saved bid, with no bid emails. New bids open for free accounts after a 7-day head start for paying members. Basic matches bids for one state and one trade. Upgrade to Starter ($19/mo) to see new bids the day they post, match every state and trade you work in, get a 6 AM Eastern email of the new bids in your trade and states every morning, save unlimited bids, see who to contact on federal bids (name, email and phone), and get your saved bids' deadlines in your calendar. AI briefs and bid scoring are part of Radar Pro (Professional), and proposal drafting plus pipeline CSV export are part of Bid Scout." },
              { q: "Is there a free trial?", a: "Yes. Every new account starts with a 7-day Professional trial, with no credit card. When it ends, choose a plan or keep searching on free Basic." },
              { q: "Is there a yearly plan?", a: "Yes. Pay yearly and get 2 months free: Starter is $190 a year instead of $228, Professional $790 instead of $948, and Agency $1,990 instead of $2,388. Choose Yearly on the upgrade page at checkout." },
              { q: "Can I cancel anytime?", a: "Yes. Cancel anytime and your access continues until the end of the billing period. No refunds for partial months." },
              { q: "What payment methods do you accept?", a: "We accept all major credit and debit cards through Stripe." },
              { q: "Do nonprofits receive free access?", a: "Yes. Verified 501(c)(3) nonprofits receive free basic government grant search with no credit card, trial expiration, or monthly subscription. Apply at /nonprofit/apply. Paid government-contracting plans remain separate." },
              { q: "Is my data secure?", a: "Yes. Data is encrypted in transit and at rest. We use Vercel, Neon PostgreSQL, and Stripe — all SOC 2 compliant. Read more on our security page." },
            ].map((faq) => (
              <div key={faq.q} className="rounded-xl bg-white border border-gray-200 p-5">
                <h3 className="font-semibold text-slate-900">{faq.q}</h3>
                <p className="mt-2 text-sm text-gray-600">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
