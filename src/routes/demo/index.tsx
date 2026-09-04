import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  ClipboardCheck,
  FileSearch,
  Gauge,
  LayoutDashboard,
  Mail,
  Sparkles,
} from "lucide-react";

const PROD_URL = "https://www.contrax.company";
const TITLE = "See Contrax in Action — Request a Live Demo";
const DESC =
  "Watch how Contrax helps certified small businesses find, understand, and win government contracts. Request a live demo or start your 14-day free trial.";

export const Route = createFileRoute("/demo/")({
  component: DemoPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/demo` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: `${PROD_URL}/logo-square.png` },
      { name: "twitter:image:alt", content: "Contrax — Radar Finds Government Opportunities That Match Your Business" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/demo` }],
  }),
});

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Contrax",
  description:
    "Tell Contrax what your business does. Radar finds government opportunities that match — live set-asides for 8(a), SDVOSB, WOSB, and HUBZone-certified businesses, with bid documents explained and proposals drafted so certified firms can compete and win.",
  url: PROD_URL,
  logo: `${PROD_URL}/logo-square.png`,
  email: "hello@contrax.company",
  knowsAbout: [
    "Government contracting",
    "Federal procurement",
    "Set-aside contracts",
    "Bid management",
    "Proposal writing",
  ],
};

const features = [
  {
    icon: LayoutDashboard,
    title: "Dashboard",
    description:
      "Your command center: a bid overview with active opportunities, upcoming deadlines, and your trial countdown banner right where you need it.",
  },
  {
    icon: Bot,
    title: "AI Copilot",
    description:
      "Draft compliant proposals with AI. Describe your business and the Copilot turns bid requirements into a first draft you can refine and submit.",
  },
  {
    icon: Gauge,
    title: "Score",
    description:
      "Honest win-probability analysis for every opportunity — a GO / NO-GO recommendation before you invest hours in a bid that isn't worth pursuing.",
  },
  {
    icon: FileSearch,
    title: "Awards",
    description:
      "A live contract database with 123+ synced SAM.gov records, searchable by agency, location, and set-aside — so the right opportunities find you.",
  },
  {
    icon: ClipboardCheck,
    title: "Compliance tracking",
    description:
      "Track certifications, bid requirements, and deadlines so you never miss a filing window or a submission date.",
  },
];

const faqs = [
  {
    q: "How long is a demo?",
    a: "About 30 minutes. We'll walk you through the full workflow — matching opportunities, bid summaries, win-probability scoring, and AI proposal drafting — and leave time for your questions.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — every plan includes a 14-day free trial. No credit card required to start, and you can cancel anytime.",
  },
  {
    q: "What happens after I sign up?",
    a: "You're in. Pick a plan, set up your profile and certifications, and Contrax starts matching set-aside opportunities on day one. The trial banner in your dashboard shows exactly how many days you have left.",
  },
  {
    q: "Can I explore Contrax on my own first?",
    a: (
      <>
        Yes. Try the{" "}
        <a href="/try-demo" className="font-medium text-blue-600 underline decoration-blue-300 hover:text-blue-500">
          interactive demo
        </a>{" "}
        — a pre-loaded account with sample opportunities and a working AI workspace, no signup required.
      </>
    ),
  },
];

