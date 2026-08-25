import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing/")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing | Contrax" },
      { name: "description", content: "Contrax plans for every stage of growth. Basic free forever, Starter $19/mo, Professional $79/mo. 21-day free trial on paid plans." },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Pricing | Contrax" },
      { property: "og:description", content: "Contrax plans for every stage of growth. Basic free forever, Starter $19/mo, Professional $79/mo. 21-day free trial on paid plans." },
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
    description: "Free forever. For small businesses scouting their first set-aside opportunities.",
    features: [
      "Basic Solicitations Search",
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
    description: "For businesses ready to build and track a real government-contracting pipeline.",
    features: [
      "Unlimited Saved Bids",
      "Daily NAICS Email Alerts",
      "CSV Pipeline Export",
    ],
    cta: "Get Started",
    slug: "starter",
    featured: false,
  },
  {
    name: "Professional",
    price: "79",
    period: "/month",
    description: "For growing businesses that win more bids with full intelligence and draft tools.",
    features: [
      "Full Incumbent Intelligence & Past Pricing",
      "AI Match Scoring",
      "Draft Tools",
    ],
    cta: "Get Started",
    slug: "professional",
    featured: true,
  },
];

// Agency ($199/mo) is NOT part of the primary 3-tier matrix — kept separately
// (Proposal Evaluator Red Team + team roles). Listed below the main grid.
const agencyPlan = {
  name: "Agency",
  price: "199",
  period: "/month",
  description: "For firms managing multiple clients or large contract portfolios.",
  features: [
    "Everything in Professional",
    "Proposal Evaluator Red Team",
    "Team roles & permissions",
    "Integration connectors",
    "Win/loss bid tracking",
    "Team collaboration tools",
  ],
  cta: "Get Started",
  slug: "agency",
};

function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <a href="/" className="inline-flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900">
              <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-900">Contrax</span>
          </a>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/#features" className="text-slate-500 hover:text-slate-900">Features</a>
            <a href="/pricing" className="font-bold text-slate-900">Pricing</a>
            <a href="/login" className="text-slate-500 hover:text-slate-900">Sign in</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-sm font-semibold uppercase tracking-widest text-amber-600">Pricing</h1>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Plans for every stage of growth
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Start free on Basic, then scale up as your contracting pipeline grows. No long-term contracts required. Paid plans include a 21-day free trial.
            </p>
          </div>

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
                    Basic is free forever, limited to up to 3 saved bids. Incumbent Intelligence, AI Match Scoring &amp; Draft Tools are on Professional.
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Agency — kept separate from the primary 3-tier matrix */}
          <div className="mt-10">
            <div className="relative flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:shadow-lg sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-bold text-slate-900">{agencyPlan.name}</h3>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                    Add-on
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{agencyPlan.description}</p>
                <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-gray-600">
                  {agencyPlan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-1.5">
                      <svg className="h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-6 sm:mt-0 sm:text-right">
                <p className="text-3xl font-extrabold text-slate-900">
                  ${agencyPlan.price}<span className="text-base font-normal text-gray-500">{agencyPlan.period}</span>
                </p>
                <a
                  href={`/signup?plan=${agencyPlan.slug}`}
                  className="mt-3 inline-block w-full rounded-xl border-2 border-slate-900 px-6 py-3 text-center text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98] sm:w-auto"
                >
                  {agencyPlan.cta}
                </a>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-gray-500">
              Agency includes the Proposal Evaluator "Red Team" and team roles — available separately from the core tiers.
            </p>
          </div>

          {/* Footer notes */}
          <p className="mt-8 text-center text-sm text-gray-500">Plans are billed monthly. Cancel anytime.</p>
          <p className="mt-3 text-center">
            <a href="/signup" className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
              Or start your free trial &rarr;
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
              { q: "How much does Basic cost?", a: "Basic is free forever — $0/mo. It includes basic solicitations search, standard set-aside filters, and up to 3 saved bids. Upgrade to Starter ($19/mo) for unlimited saved bids, daily NAICS email alerts, and CSV export." },
              { q: "Is there a free trial?", a: "Paid plans include a 21-day free trial, no credit card required. Basic is free forever — no trial, no card, nothing to cancel." },
              { q: "Can I cancel anytime?", a: "Yes. Cancel anytime and your access continues until the end of the billing period. No refunds for partial months." },
              { q: "What payment methods do you accept?", a: "We accept all major credit and debit cards through Stripe." },
              { q: "Do you offer discounts for non-profits?", a: "We don't have a formal non-profit discount yet, but reach out to hello@contrax.company and we'll work with you." },
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
