import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

const columns = ["Contrax", "GovWin / Deltek", "BidNet / Bonfire", "GovSpend", "Manual Bidding (SAM.gov)", "Consultant / Gov't Contract Specialist"];
const rows: Array<[string, ...ReactNode[]]> = [
  ["Pricing", "$49–399/mo", "$5K–25K/yr (varies by modules)", "$100–500/mo", "Varies by plan", "$0 (but cost of time)", "$3–10K+/mo retainer"],
    ["Bid coverage", "Federal + State + Local (8 sources, AI scans 24/7)", "Federal only (strong)", "State/Local focused", "Federal spend data", "Limited to what you search", "Depends on their expertise"],
  ["Set-aside matching", "Yes — set-aside-first matching for 8(a), WOSB/EDWOSB, SDVOSB, HUBZone", "No built-in set-aside matching", "No", "Spend data only", "You filter manually", "Depends on expertise"],
  ["AI proposal drafting", "Yes (GPT-4o-mini, tailored to each RFP)", "No built-in AI", "No", "No", "N/A", "Depends on consultant"],
  ["Win probability scoring", "Yes", "Partial (spend analytics)", "No", "Spend analytics", "N/A", "Subjective"],
  ["Ease of use / onboarding", "Minutes (4-step wizard)", "Weeks (enterprise onboarding)", "Moderate", "Moderate", "Steep (learn each system)", "Quick, but onboarding takes weeks"],
  ["Team collaboration", "Yes (role-based workspace)", "Enterprise", "Limited", "Yes", "N/A", "N/A"],
  ["Calendar / Slack integrations", "Yes", "Limited", "No", "Limited", "N/A", "N/A"],
  ["Best for", <span className="block space-y-2"><span className="block"><strong className="font-semibold text-slate-900">Starter:</strong> Solo 8(a) or SDVOSB contractors pursuing their first set-aside bids</span><span className="block"><strong className="font-semibold text-slate-900">Professional:</strong> Active WOSB/HUBZone firms managing multiple set-aside opportunities</span><span className="block"><strong className="font-semibold text-slate-900">Agency:</strong> 8(a) program participants and GovCon firms with dedicated proposal teams</span></span>, "Large enterprises with dedicated BD teams", "State/local government vendors", "Teams needing contract spending intelligence", "Very small needs", "Well-funded companies"],
];

const TITLE = "Contrax vs GovWin & BidNet — Platform Comparison";
const DESC =
  "Compare Contrax vs GovWin, BidNet, GovSpend, SAM.gov, and consultants on pricing, bid coverage, set-aside matching for 8(a), WOSB, SDVOSB, and HUBZone firms, AI proposal tools, and ease of use.";

export const Route = createFileRoute("/compare/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://contrax.company/compare" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: "https://contrax.company/og-image.svg" },
      { property: "og:image:type", content: "image/svg+xml" },
      { property: "og:image:alt", content: "Contrax government contract software comparison" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: "https://contrax.company/og-image.svg" },
      { name: "twitter:image:alt", content: "Contrax government contract software comparison" },
    ],
    links: [{ rel: "canonical", href: "https://contrax.company/compare" }],
  }),
  component: ComparePage,
});

function Mark({ value }: { value: ReactNode }) {
  const isString = typeof value === "string";
  const positive = isString && (value === "Yes" || value.startsWith("Yes "));
  const negative = isString && (["No", "N/A"].includes(value) || value.startsWith("No "));
  return <span className="inline-flex items-start gap-2"><span className={positive ? "font-bold text-green-600" : negative ? "font-bold text-red-400" : "hidden"}>{positive ? "✓" : "✕"}</span><span>{value}</span></span>;
}

