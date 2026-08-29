import { createFileRoute } from "@tanstack/react-router";
import { redirectToCheckout } from "~/lib/checkout";

export const Route = createFileRoute("/vad")({
  component: VadPage,
  head: () => ({
    meta: [
      { title: "Exclusive Veterans Against Diabetes Pricing | Contrax" },
      { name: "description", content: "Exclusive Veterans Against Diabetes partner pricing on Contrax. Starter $14/mo, Professional $59/mo, Agency $149/mo. No long-term contract. Cancel anytime. First 12 months on exclusive partner pricing." },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Exclusive Veterans Against Diabetes Pricing | Contrax" },
      { property: "og:description", content: "Exclusive Veterans Against Diabetes partner pricing. Starter $14/mo, Professional $59/mo, Agency $149/mo." },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Exclusive Veterans Against Diabetes Pricing | Contrax" },
      { name: "twitter:description", content: "Exclusive Veterans Against Diabetes partner pricing on Contrax." },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/vad" }],
  }),
});

// VAD26 is our own server-side verification code, NOT a Stripe promo code.
// Presenting it at checkout selects dedicated exact VAD Stripe prices for the
// tier ($14/$59/$149). The customer is still billed at the exact VAD price —
// never a standard price minus a percentage.
const VAD_CODE = "VAD26";

// The VAD offering covers only the three paid tiers (Basic is NOT included).
type VadTier = "starter" | "professional" | "agency";

const vadPlans: {
  name: string;
  price: string;
  was: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  tier: VadTier;
  featured: boolean;
}[] = [
  {
    name: "Starter",
    price: "14",
    was: "19",
    period: "/mo",
    description: "For businesses ready to build and track a real government-contracting pipeline.",
    features: [
      "Unlimited Saved Bids",
      "Daily NAICS Email Alerts",
      "CSV Pipeline Export",
    ],
    cta: "Get Started",
    tier: "starter",
    featured: false,
  },
  {
    name: "Professional",
    price: "59",
    was: "79",
    period: "/mo",
    description: "For growing businesses that win more with full RFP intelligence — 50 AI Executive Briefs a month, incumbent pricing, and draft tools.",
    features: [
      "50 AI Executive Briefs a month — requirements, milestones & red flags",
      "Full Incumbent Intelligence & Past Pricing",
      "AI Match Scoring",
      "Draft Tools",
    ],
    cta: "Get Started",
    tier: "professional",
    featured: true,
  },
  {
    name: "Agency",
    price: "149",
    was: "199",
    period: "/mo",
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
    tier: "agency",
    featured: false,
  },
];

function handleCheckout(tier: VadTier) {
  redirectToCheckout(tier, { promoCode: VAD_CODE });
}

function VadPage() {
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
            <a href="/pricing" className="text-slate-500 hover:text-slate-900">Pricing</a>
            <a href="/login" className="text-slate-500 hover:text-slate-900">Sign in</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-600">
              Exclusive partner pricing for Veterans Against Diabetes
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Exclusive Veterans Against Diabetes Pricing
            </h1>
            <p className="mt-4 text-lg text-gray-600">
              No long-term contract. Cancel anytime.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              The first 12 months are on exclusive partner pricing. Use your code{" "}
              <span className="font-semibold text-slate-900">{VAD_CODE}</span> to
              unlock the exact discounted prices below.
            </p>
          </div>

          {/* Promo-code field — VAD26 is pre-applied. This is our own
              server-side verification code, NOT a general coupon system. */}
          <div className="mx-auto mt-8 max-w-sm">
            <label htmlFor="vad-code" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
              Partner code (auto-applied)
            </label>
            <input
              id="vad-code"
              type="text"
              readOnly
              value={VAD_CODE}
              className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-center text-sm font-semibold text-slate-900"
              aria-label="Partner code VAD26"
            />
            <p className="mt-2 text-center text-xs text-gray-500">
              <span className="text-green-600">VAD26 is automatically applied.</span>{" "}
              The prices below are exactly what you pay — no extra steps.
            </p>
          </div>

          {/* Plan cards */}
          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {vadPlans.map((plan) => (
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
                  <span className="ml-2 text-sm font-medium text-gray-400 line-through">
                    was ${plan.was}
                  </span>
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
                <button
                  type="button"
                  onClick={() => handleCheckout(plan.tier)}
                  className={`block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${
                    plan.featured
                      ? "bg-amber-500 text-white"
                      : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  {plan.cta} — ${plan.price}/mo
                </button>
                <p className="mt-3 text-center text-xs text-gray-500">
                  Exact VAD price · billed monthly · cancel anytime
                </p>
              </div>
            ))}
          </div>

          {/* Footer notes */}
          <p className="mt-8 text-center text-sm text-gray-500">
            Prices are exactly what's charged for the first 12 months — the "was"
            amount shown is the standard Contrax price for reference (~25% off).
          </p>
          <p className="mt-3 text-center">
            <a href="/pricing" className="text-sm font-medium text-amber-600 hover:text-amber-500 transition-colors">
              Not a VAD member? View standard pricing &rarr;
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
