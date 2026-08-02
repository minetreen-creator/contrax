import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [
      { title: "The Small Business Government Contracting Playbook — Contrax" },
      {
        name: "description",
        content:
          "A step-by-step guide for small businesses to win government contracts. From SAM.gov registration and UEI numbers to RFPs, proposals, and common mistakes to avoid.",
      },
      { name: "robots", content: "index, follow" },

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://contrax.company/guide" },
      { property: "og:title", content: "The Small Business Government Contracting Playbook" },
      {
        property: "og:description",
        content:
          "A step-by-step guide for small businesses to win government contracts. From SAM.gov registration and UEI numbers to RFPs, proposals, and common mistakes to avoid.",
      },
      { property: "og:image", content: "https://contrax.company/og-image.svg" },
      { property: "og:image:type", content: "image/svg+xml" },
      { property: "og:image:alt", content: "Contrax — The Small Business Government Contracting Playbook" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },

      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The Small Business Government Contracting Playbook" },
      {
        name: "twitter:description",
        content:
          "A step-by-step guide for small businesses to win government contracts. From SAM.gov registration and UEI numbers to RFPs, proposals, and common mistakes to avoid.",
      },
      { name: "twitter:image", content: "https://contrax.company/og-image.svg" },
      { name: "twitter:image:alt", content: "Contrax — The Small Business Government Contracting Playbook" },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company/guide" }],
  }),
  component: GuidePage,
});

// ── Page Component ────────────────────────────────────────────────────────────

function GuidePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">
              Free Playbook
            </p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              The Small Business Government Contracting Playbook
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-blue-100/80">
              A practical, step-by-step guide to help your small business navigate the world of
              government contracting — from your first SAM.gov registration to winning your first
              award.
            </p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="prose prose-lg prose-slate mx-auto">
            {/* Step 1 */}
            <div className="mb-16">
              <div className="mb-6 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-white shadow-md">
                  1
                </span>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                  Register on SAM.gov
                </h2>
              </div>
              <p className="text-lg leading-relaxed text-slate-600">
                SAM.gov (System for Award Management) is the federal government's central
                registration database. Every business that wants to bid on federal contracts must
                register here first — it's your gateway to the world's largest buyer.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Get your UEI number
              </h3>
              <p className="mt-3 text-slate-600">
                The Unique Entity ID (UEI) replaced the old DUNS number in 2022. It's a 12-character
                alphanumeric identifier unique to your business. You can get one for free at{" "}
                <span className="font-medium text-slate-800">sam.gov</span> — no paid service
                required. The process takes about 10–15 minutes if you have your documents ready.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                What you'll need
              </h3>
              <ul className="mt-4 space-y-2 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  Your business's legal name and physical address (no PO boxes)
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  Taxpayer Identification Number (TIN) or EIN
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  Bank routing and account numbers (for direct deposit of payments)
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  NAICS codes that describe your business activities (see Step 2)
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  Electronic Funds Transfer (EFT) information
                </li>
              </ul>

              <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
                <p className="text-sm font-semibold text-amber-800">💡 Pro tip</p>
                <p className="mt-2 text-sm text-amber-700">
                  Registration can take 7–10 business days to fully process. Start early — don't
                  wait until you find a contract you want to bid on. Also, remember to renew your
                  registration annually. An expired SAM registration will disqualify you instantly.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="mb-16">
              <div className="mb-6 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-white shadow-md">
                  2
                </span>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                  Find the Right Opportunities
                </h2>
              </div>
              <p className="text-lg leading-relaxed text-slate-600">
                The government publishes thousands of contract opportunities daily across dozens of
                sites. The challenge isn't finding bids — it's finding the right ones for your
                business.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Where to search
              </h3>
              <ul className="mt-4 space-y-2 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>SAM.gov</strong> — The primary source for federal opportunities over $25,000
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>State procurement portals</strong> — Every state has its own site (e.g.,
                    TxSmartBuy, MyFloridaMarketPlace)
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>City and county websites</strong> — Local governments often post bids on
                    their own portals
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>FedConnect, GSA eBuy, and DIBBS</strong> — Specialized platforms for
                    specific agencies and contract vehicles
                  </span>
                </li>
              </ul>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                NAICS codes are your filter
              </h3>
              <p className="mt-3 text-slate-600">
                NAICS (North American Industry Classification System) codes classify businesses by
                industry. Every government contract is tagged with one or more NAICS codes. Choose 5–10
                codes that match your capabilities — these will be your primary filters for finding
                relevant opportunities. You can look up NAICS codes at{" "}
                <span className="font-medium text-slate-800">census.gov/naics</span>.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Set up automated alerts
              </h3>
              <p className="mt-3 text-slate-600">
                Most procurement sites let you save searches and receive email alerts. Set these up
                right away. Better yet, use a platform like Contrax that monitors multiple sources
                and filters opportunities based on your NAICS codes, locations, and service
                categories — so you never miss a relevant bid.
              </p>
            </div>

            {/* Step 3 */}
            <div className="mb-16">
              <div className="mb-6 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-white shadow-md">
                  3
                </span>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                  Understand the RFP
                </h2>
              </div>
              <p className="text-lg leading-relaxed text-slate-600">
                An RFP (Request for Proposal) is the formal document that describes what the
                government wants to buy. RFPs can be 50 to 500+ pages — understanding how to read
                them quickly is a critical skill.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Anatomy of an RFP
              </h3>
              <ul className="mt-4 space-y-2 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>Section A–C:</strong> Cover sheet, table of contents, and the Statement
                    of Work (SOW) — the "what they want" section
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>Section L:</strong> Instructions for preparing your proposal — follow
                    these to the letter
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>Section M:</strong> Evaluation criteria — this tells you exactly how your
                    proposal will be scored
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>Sections B, I, J, and K:</strong> Pricing schedules, contract clauses,
                    attachments, and certifications
                  </span>
                </li>
              </ul>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Spot the key requirements
              </h3>
              <p className="mt-3 text-slate-600">
                Read Section L and Section M first — before diving into the Statement of Work. These
                tell you the rules of the game: page limits, formatting requirements, submission
                deadlines, and most importantly, how proposals will be evaluated. Missing a single
                requirement can disqualify you.
              </p>

              <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
                <p className="text-sm font-semibold text-amber-800">💡 Pro tip</p>
                <p className="mt-2 text-sm text-amber-700">
                  Create a compliance checklist from Section L before you start writing. Check off
                  each requirement as you address it. Government evaluators use a pass/fail
                  compliance check before they even read your proposal — if you miss a mandatory
                  requirement, your proposal goes in the "non-responsive" pile.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="mb-16">
              <div className="mb-6 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-white shadow-md">
                  4
                </span>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                  Build Your Proposal
                </h2>
              </div>
              <p className="text-lg leading-relaxed text-slate-600">
                A winning government proposal has three essential pillars: a compelling technical
                approach, credible past performance, and a competitive price. Here's how to structure
                each one.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Technical approach
              </h3>
              <p className="mt-3 text-slate-600">
                Start by restating the government's requirements in your own words — this shows you
                understand the problem. Then describe your solution in clear, plain language. Don't
                just say you can do the work — explain how you'll do it, who will do it, and why
                your approach is better. Use specific examples, timelines, and methodologies.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Past performance
              </h3>
              <p className="mt-3 text-slate-600">
                If you're new to government contracting, highlight relevant commercial work. The
                government cares about whether you can deliver — not just whether you've delivered
                for the government before. Include 2–3 detailed case studies with measurable results
                (dollar amounts, time saved, efficiency gains). Even subcontracting experience
                counts.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Pricing strategy
              </h3>
              <p className="mt-3 text-slate-600">
                Government pricing is different from commercial pricing. Most RFPs use one of these
                contract types:
              </p>
              <ul className="mt-4 space-y-2 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>Fixed-Price:</strong> A single price for the entire job — simplest to
                    manage, but you carry the risk of cost overruns
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>Time & Materials:</strong> Paid hourly plus expenses — lower risk for
                    you, but requires detailed time tracking
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>Cost-Reimbursement:</strong> Government pays allowable costs — highest
                    administrative burden, lowest risk
                  </span>
                </li>
              </ul>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Compliance checklist
              </h3>
              <ul className="mt-4 space-y-2 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                  Follow the exact format specified in Section L (font, margins, page limits)
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                  Address every evaluation criterion from Section M explicitly
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                  Include all required forms, certifications, and representations
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                  Proofread for typos and formatting errors — sloppiness raises doubt
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                  Have someone not involved in writing do a fresh read-through
                </li>
              </ul>
            </div>

            {/* Step 5 */}
            <div className="mb-16">
              <div className="mb-6 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-white shadow-md">
                  5
                </span>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                  Submit and Follow Up
                </h2>
              </div>
              <p className="text-lg leading-relaxed text-slate-600">
                You've written a strong proposal — now make sure it arrives on time and give
                yourself the best chance of winning, even after submission.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Submission tips
              </h3>
              <ul className="mt-4 space-y-2 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  Submit at least 24 hours before the deadline — government portals can be slow, and
                  technical issues on deadline day won't be accepted as an excuse
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  Double-check that all attachments open correctly and are in the required format
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                  Save your confirmation receipt — it's your only proof of on-time submission
                </li>
              </ul>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Post-submission communication
              </h3>
              <p className="mt-3 text-slate-600">
                After you submit, the government enters a quiet period where communication is
                restricted. Don't contact the Contracting Officer about the status of your proposal.
                Do respond promptly to any clarification questions they send — these often come with
                tight deadlines.
              </p>

              <h3 className="mt-8 text-xl font-semibold text-slate-800">
                Request a debrief
              </h3>
              <p className="mt-3 text-slate-600">
                Whether you win or lose, always request a debrief. If you win, it confirms what
                worked. If you lose, it tells you exactly why — and that information is gold for
                your next proposal. Many small businesses skip this step and miss out on the most
                valuable feedback they could get. Debrief requests must typically be made within 3
                days of award notification, so move fast.
              </p>
            </div>

            {/* Bonus: 10 Common Mistakes */}
            <div className="mb-16">
              <div className="mb-6 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow-md">
                  ✦
                </span>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
                  10 Common Mistakes Small Businesses Make (and How to Avoid Them)
                </h2>
              </div>

              <div className="mt-8 space-y-8">
                {[
                  {
                    num: 1,
                    title: "Skipping SAM.gov registration until the last minute",
                    tip: "Registration takes 7–10 business days. Start now — before you find the opportunity.",
                  },
                  {
                    num: 2,
                    title: "Bidding on everything instead of focusing",
                    tip: "Pick opportunities where you have a genuine competitive advantage. A 20% win rate on 5 well-chosen bids beats a 2% win rate on 100 random ones.",
                  },
                  {
                    num: 3,
                    title: "Ignoring Section L instructions",
                    tip: "If they ask for 12-point Times New Roman with 1-inch margins, don't send 10-point Arial. Non-compliance gets you eliminated before anyone reads a word.",
                  },
                  {
                    num: 4,
                    title: "Underpricing to win",
                    tip: "The lowest price doesn't always win, especially on Best Value contracts. Price competitively but sustainably — losing money on a contract is worse than losing the bid.",
                  },
                  {
                    num: 5,
                    title: "Not tailoring the proposal to the evaluation criteria",
                    tip: "Section M tells you the scoring weights. If Past Performance is 40% and Technical Approach is 35%, those sections need the most depth and detail.",
                  },
                  {
                    num: 6,
                    title: "Using generic boilerplate language",
                    tip: "Government evaluators read hundreds of proposals. They can spot a copy-paste job instantly. Reference specific requirements from the RFP in your response.",
                  },
                  {
                    num: 7,
                    title: "Forgetting to include required forms and certifications",
                    tip: "Create a master checklist from Section L's list of required attachments. Check each one off as you prepare it, then check again before submission.",
                  },
                  {
                    num: 8,
                    title: "Missing the deadline by minutes",
                    tip: "Government portals have no mercy on late submissions. Submit 24+ hours early and confirm receipt. Set a calendar reminder 2 days before the deadline.",
                  },
                  {
                    num: 9,
                    title: "Not asking for a debrief after losing",
                    tip: "A debrief is free consulting from the people who scored your proposal. You learn exactly what to fix. Always request one within 3 days.",
                  },
                  {
                    num: 10,
                    title: "Going it alone instead of partnering",
                    tip: "Many contracts are set aside for small businesses, and prime contractors need small business subcontractors. Partner with a larger prime on your first few bids to build past performance.",
                  },
                ].map((item) => (
                  <div key={item.num} className="flex gap-4">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700">
                      {item.num}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                      <p className="mt-1 text-slate-600">{item.tip}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-8 text-center sm:p-12">
              <h2 className="text-2xl font-bold text-white sm:text-3xl">
                Ready to automate this?
              </h2>
              <p className="mt-4 text-lg text-slate-300">
                Contrax monitors procurement sites, summarizes RFPs, and drafts proposals — so you
                can focus on winning, not paperwork.
              </p>
              <div className="mt-8">
                <a
                  href="/signup"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]"
                >
                  Start your 21-day free trial →
                </a>
              </div>
              <p className="mt-4 text-sm text-slate-400">
                No credit card required. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