function DemoPage() {
  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
            <a href="/demo" className="font-bold text-slate-900">Demo</a>
            <a href="/login" className="text-slate-500 hover:text-slate-900">Sign in</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="relative mx-auto max-w-7xl px-6 py-20 text-center sm:py-28">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-amber-400">Live Demo</p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            See Contrax{" "}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              in Action
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100/80 sm:text-xl">
            Watch how Contrax helps certified small businesses find, understand, and win
            government contracts — from opportunity matching to AI-drafted proposals.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="mailto:hello@contrax.company?subject=Request%20a%20live%20demo"
              className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
            >
              <Mail className="mr-2 h-5 w-5" />
              Request a live demo
            </a>
            <a
              href="/signup"
              className="inline-flex items-center rounded-xl border border-blue-400/30 px-6 py-4 text-base font-medium text-blue-100 transition-colors hover:bg-blue-400/10 hover:text-white"
            >
              Start free trial
            </a>
          </div>
        </div>
      </section>

      {/* Request a live demo */}
      <section className="bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <p className="text-center text-sm font-semibold uppercase tracking-widest text-blue-600">
              Request a live demo
            </p>
            <h2 className="mt-3 text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              See it on your own opportunities
            </h2>
            <p className="mt-4 text-center text-lg text-gray-600">
              We'll walk you through the platform live and tailor the demo to your
              certifications, industry, and the set-asides you qualify for.
            </p>
          </div>
          <div className="mx-auto mt-12 grid gap-8 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-2xl border border-gray-200/60 bg-gray-50 p-8 sm:p-10">
              <h3 className="text-xl font-bold text-slate-900">What to expect</h3>
              <ul className="mt-6 space-y-4">
                {[
                  ["30 minutes", "A focused walkthrough of the full workflow — matching, understanding, scoring, and drafting."],
                  ["Tailored to you", "We start from your certifications (8(a), SDVOSB, WOSB, HUBZone) and your services."],
                  ["Real opportunities", "Live SAM.gov records from the contract database, not mockups."],
                  ["Your questions", "Plenty of time for Q&A — including what it takes to get certified and win."],
                ].map(([title, desc]) => (
                  <li key={title} className="flex gap-4">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900">{title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-gray-600">{desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-2 flex flex-col justify-center rounded-2xl border border-blue-100 bg-blue-50/60 p-8 sm:p-10">
              <h3 className="text-lg font-semibold text-slate-900">Book by email — no signup forms</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">
                We don't use automated booking yet. Email us and we'll find a time that
                works for you — usually within one business day.
              </p>
              <a
                href="mailto:hello@contrax.company?subject=Request%20a%20live%20demo"
                className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.98]"
              >
                <Mail className="mr-2 h-4 w-4" />
                hello@contrax.company
              </a>
              <p className="mt-4 text-center text-xs text-gray-500">
                Or start your 14-day free trial and explore on your own.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Product walkthrough */}
      <section id="features" className="bg-gray-50 py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
              Product walkthrough
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              What you'll see in the demo
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Five screens that cover the whole journey — from finding the right
              opportunity to submitting a compliant proposal.
            </p>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-lg font-bold text-slate-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{feature.description}</p>
              </div>
            ))}
            <div className="flex flex-col justify-center rounded-2xl border border-dashed border-blue-300 bg-blue-50/50 p-8">
              <h3 className="text-lg font-bold text-slate-900">Plus the full workspace</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                Certifications tracking, proposal workspace, win/loss learnings, and more —
                all in one place, built around the set-aside journey.
              </p>
              <a
                href="/try-demo"
                className="mt-5 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-500"
              >
                Try the interactive demo <ArrowRight className="ml-1 h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-10 space-y-6">
            {faqs.map((faq) => (
              <div key={faq.q} className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="font-semibold text-slate-900">{faq.q}</h3>
                <div className="mt-2 text-sm text-gray-600">{faq.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 py-20">
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Start your 14-day free trial
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-blue-100/80">
            No credit card required. Set up your profile in minutes and start
            seeing set-aside opportunities matched to your certifications.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="/signup"
              className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
            >
              Start your 14-day free trial
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
            <a
              href="mailto:hello@contrax.company?subject=Request%20a%20live%20demo"
              className="inline-flex items-center rounded-xl border border-blue-400/30 px-6 py-4 text-base font-medium text-blue-100 transition-colors hover:bg-blue-400/10 hover:text-white"
            >
              <Mail className="mr-2 h-5 w-5" />
              Request a demo
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
