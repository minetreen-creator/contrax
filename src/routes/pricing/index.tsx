import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { GrantsPricing } from "~/components/GrantsPricing";
import { resolveGrantsUpgradeEnabled } from "~/lib/grants-upgrade-signal";
import { SiteHeader } from "~/components/SiteHeader";
import { FoundingOffer } from "~/components/FoundingOffer";
import { PLAN_COPY, upgradeFeatures } from "~/lib/plan-features";
import { STARTER_FIRST_MONTH_NOTE } from "~/lib/starter-offer";

const getGrantsPricingData = createServerFn({ method: "GET" }).handler(async () => {
  const grantsUpgradeEnabled = resolveGrantsUpgradeEnabled(
    typeof process !== "undefined" ? process.env : undefined,
  );
  return { grantsUpgradeEnabled };
});

// Owner 2026-10-19 (item 6): descriptive title (prices in the title itself);
// og:title / twitter:title read the same string. The meta descriptions are
// unchanged — they already carry the prices.
const PAGE_TITLE = "Pricing: Government Bid Alerts from $19/Month";
const META_DESCRIPTION =
  "Contrax plans for every stage of growth. Every new account starts with a 7-day Professional trial, no credit card. After it, choose a plan or keep searching on free Basic.";

export const Route = createFileRoute("/pricing/")({
  loader: () => getGrantsPricingData(),
  component: PricingPage,
  head: () => ({
    meta: [
      { title: PAGE_TITLE },
      { name: "description", content: META_DESCRIPTION },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: PAGE_TITLE },
      { property: "og:description", content: "Contrax plans for every stage of growth. Every new account starts with a 7-day Professional trial. Starter $19/mo, Professional $79/mo, Basic search free." },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: PAGE_TITLE },
      { name: "twitter:description", content: "Contrax plans for every stage of growth." },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/pricing" }],
  }),
});

// Owner 2026-10-19 (item 1): the value anchor printed under the price on the
// Starter and Professional cards, verbatim. It is a price comparison, not a
// feature bullet, so it renders directly under the price, not in the list.
const VALUE_ANCHOR =
  "Paid alert services run $49-149 a month for watching portals. Enterprise intelligence starts around $6,000 a year. Starter is $19.";

/** Yearly = 10 × monthly (2 months free) — mirrors ANNUAL_UNIT_AMOUNTS in src/lib/stripe.ts and /upgrade. */
const plans = [
  {
    name: "Starter",
    price: 19,
    yearly: 190,
    slug: "starter",
    href: `/signup?plan=starter&next=${encodeURIComponent("/upgrade?plan=starter")}`,
    headline: "Every new bid in your trade and states, emailed at 6 AM.",
    description: PLAN_COPY.starter.description,
    // The yearly line is dropped here because the Monthly/Yearly switch below
    // carries it now (owner 2026-10-19, item 3) — same helper /upgrade uses.
    features: upgradeFeatures(PLAN_COPY.starter.features),
    cta: "Choose Starter",
    featured: false,
  },
  {
    name: "Professional",
    price: 79,
    yearly: 790,
    slug: "professional",
    href: `/signup?plan=professional&next=${encodeURIComponent("/upgrade?plan=professional")}`,
    headline: "Everything in Starter, plus who won last time and for how much.",
    description: PLAN_COPY.professional.description,
    features: upgradeFeatures(PLAN_COPY.professional.features),
    cta: "Choose Professional",
    featured: true,
  },
  // Owner 2026-10-20: Agency now ships multi-client workspaces (owner decision
  // 10-20; migration 068 prod-applied) — up to 10 client workspaces each with
  // own matches/saved bids/CRM, CRM Pro across all workspaces (2,500 cap),
  // cross-client dashboard (P2 #801), per-client CSV export (P3 #802). The card
  // claims only shipped features. Deliberately NOT claimed: team seats
  // (workspaces are per-login, not multi-user seats), anything beyond the
  // 10-workspace / 2,500-contact caps.
  {
    name: "Agency",
    price: 199,
    yearly: 1990,
    slug: "agency",
    href: "/signup?plan=agency",
    headline: null,
    description: PLAN_COPY.agency.description,
    // Same shared copy and the same yearly-line strip as Starter/Professional:
    // the Monthly/Yearly switch above carries the yearly price.
    features: upgradeFeatures(PLAN_COPY.agency.features),
    cta: "Choose Agency",
    featured: false,
  },
];

// Every FAQ actually rendered on the page. The render AND the FAQPage
// structured data read this ONE array, so the markup can never drift from what
// visitors read (8 items).
const FAQS = [
  { q: "Can I switch plans later?", a: "Yes — upgrade or downgrade anytime. Changes take effect at the start of your next billing cycle." },
  { q: "How much does Basic cost?", a: "Basic is $0/mo and is where an account lands after its 7-day trial if no plan is chosen. It includes 2 Radar searches per account, basic solicitations search, standard set-aside filters, and 1 saved bid, with no bid emails. New bids open for free accounts after a 7-day head start for paying members. Basic matches bids for one state and one trade. Upgrade to Starter ($19/mo) to see new bids the day they post, match every state and trade you work in, get a 6 AM Eastern email of the new bids in your trade and states every morning, save unlimited bids, see who to contact on federal bids (name, email and phone), and get your saved bids' deadlines in your calendar. AI briefs and bid scoring are part of Radar Pro (Professional), and proposal drafting plus pipeline CSV export are part of Bid Scout." },
  { q: "Is there a free trial?", a: "Yes. Every new account starts with a 7-day Professional trial, with no credit card. When it ends, choose a plan or keep searching on free Basic." },
  { q: "Is there a yearly plan?", a: "Yes. Pay yearly and get 2 months free: Starter is $190 a year instead of $228, Professional $790 instead of $948, and Agency $1,990 instead of $2,388. Choose Yearly on the upgrade page at checkout." },
  { q: "Can I cancel anytime?", a: "Yes. Cancel anytime and your access continues until the end of the billing period. No refunds for partial months." },
  { q: "What payment methods do you accept?", a: "We accept all major credit and debit cards through Stripe." },
  { q: "Do nonprofits receive free access?", a: "Yes. Verified 501(c)(3) nonprofits receive free basic government grant search with no credit card, trial expiration, or monthly subscription. Apply at /nonprofit/apply. Paid government-contracting plans remain separate." },
  { q: "Is my data secure?", a: "Yes. Data is encrypted in transit and at rest. We use Vercel, Neon PostgreSQL, and Stripe — all SOC 2 compliant. Read more on our security page." },
];

