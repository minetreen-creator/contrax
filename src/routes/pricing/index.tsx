import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";

export const Route = createFileRoute("/pricing/")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing | Contrax" },
      { name: "description", content: "Contrax plans for every stage of growth. Basic is free forever. Paid upgrades include a 14-day Professional trial that starts when you upgrade." },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Pricing | Contrax" },
      { property: "og:description", content: "Contrax plans for every stage of growth. Basic free forever, Starter $19/mo, Professional $79/mo. Every plan includes a 14-day Professional trial." },
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

const plans = [
  {
    name: "Basic",
    price: "0",
    period: "/month",
    description: "Free forever. Search every open bid yourself, whenever you like.",
    features: [
      "Search every open solicitation",
      "Up to 3 Saved Bids",
      "Standard Set-Aside Filters",
    ],
    cta: "Start Free",
    slug: "basic",
    featured: false,
    free: true,
  },
  {
    name: "Starter",
    price: "19",
    period: "/month",
    description: "Every new bid in your inbox each morning, instead of finding it when the deadline is close.",
    features: [
      "A morning email of every new bid",
      "Unlimited Saved Bids",
    ],
    cta: "Get Started",
    slug: "starter",
    featured: false,
  },
  {
    name: "Professional",
    price: "79",
    period: "/month",
    description: "For growing businesses that win more with full RFP intelligence — 50 AI Executive Briefs a month, incumbent pricing, and AI match scoring.",
    features: [
      "50 AI Executive Briefs a month — requirements, milestones & red flags",
      "Full Incumbent Intelligence & Past Pricing",
      "AI Match Scoring",
    ],
    cta: "Get Started",
    slug: "professional",
    featured: true,
  },
];

// Agency ($199/mo) is NOT on the main grid: the page leads with three plans and
// the done-for-you services, and Agency is a one-line link below them.

// "Which is right for me?" — one row per common need, pointing at the single
// product that fits. Prices mirror the cards below, /bid-scout and
// /bid-fit-review. Agency, Grants and Payments are linked once at the bottom.
const PLAN_GUIDE = [
  { need: "I'm just starting to look at set-asides", pick: "Basic", price: "Free", href: "/signup?plan=basic" },
  { need: "I want new bids emailed to me each morning", pick: "Starter", price: "$19/month", href: "/signup?plan=starter" },
  { need: "I want AI briefs, incumbent pricing and match scores", pick: "Professional", price: "$79/month", href: "/signup?plan=professional" },
  { need: "I want someone to find the bids for me", pick: "Bid Scout", price: "$99/month", href: "/bid-scout?source=pricing_guide" },
  { need: "I'm deciding on one specific bid", pick: "Bid Fit Review", price: "$99 once", href: "/bid-fit-review" },
];

function WhichPlan() {
  return (
    <section aria-labelledby="which-plan-heading" className="mx-auto mt-10 max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h3 id="which-plan-heading" className="text-xl font-bold text-slate-900">Which is right for me?</h3>
      <ul className="mt-4 divide-y divide-slate-100">
        {PLAN_GUIDE.map((row) => (
          <li key={row.pick}>
            <a href={row.href} className="flex flex-col gap-1 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-sm text-slate-600">{row.need}</span>
              <span className="shrink-0 text-sm font-semibold text-slate-900">
                {row.pick} <span className="font-normal text-slate-500">· {row.price}</span> <span aria-hidden="true" className="text-blue-700">→</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PricingPage() {
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
              Start free on Basic with no card, then scale up as your contracting pipeline grows. No long-term contracts required. Your 14-day Professional trial starts when you upgrade, and you can cancel anytime during it.
            </p>
          </div>

          <WhichPlan />

          {/* Plan cards */}
          <div className="mt-14 grid gap-8 lg:grid-cols-3">
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
                  href={plan.free ? "/signup" : `/signup?plan=${plan.slug}`}
                  className={`block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${
                    plan.featured
                      ? "bg-amber-500 text-white"
                      : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  {plan.cta}
                </a>
                {/* Honest scope on free forever — Basic is free and never expires,
                    but it is LIMITED (up to 3 saved bids), with the premium
                    features paywalled behind Professional. Small footnote on the
                    Basic card only. */}
                {plan.free && (
                  <p className="mt-3 text-center text-xs text-gray-500">
                    Basic is free forever, limited to up to 3 saved bids. AI Executive Briefs, Incumbent Intelligence, and AI Match Scoring are on Professional. Proposal drafting and pipeline CSV export are on Bid Scout.
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Done-for-you services (priced separately from the software plans; same
              prices as /bid-scout and /bid-fit-review, features per lib/plan-gates). */}
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900">Bid Scout</h3>
              <p className="mt-1 text-sm text-gray-500">Five handpicked federal opportunities that fit your business, every Friday.</p>
              <p className="mt-5 text-3xl font-extrabold text-slate-900">
                $99<span className="text-base font-normal text-gray-500">/month</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-gray-700">
                <li>Five matched opportunities with deadlines, requirements and risks</li>
                <li>Proposal drafting</li>
                <li>Pipeline CSV export</li>
              </ul>
              <a
                href="/bid-scout?source=pricing"
                className="mt-6 block w-full rounded-xl border-2 border-slate-900 px-6 py-3 text-center text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98]"
              >
                Start Bid Scout
              </a>
            </div>
            <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900">Bid Fit Review</h3>
              <p className="mt-1 text-sm text-gray-500">A one-page pursue/pass review of a single solicitation.</p>
              <p className="mt-5 text-3xl font-extrabold text-slate-900">
                $99<span className="text-base font-normal text-gray-500"> once</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-gray-700">
                <li>Eligibility and fit against the stated requirements</li>
                <li>Key deadlines, required forms and deal breakers</li>
                <li>We confirm your request before you pay</li>
              </ul>
              <a
                href="/bid-fit-review"
                className="mt-6 block w-full rounded-xl border-2 border-slate-900 px-6 py-3 text-center text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98]"
              >
                Request a review
              </a>
            </div>
          </div>

          {/* Footer notes */}
          <p className="mt-8 text-center text-sm text-gray-500">Plans are billed monthly. Cancel anytime.</p>
          <p className="mt-3 text-center text-sm text-gray-500">
            Also available:{" "}
            <a href="/signup?plan=agency" className="font-medium text-amber-600 hover:text-amber-500">Agency</a> ($199/month, for teams and consultants) ·{" "}
            <a href="/grants" className="font-medium text-amber-600 hover:text-amber-500">Contrax Grants</a> (free for verified nonprofits) ·{" "}
            <a href="/contract-payments" className="font-medium text-amber-600 hover:text-amber-500">Contrax Payments</a> ($9/month)
          </p>
          <p className="mt-3 text-center">
            <a href="/signup?plan=professional" className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
              Or start your 14-day Professional trial &rarr;
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

      {/* FAQ */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-slate-900 text-center">Frequently asked questions</h2>
          <div className="mt-10 space-y-6">
            {[
              { q: "Can I switch plans later?", a: "Yes — upgrade or downgrade anytime. Changes take effect at the start of your next billing cycle." },
              { q: "How much does Basic cost?", a: "Basic is free forever — $0/mo. It includes basic solicitations search, standard set-aside filters, and up to 3 saved bids. Upgrade to Starter ($19/mo) for a morning email of every new bid and unlimited saved bids. AI briefs and bid scoring are part of Radar Pro (Professional), and proposal drafting plus pipeline CSV export are part of Bid Scout." },
              { q: "Is there a free trial?", a: "Start your 14-day Professional trial when you upgrade. Cancel anytime during your trial. Basic itself is free forever — no trial and no card." },
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
