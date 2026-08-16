import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing/")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing | Contrax" },
      { name: "description", content: "Contrax plans for every stage of growth. Starter $19/mo, Professional $79/mo, Agency $199/mo. 21-day free trial on all plans." },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Pricing | Contrax" },
      { property: "og:description", content: "Contrax plans for every stage of growth. Starter $19/mo, Professional $79/mo, Agency $199/mo. 21-day free trial on all plans." },
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
    name: "Starter",
    price: "19",
    period: "/month",
    description: "For small businesses getting started with government contracting.",
    features: [
      "SAM.gov bid matching (daily sync)",
      "AI-powered bid summaries",
      "Win probability scoring",
      "Certification guides & checklists",
      "Contract database access",
    ],
    cta: "Get Started",
    slug: "starter",
    featured: false,
  },
  {
    name: "Professional",
    price: "79",
    period: "/month",
    description: "For growing businesses that want to scale their contracting pipeline.",
    features: [
      "Everything in Starter",
      "Unlimited bid tracking",
      "Drafting Intelligence — AI-verified citations to protect your win against audits",
      "Win probability scoring",
      "Compliance tracking",
      "AI chat support",
    ],
    cta: "Get Started",
    slug: "professional",
    featured: true,
  },
  {
    name: "Agency",
    price: "199",
    period: "/month",
    description: "For firms managing multiple clients or large contract portfolios.",
    features: [
      "Everything in Professional",
      "Team roles & permissions",
      "Integration connectors",
      "Win/loss bid tracking",
      "Team collaboration tools",
      "Market trend analysis",
    ],
    cta: "Get Started",
    slug: "agency",
    featured: false,
  },
];

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
              Start small and scale up as your contracting pipeline grows. No long-term contracts required. Every plan includes a 21-day free trial.
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
                  href={`/signup?plan=${plan.slug}`}
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
              { q: "Is there a free trial?", a: "Every plan includes a 21-day free trial. No credit card required to start." },
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
