import { createFileRoute } from "@tanstack/react-router";

const PROD_URL = "https://www.contrax.company";
const TITLE = "About Contrax";
const DESC =
  "Contrax is a contract intelligence platform founded by Nathaniel Minetree to help 8(a), SDVOSB, WOSB, and HUBZone small businesses find and win government contracts.";

export const Route = createFileRoute("/about/")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/about` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: `${PROD_URL}/logo-square.png` },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/about` }],
  }),
});

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Contrax",
  description:
    "Founded by Nathaniel Minetree, Contrax is a contract intelligence platform that helps 8(a), SDVOSB, WOSB, and HUBZone-certified small businesses find and win government contracts — real-time discovery across 50 states and federal portals, with an AI-driven workspace for incumbent research and grounded proposal drafting.",
  url: PROD_URL,
  logo: `${PROD_URL}/logo-square.png`,
  founder: {
    "@type": "Person",
    name: "Nathaniel Minetree",
  },
  email: "hello@contrax.company",
  sameAs: [],
  knowsAbout: [
    "Government contracting",
    "Federal procurement",
    "Set-aside contracts",
    "Small business certifications (8(a), SDVOSB, WOSB, HUBZone)",
    "Bid management",
    "Proposal writing",
  ],
};

function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="relative mx-auto max-w-7xl px-6 py-24 text-center sm:py-32">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-amber-400">
            About Contrax
          </p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Leveling the playing field in{" "}
            <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
              government contracting
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100/80 sm:text-xl">
            Our mission is simple: help small businesses compete for government
            contracts — so a five-person shop can research, bid, and win
            like the big firms.
          </p>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* The Mission */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <svg
              className="mx-auto h-10 w-10 text-amber-500"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
            </svg>
            <h2 className="mt-6 text-sm font-semibold uppercase tracking-widest text-blue-600">
              The Mission
            </h2>
            <p className="mt-6 text-xl leading-relaxed text-slate-700 sm:text-2xl sm:leading-relaxed">
              For too long, the government contracting landscape has been divided
              into two worlds. On one side are the massive primes with dedicated
              departments, $10,000-a-month consultants, and unlimited resources.
              On the other are the 8(a), SDVOSB, WOSB, and HUBZone
              businesses—the innovators, the builders, and the service providers
              who are the backbone of our country, but are often buried under a
              "paperwork wall."
            </p>
          </div>
        </div>
      </section>

      {/* The Founder's Vision */}
      <section className="bg-gray-50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
              The Founder's Vision
            </h2>
            <div className="mt-8 rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm sm:p-12">
              <p className="text-lg leading-relaxed text-slate-700 sm:text-xl sm:leading-relaxed">
                Founded by Nathaniel Minetree, Contrax was born out of a single
                observation: Small businesses don't lose government work because
                they can't do the job; they lose because the process of finding
                and bidding on the work is designed for giants.
              </p>
              <p className="mt-6 text-lg leading-relaxed text-slate-700 sm:text-xl sm:leading-relaxed">
                Nathaniel saw talented contractors—from HVAC specialists to IT
                innovators—spend dozens of hours "shredding" PDFs and drafting
                compliance matrices by hand, only to be disqualified on a
                technicality or miss a deadline. He realized that if you could
                automate the administrative "tax" of contracting, you could give
                these businesses their most valuable resource back: Time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The Contrax Solution */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
              The Contrax Solution
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600 sm:text-xl sm:leading-relaxed">
              Nathaniel's vision for Contrax was to build a "Contract
              Intelligence Copilot" that acts as a 24/7 business development
              department. By combining real-time discovery across 50 states and
              federal portals with an AI-driven workspace that handles everything
              from incumbent research to grounded proposal drafting, Contrax
              provides the "unfair advantage" that small primes have been
              missing.
            </p>
          </div>
        </div>
      </section>

      {/* Why We Do It */}
      <section className="bg-gray-50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
              Why We Do It
            </h2>
            <p className="mt-6 text-xl leading-relaxed text-slate-700 sm:text-2xl sm:leading-relaxed">
              We believe that when a veteran-owned business wins a VA contract,
              or a minority-owned firm builds a city's new infrastructure,
              everyone wins. Contrax is here to ensure that the best businesses
              win the work, not just the ones with the biggest proposal budgets.
            </p>
          </div>
        </div>
      </section>

      {/* Our Core Pillars */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
              Our Core Pillars
            </h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              What we stand for
            </h3>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-500 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Precision</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                AI-driven compliance that catches the gaps before the government
                does.
              </p>
            </div>
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-500 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Accessibility</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Professional-grade tools for a fraction of the cost of a
                consultant.
              </p>
            </div>
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-500 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Action</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Moving from a lead to a compliant draft in minutes, not weeks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What we do */}
      <section className="bg-gray-50 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">
              What We Do
            </h2>
            <h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              One platform, the entire bid lifecycle
            </h3>
            <p className="mt-4 text-lg text-gray-600">
              From the first search to the final submission, Contrax covers every
              step of winning government work.
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Opportunity Discovery</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                We monitor federal and city procurement sources daily,
                filtering thousands of new postings to surface only the
                opportunities that match your business.
              </p>
            </div>
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Bid Summarization</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Contrax reads dense solicitation documents and distills them into
                plain-English summaries — scope, deadlines, requirements, and
                evaluation criteria — in seconds.
              </p>
            </div>
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Win-Probability Scoring</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Every opportunity gets an honest GO / NO-GO / CAUTIOUS
                recommendation powered by NAICS matching, competition analysis,
                and agency history — so you bid where you can actually win.
              </p>
            </div>
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Proposal Drafting</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Drafts tailored proposal responses grounded in your company
                profile and past performance, with compliance checklists and PDF
                export so you can review, refine, and submit with confidence.
              </p>
            </div>
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Team Workspace</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Bring your whole team in with role-based access, shared activity
                tracking, and a single source of truth for every bid you're
                pursuing.
              </p>
            </div>
            <div className="group relative rounded-2xl border border-gray-200/60 bg-white p-8 shadow-sm transition-all hover:shadow-md">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Learning Engine</h3>
              <p className="mt-3 leading-relaxed text-gray-600">
                Every win and loss makes you smarter. Contrax analyzes outcomes,
                tracks recurring weaknesses, and feeds those lessons back into
                your win-probability scoring and bid recommendations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 py-20">
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to win your first government contract?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-blue-100/80">
            Join Contrax and turn the government market into a real growth
            channel for your business.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="/signup"
              className="inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
            >
              Get Started
              <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="/security"
              className="inline-flex items-center rounded-xl border border-blue-400/30 px-6 py-4 text-base font-medium text-blue-100 transition-colors hover:bg-blue-400/10 hover:text-white"
            >
              See how we protect your data
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