// Structured data (owner 2026-10-19, item 4). Product offers come from the SAME
// `plans` array the cards render, so a price change cannot leave the markup
// stating a stale figure.
const PROD_URL = "https://www.contrax.company";
const pricingJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Product",
      name: "Contrax",
      description:
        "Contract intelligence for small businesses pursuing US government set-aside contracts: Government bid alerts, AI Executive Briefs, incumbent pricing and a bid pipeline.",
      brand: { "@type": "Brand", name: "Contrax" },
      url: `${PROD_URL}/pricing`,
      offers: [
        {
          "@type": "Offer",
          name: "Basic",
          description: "Free search plan: one state and one trade, 2 Radar searches, 1 saved bid.",
          price: "0",
          priceCurrency: "USD",
          category: "subscription",
          url: `${PROD_URL}/signup?plan=basic`,
          availability: "https://schema.org/InStock",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "0",
            priceCurrency: "USD",
            unitCode: "MON",
          },
        },
        ...plans.flatMap((p) => [
          {
            "@type": "Offer",
            name: p.name,
            description: PLAN_COPY[p.slug as "starter" | "professional" | "agency"].description,
            price: String(p.price),
            priceCurrency: "USD",
            category: "subscription",
            url: `${PROD_URL}${p.href}`,
            availability: "https://schema.org/InStock",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: String(p.price),
              priceCurrency: "USD",
              unitCode: "MON",
            },
          },
          {
            "@type": "Offer",
            name: `${p.name} (yearly)`,
            description: PLAN_COPY[p.slug as "starter" | "professional" | "agency"].description,
            price: String(p.yearly),
            priceCurrency: "USD",
            category: "subscription",
            url: `${PROD_URL}${p.href}`,
            availability: "https://schema.org/InStock",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: String(p.yearly),
              priceCurrency: "USD",
              unitCode: "ANN",
            },
          },
        ]),
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

function PricingPage() {
  const { grantsUpgradeEnabled } = Route.useLoaderData();
  // Owner 2026-10-19 (item 3): same Monthly/Yearly switch as /upgrade. The
  // displayed price swaps in place; monthly is the default.
  const [interval, setInterval] = useState<"month" | "year">("month");
  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />
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

          {/* Billing period (owner 2026-10-19, item 3) — mirrors /upgrade. */}
          <div className="mt-10 flex justify-center">
            <div
              role="radiogroup"
              aria-label="Billing period"
              className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm"
            >
              {(["month", "year"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={interval === v}
                  onClick={() => setInterval(v)}
                  className={`rounded-full px-4 py-1.5 transition ${
                    interval === v ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {v === "month" ? "Monthly" : "Yearly · 2 months free"}
                </button>
              ))}
            </div>
          </div>

          {/* Plan cards */}
          <div className="mx-auto mt-10 grid max-w-6xl gap-8 md:grid-cols-3">
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
                  <h3 className="text-xl font-bold text-slate-900">
                    {plan.name}
                    {plan.slug === "agency" && (
                      <span className="font-medium text-gray-500"> — for teams and consultants</span>
                    )}
                  </h3>
                  {plan.headline && (
                    <p className="mt-2 text-base font-semibold text-slate-800">{plan.headline}</p>
                  )}
                  {plan.description && <p className="mt-1 text-sm text-gray-500">{plan.description}</p>}
                </div>
                <div className={plan.slug === "agency" ? "mb-6" : "mb-2"}>
                  <span className="text-4xl font-extrabold text-slate-900">
                    ${interval === "month" ? plan.price : plan.yearly.toLocaleString("en-US")}
                  </span>
                  <span className="text-gray-500">{interval === "month" ? "/month" : "/year"}</span>
                  {interval === "month" && plan.slug === "starter" && (
                    <p className="mt-1 text-sm font-semibold text-emerald-700">{STARTER_FIRST_MONTH_NOTE}</p>
                  )}
                  {interval === "year" && (
                    <p className="mt-1 text-sm text-emerald-700">
                      ${(plan.price * 12).toLocaleString("en-US")} if paid monthly. You save $
                      {(plan.price * 2).toLocaleString("en-US")} — 2 months free.
                    </p>
                  )}
                </div>
                {/* Owner 2026-10-19 (item 1): value anchor, directly under the price. */}
                {plan.slug !== "agency" && (
                  <p className="mb-6 text-xs leading-relaxed text-gray-500">{VALUE_ANCHOR}</p>
                )}
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
                  href={plan.href}
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
          <p className="mt-8 text-center text-sm text-gray-500">Plans are billed monthly or yearly. Cancel anytime.</p>
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
            {FAQS.map((faq) => (
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