function ComparePage() {
  return <div className="min-h-screen bg-white">
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Contrax vs GovWin & BidNet — Platform Comparison",
          url: "https://contrax.company/compare",
          description:
            "Compare Contrax vs GovWin, BidNet, GovSpend, SAM.gov, and consultants on pricing, bid coverage, set-aside matching for 8(a), WOSB, SDVOSB, and HUBZone firms, AI proposal tools, and ease of use.",
          about: "Government contract software comparison for set-aside certified small businesses",
          publisher: { "@type": "Organization", name: "Contrax", url: "https://contrax.company" },
        }),
      }}
    />
    <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-6 text-center"><p className="text-sm font-semibold uppercase tracking-widest text-amber-400">Government contracting software comparison</p><h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Contrax vs. the Competition — How We Stack Up Against GovWin, BidNet &amp; More</h1><p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-blue-100/80">Choosing the right contracting platform is a big decision — especially for 8(a), WOSB/EDWOSB, SDVOSB, and HUBZone-certified firms. Compare pricing, coverage, set-aside matching, AI capabilities, and collaboration tools so you can make an informed choice for your business.</p></div>
    </section>
    <section className="py-16 sm:py-24"><div className="mx-auto max-w-7xl px-6"><div className="mb-10 max-w-2xl"><p className="font-semibold text-amber-600">A side-by-side look</p><h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Find the right fit for your growth</h2><p className="mt-4 text-gray-600">Every option has a place. Here is how the tools compare on the capabilities that matter most.</p></div>
      <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 shadow-sm md:block"><table className="w-full min-w-[1050px] border-collapse text-left text-sm"><thead><tr className="bg-slate-900 text-white"><th className="w-44 p-5 font-semibold">Capability</th>{columns.map((c, i) => <th key={c} className={`p-5 font-semibold ${i === 0 ? "bg-blue-900/60 text-amber-300" : ""}`}>{c}</th>)}</tr></thead><tbody>{rows.map(([label, ...values], r) => <tr key={label} className={r % 2 ? "bg-slate-50" : "bg-white"}><th className="p-5 font-semibold text-slate-900">{label}</th>{values.map((v, i) => <td key={i} className={`p-5 align-top leading-relaxed ${i === 0 ? "bg-blue-50/70 font-medium text-slate-900" : "text-gray-600"}`}><Mark value={v} /></td>)}</tr>)}</tbody></table></div>
      <div className="space-y-5 md:hidden">{columns.slice(1).map((competitor, ci) => <article key={competitor} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><h3 className="text-xl font-bold text-slate-900">{competitor}</h3><div className="mt-5 space-y-4">{rows.map(([label, contrax, ...others]) => <div key={label} className="border-t border-gray-100 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p><div className="mt-1 text-sm text-gray-700"><span className="font-semibold text-blue-700">Contrax:</span> {contrax}</div><div className="mt-1 text-sm text-gray-600"><span className="font-semibold text-slate-700">{competitor}:</span> <Mark value={others[ci]} /></div></div>)}</div></article>)}</div>
    </div></section>
    <section className="bg-slate-50 py-16 sm:py-24"><div className="mx-auto max-w-3xl px-6"><h2 className="text-center text-3xl font-bold text-slate-900 sm:text-4xl">The Bottom Line</h2><div className="mt-8 space-y-5 text-lg leading-relaxed text-gray-600"><p>Contrax is built for set-aside certified small businesses — 8(a), WOSB/EDWOSB, SDVOSB, and HUBZone firms — that want a practical path into federal contracting. It combines set-aside-first opportunity matching, plain-English bid summaries, win probability scoring, and proposal drafting in one affordable workspace.</p><p>At $49–399 per month, Contrax gives growing teams coverage across federal, state, and local sources without the enterprise price tag. The Starter plan fits solo 8(a) or SDVOSB contractors pursuing their first set-aside bids; Professional serves active WOSB/HUBZone firms managing multiple opportunities; Agency supports 8(a) program participants and GovCon firms with dedicated proposal teams. Guided onboarding takes minutes instead of weeks.</p><p>GovWin can be the right choice for a large enterprise with a $50M+ pipeline, a dedicated business development team, and a need for deep federal spend intelligence. BidNet or Bonfire may suit vendors focused specifically on state and local procurement. Manual SAM.gov searching remains useful for a very small need, and a specialist can bring valuable hands-on expertise when budget is less constrained.</p><p>But if your competitive edge is a certification — and the set-aside market it unlocks — Contrax is the only platform on this list built around that edge. It matches your certifications to set-aside opportunities first, tracks your certification deadlines, and drafts proposals tailored to each solicitation.</p></div></div></section>
    <section className="bg-slate-900 py-16"><div className="mx-auto max-w-3xl px-6 text-center"><h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to start winning contracts?</h2><p className="mt-4 text-lg text-blue-100/70">Plans start at $49/month, with no long-term contract required.</p><a href="/signup" className="mt-8 inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 font-semibold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-400">Get Started <span className="ml-2">→</span></a></div></section>
    <section className="py-16 sm:py-24"><div className="mx-auto max-w-3xl px-6"><h2 className="text-center text-3xl font-bold text-slate-900">Frequently asked questions</h2><div className="mt-8 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">{[
      ["Is Contrax built for set-aside certified businesses?", "Yes — set-asides are the core of the product. Contrax matches your 8(a), WOSB/EDWOSB, SDVOSB, or HUBZone certification to set-aside opportunities first, highlights when a bid's set-aside matches your certifications, tracks certification expiration deadlines, and tailors proposal drafting to the set-aside program you're bidding under."],
      ["Is Contrax better than GovWin?", "For small and mid-size businesses — especially set-aside certified firms — often yes: Contrax is more affordable, easier to onboard, covers more source types, and includes AI proposal tools. GovWin may be a better fit for large enterprises needing deep federal intelligence."],
      ["Does Contrax replace SAM.gov?", "No. SAM.gov remains the official source for federal opportunities and submissions. Contrax complements it by monitoring multiple sources, filtering matches, and helping you understand and respond to bids."],
      ["Can I switch from BidNet to Contrax?", "Yes. Contrax can work alongside or replace BidNet for teams that want federal, state, and local coverage plus AI-powered summaries, scoring, and proposal drafting."],
      ["Is Contrax suitable for federal contracting?", "Yes. Contrax monitors federal opportunities, including SAM.gov data, and helps you assess fit, understand RFP requirements, and draft tailored proposals."],
      ["How much does Contrax cost compared to hiring a consultant?", "Contrax costs $49–399 per month, compared with typical consultant retainers of $3,000–10,000 or more per month. A consultant may still be worthwhile for specialized strategy or hands-on support."],
      ["Do I need any government contracting experience?", "No. Contrax's four-step onboarding, plain-English bid summaries, and guided AI tools are designed to help first-time government contractors get started with confidence — and if you hold or are pursuing an 8(a), WOSB, SDVOSB, or HUBZone certification, Contrax is built to put that certification to work finding set-aside opportunities."],
    ].map(([q, a]) => <details key={q} className="group p-6"><summary className="cursor-pointer list-none pr-8 font-semibold text-slate-900 marker:hidden"><span className="flex items-center justify-between">{q}<span className="text-xl text-amber-500 transition group-open:rotate-45">+</span></span></summary><p className="mt-3 leading-relaxed text-gray-600">{a}</p></details>)}</div></div></section>
  </div>;
}
